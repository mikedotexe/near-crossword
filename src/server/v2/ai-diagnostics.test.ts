import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnosticError, diagnosticUsage, parseDiagnosticOptions, runDiagnostic } from "../../../scripts/diagnose-near-ai";

test("diagnostic options bound calls and require explicit models without guessing reasoning flags", () => {
  assert.throws(() => parseDiagnosticOptions({ mode: "chat" }));
  assert.throws(() => parseDiagnosticOptions({ mode: "auth", timeoutMs: 120001 }));
  assert.throws(() => parseDiagnosticOptions({ mode: "auth", maxTokens: 257 }));
  assert.throws(() => parseDiagnosticOptions({ mode: "chat", model: "z-ai/glm-5.3-flash", disableThinking: true }));
  assert.throws(() => parseDiagnosticOptions({ mode: "costs", inferenceId: "not-a-uuid" }));
  assert.equal(parseDiagnosticOptions({ mode: "chat", model: "Qwen/Qwen3.6-35B-A3B-FP8", disableThinking: true }).disableThinking, true);
});

test("diagnostics retain only numeric usage and safe error metadata", () => {
  assert.deepEqual(diagnosticUsage({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, reasoning_tokens: 0, secret: "NEVER_PRINT" }),
    { promptTokens: 10, completionTokens: 2, totalTokens: 12, reasoningTokens: 0 });
  assert.equal(diagnosticUsage({ reasoning_tokens: -1 }).reasoningTokens, null);
  assert.deepEqual(diagnosticError({ status: 401, message: "NEVER_PRINT", request_id: "NEVER_PRINT" }, false),
    { status: 401, error: "HTTP_ERROR", serverRequestId: null });
  assert.equal(diagnosticError(new Error("NEVER_PRINT"), true).error, "DEADLINE");
});

test("nonbillable auth compares an invalid control with the configured key and hides response bodies", async () => {
  const output: unknown[] = []; let calls = 0;
  const ok = await runDiagnostic(parseDiagnosticOptions({ mode: "auth" }), "TEST_KEY", {
    log: (value) => output.push(value), fetch: async (url, init) => {
      calls++; assert.equal(url, "https://cloud-api.near.ai/v1/billing/costs");
      assert.equal(init?.redirect, "error");
      const valid = new Headers(init?.headers).get("authorization") === "Bearer TEST_KEY";
      return new Response(JSON.stringify(valid ? { requests: [], warning: "NEVER_PRINT" } : { error: { message: "NEVER_PRINT" } }), {
        status: valid ? 200 : 401, headers: { "content-type": "application/json", "x-request-id": "NEVER_PRINT" },
      });
    },
  });
  assert.equal(ok, true); assert.equal(calls, 2);
  assert.ok(!JSON.stringify(output).includes("NEVER_PRINT")); assert.ok(!JSON.stringify(output).includes("TEST_KEY"));
});

test("a missing billing record is unknown, not proof of a free request", async () => {
  const output: Record<string, unknown>[] = [];
  const inferenceId = "10000000-0000-4000-8000-000000000001";
  await runDiagnostic(parseDiagnosticOptions({ mode: "costs", inferenceId }), "TEST_KEY", {
    log: (value) => output.push(value), fetch: async () => new Response(JSON.stringify({
      requests: [{ requestId: inferenceId, costNanoUsd: 0 }], warning: "No record found",
    })),
  });
  assert.equal(output[0].found, false); assert.equal(output[0].costNanoUsd, null);
});

test("chat diagnostic performs one bounded SDK request and never logs output text", async () => {
  const output: unknown[] = []; let calls = 0;
  const ok = await runDiagnostic(parseDiagnosticOptions({ mode: "chat", model: "Qwen/Qwen3.6-35B-A3B-FP8", disableThinking: true }), "TEST_KEY", {
    log: (value) => output.push(value), fetch: async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
      assert.equal(body.max_tokens, 32); assert.equal(body.stream, false);
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "NEVER_PRINT" } }], usage: { prompt_tokens: 5 } }), { headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(calls, 1); assert.equal(ok, false); assert.ok(!JSON.stringify(output).includes("NEVER_PRINT"));
});

test("diagnostic provider errors are redacted and never retried", async () => {
  const output: unknown[] = []; let calls = 0;
  const ok = await runDiagnostic(parseDiagnosticOptions({ mode: "chat", model: "zai-org/GLM-5.1-FP8" }), "TEST_KEY", {
    log: (value) => output.push(value), fetch: async () => {
      calls++;
      return Response.json({ error: { message: "NEVER_PRINT TEST_KEY" } }, { status: 500 });
    },
  });
  assert.equal(ok, false); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(output).includes("NEVER_PRINT")); assert.ok(!JSON.stringify(output).includes("TEST_KEY"));
});

for (const complete of [true, false]) {
  test(`stream diagnostic requires a completed response (complete=${complete})`, async () => {
    const output: Record<string, unknown>[] = [];
    const inferenceId = "10000000-0000-4000-8000-000000000002";
    const ok = await runDiagnostic(parseDiagnosticOptions({ mode: "stream", model: "zai-org/GLM-5.1-FP8" }), "TEST_KEY", {
      log: (value) => output.push(value), fetch: async (_url, init) => {
        assert.equal(JSON.parse(String(init?.body)).stream_options.include_usage, true);
        return new Response(`data: ${JSON.stringify({
          choices: [{ index: 0, delta: { content: "OK", reasoning_content: "NEVER_PRINT" }, finish_reason: complete ? "stop" : null }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        })}\n\ndata: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream", "inference-id": inferenceId, "x-request-id": "NEVER_PRINT" },
        });
      },
    });
    assert.equal(ok, complete);
    assert.equal(output[1].inferenceId, inferenceId); assert.equal(output[1].serverRequestId, null);
    assert.ok(!JSON.stringify(output).includes("NEVER_PRINT"));
  });
}

test("diagnostic body consumption obeys the total deadline", async () => {
  const output: Record<string, unknown>[] = [];
  const keepAlive = setTimeout(() => undefined, 2000);
  try {
    const ok = await runDiagnostic(parseDiagnosticOptions({ mode: "chat", model: "zai-org/GLM-5.1-FP8", timeoutMs: 1000 }), "TEST_KEY", {
      log: (value) => output.push(value), fetch: async (_url, init) => new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new Error("NEVER_PRINT")), { once: true });
        },
      }), { headers: { "content-type": "application/json" } }),
    });
    assert.equal(ok, false); assert.equal(output.at(-1)?.error, "DEADLINE");
    assert.ok(!JSON.stringify(output).includes("NEVER_PRINT"));
  } finally {
    clearTimeout(keepAlive);
  }
});
