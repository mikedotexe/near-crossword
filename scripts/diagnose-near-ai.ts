import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import OpenAI from "openai";
import { z } from "zod";

const gateway = "https://cloud-api.near.ai/v1";
const optionsSchema = z.object({
  mode: z.enum(["auth", "chat", "stream", "costs"]),
  model: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(128).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  maxTokens: z.number().int().min(1).max(256).default(32),
  disableThinking: z.boolean().default(false),
  inferenceId: z.string().uuid().optional(),
}).strict().superRefine((input, context) => {
  if ((input.mode === "chat" || input.mode === "stream") && !input.model) {
    context.addIssue({ code: "custom", message: "Choose an explicit catalog model" });
  }
  if (input.mode === "costs" && !input.inferenceId) context.addIssue({ code: "custom", message: "Provide an inference ID" });
  if (input.disableThinking && ![
    "zai-org/GLM-5.1-FP8", "Qwen/Qwen3.5-122B-A10B", "Qwen/Qwen3.6-35B-A3B-FP8",
  ].includes(input.model || "")) context.addIssue({ code: "custom", message: "Thinking control is not documented for this model" });
});
export type DiagnosticOptions = z.infer<typeof optionsSchema>;
export function parseDiagnosticOptions(raw: unknown): DiagnosticOptions {
  const parsed = optionsSchema.safeParse(raw);
  if (!parsed.success) throw new Error("INVALID_DIAGNOSTIC_OPTIONS");
  return parsed.data;
}

function safeId(value: unknown) { return z.string().uuid().safeParse(value).success ? value as string : null; }
function count(value: unknown) { return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null; }
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
export function diagnosticUsage(raw: unknown) {
  const usage = record(raw);
  return {
    promptTokens: count(usage.prompt_tokens), completionTokens: count(usage.completion_tokens), totalTokens: count(usage.total_tokens),
    reasoningTokens: count(usage.reasoning_tokens) ?? count(record(usage.completion_tokens_details).reasoning_tokens),
  };
}
export function diagnosticError(error: unknown, aborted: boolean) {
  const status = count(record(error).status);
  return {
    error: aborted ? "DEADLINE" : status ? "HTTP_ERROR" : "TRANSPORT_OR_PROTOCOL_ERROR",
    status, serverRequestId: safeId(record(error).request_id),
  };
}

export async function runDiagnostic(options: DiagnosticOptions, apiKey: string, dependencies: {
  fetch?: typeof globalThis.fetch; log?: (value: Record<string, unknown>) => void;
} = {}) {
  const log = dependencies.log || ((value) => console.log(JSON.stringify(value)));
  const fetcher = dependencies.fetch || globalThis.fetch;
  if (options.mode === "auth" || options.mode === "costs") {
    const probes = options.mode === "auth" ? [
      { label: "invalid-control", key: "sk-diagnostic-deliberately-invalid" }, { label: "configured-key", key: apiKey },
    ] : [{ label: "inference-cost", key: apiKey }];
    let ok = true;
    for (const probe of probes) {
      const start = Date.now(); const deadlineMs = Math.min(options.timeoutMs, 15000);
      const signal = AbortSignal.timeout(deadlineMs);
      try {
        const response = await fetcher(`${gateway}/billing/costs`, {
          method: "POST", redirect: "error", signal,
          headers: { Authorization: `Bearer ${probe.key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ requestIds: [options.inferenceId || "00000000-0000-4000-8000-000000000001"] }),
        });
        const body = record(await response.json());
        const requests = Array.isArray(body.requests) ? body.requests : [];
        const matched = requests.map(record).find((item) => item.requestId === options.inferenceId);
        const found = options.mode === "costs" && response.ok && !body.warning && Boolean(matched);
        log({ mode: options.mode, probe: probe.label, status: response.status, elapsedMs: Date.now() - start,
          serverRequestId: safeId(response.headers.get("x-request-id")),
          ...(options.mode === "costs" ? { found, costNanoUsd: found ? count(matched?.costNanoUsd) : null } : {}),
        });
        ok = ok && response.status === (probe.label === "invalid-control" ? 401 : 200);
      } catch (error) {
        const elapsedMs = Date.now() - start;
        ok = false; log({ mode: options.mode, probe: probe.label, elapsedMs, ...diagnosticError(error, signal.aborted || elapsedMs >= deadlineMs) });
      }
    }
    return ok;
  }

  const start = Date.now(); const requestId = randomUUID(); const signal = AbortSignal.timeout(options.timeoutMs);
  log({ mode: options.mode, model: options.model, requestId, deadlineMs: options.timeoutMs, maxTokens: options.maxTokens, disableThinking: options.disableThinking });
  const client = new OpenAI({
    apiKey, baseURL: gateway, maxRetries: 0, timeout: options.timeoutMs, logLevel: "off",
    organization: null, project: null, fetch: fetcher, fetchOptions: { redirect: "error" },
  });
  const body = {
    model: options.model!, max_tokens: options.maxTokens,
    messages: [{ role: "user" as const, content: "Reply with exactly OK." }],
    ...(options.disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  };
  const request = { signal, headers: { "x-request-id": requestId } };
  function headers(response: Response) {
    log({ phase: "headers", elapsedMs: Date.now() - start, status: response.status,
      serverRequestId: safeId(response.headers.get("x-request-id")), inferenceId: safeId(response.headers.get("inference-id")) });
  }
  try {
    let content = ""; let finish: string | null = null; let usage: unknown; let chunks = 0;
    if (options.mode === "stream") {
      const { data, response } = await client.chat.completions.create({ ...body, stream: true, stream_options: { include_usage: true } }, request).withResponse();
      headers(response);
      for await (const chunk of data) {
        if (++chunks === 1) log({ phase: "first-chunk", elapsedMs: Date.now() - start });
        content += chunk.choices[0]?.delta?.content || "";
        if (content.length > 32000) throw new Error("Response exceeds probe limit");
        finish = chunk.choices[0]?.finish_reason || finish;
        if (chunk.usage) usage = chunk.usage;
      }
    } else {
      const { data, response } = await client.chat.completions.create({ ...body, stream: false }, request).withResponse();
      headers(response); content = data.choices?.[0]?.message.content || "";
      finish = data.choices?.[0]?.finish_reason || null; usage = data.usage;
    }
    const matched = content.trim() === "OK";
    log({ phase: "complete", elapsedMs: Date.now() - start, chunks, contentCharacters: content.length, replyMatches: matched,
      finishReason: ["stop", "length", "content_filter", "tool_calls"].includes(finish || "") ? finish : "other", usage: diagnosticUsage(usage) });
    return matched && finish === "stop";
  } catch (error) {
    const elapsedMs = Date.now() - start;
    log({ phase: "failed", elapsedMs, requestId, ...diagnosticError(error, signal.aborted || elapsedMs >= options.timeoutMs) });
    return false;
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    "env-file": { type: "string" }, mode: { type: "string", default: "auth" }, model: { type: "string" },
    "timeout-ms": { type: "string", default: "30000" }, "max-tokens": { type: "string", default: "32" },
    "disable-thinking": { type: "boolean", default: false }, "inference-id": { type: "string" },
  } });
  const options = parseDiagnosticOptions({ mode: values.mode, model: values.model, timeoutMs: Number(values["timeout-ms"]),
    maxTokens: Number(values["max-tokens"]), disableThinking: values["disable-thinking"], inferenceId: values["inference-id"] });
  const env = values["env-file"] ? dotenv.parse(readFileSync(values["env-file"])) : {};
  const apiKey = (process.env.NEAR_AI_API_KEY || env.NEAR_AI_API_KEY)?.trim();
  if (!apiKey) throw new Error("NEAR_AI_KEY_REQUIRED");
  if (!await runDiagnostic(options, apiKey)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error(JSON.stringify({ ok: false, error: "DIAGNOSTIC_SETUP_FAILED" })); process.exitCode = 1; });
}
