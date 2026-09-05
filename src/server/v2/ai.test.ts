import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NearAiGenerator } from "./ai";
import { AppError } from "./errors";

const input = { topic: "digital dollars", tone: "friendly", count: 3 };
const entries = [
  { clue: "An address that holds your funds", answer: "WALLET" },
  { clue: "A digital dollar", answer: "USDC" },
  { clue: "The record of transfers", answer: "LEDGER" },
];
const envKeys = ["NEAR_AI_API_KEY", "NEAR_AI_BASE_URL", "V2_AI_MODEL", "ANTHROPIC_API_KEY"];
let previousEnv: Array<string | undefined>;

beforeEach(() => {
  previousEnv = envKeys.map((key) => process.env[key]);
  for (const key of envKeys) delete process.env[key];
  process.env.NEAR_AI_API_KEY = "near-ai-test-secret";
});

afterEach(() => {
  envKeys.forEach((key, index) => {
    if (previousEnv[index] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[index];
  });
});

function completion(content: unknown = { entries }, finishReason = "stop", refusal: string | null = null) {
  return Response.json({
    id: "local-test-completion",
    object: "chat.completion",
    model: "zai-org/GLM-5.1-FP8",
    choices: [{
      index: 0,
      finish_reason: finishReason,
      message: { role: "assistant", content: JSON.stringify(content), refusal },
    }],
  });
}

function hasCode(code: string, status: number) {
  return (error: unknown) => error instanceof AppError && error.code === code && error.status === status;
}

describe("NEAR AI generation", () => {
  it("uses the NEAR key and a bounded structured request without an Anthropic key", async () => {
    let requests = 0;
    const generator = new NearAiGenerator({
      fetch: async (url, init) => {
        requests++;
        assert.equal(String(url), "https://cloud-api.near.ai/v1/chat/completions");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer near-ai-test-secret");
        assert.equal(init?.redirect, "error");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, "zai-org/GLM-5.1-FP8");
        assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
        assert.equal(body.max_tokens, 4096);
        assert.equal(body.stream, false);
        assert.equal(body.response_format.type, "json_schema");
        assert.equal(body.response_format.json_schema.strict, true);
        assert.equal(body.response_format.json_schema.schema.properties.entries.minItems, 3);
        assert.equal(body.response_format.json_schema.schema.properties.entries.maxItems, 3);
        assert.deepEqual(JSON.parse(body.messages[1].content), input);
        return completion();
      },
    });
    generator.assertConfigured();
    assert.deepEqual(await generator.generate(input), entries);
    assert.equal(requests, 1);
  });

  it("accepts a configured direct NEAR endpoint and model", async () => {
    process.env.NEAR_AI_BASE_URL = "https://qwen35-122b.completions.near.ai/v1/";
    process.env.V2_AI_MODEL = "Qwen/Qwen3.5-122B-A10B";
    const generator = new NearAiGenerator({
      fetch: async (url, init) => {
        assert.equal(String(url), "https://qwen35-122b.completions.near.ai/v1/chat/completions");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, "Qwen/Qwen3.5-122B-A10B");
        assert.equal(body.chat_template_kwargs, undefined);
        return completion();
      },
    });
    assert.deepEqual(await generator.generate(input), entries);
  });

  for (const model of ["zai-org/GLM-5.1-FP8", "z-ai/glm-5.3-flash", "google/gemma-4-31B-it"]) {
    it(`keeps the thinking setting model-specific for override ${model}`, async () => {
      process.env.V2_AI_MODEL = model;
      const generator = new NearAiGenerator({ fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, model);
        assert.deepEqual(body.chat_template_kwargs, model === "zai-org/GLM-5.1-FP8" ? { enable_thinking: false } : undefined);
        return completion();
      } });
      assert.deepEqual(await generator.generate(input), entries);
    });
  }

  it("fails before sending a request when the NEAR key is missing", async () => {
    delete process.env.NEAR_AI_API_KEY;
    process.env.ANTHROPIC_API_KEY = "must-not-be-used";
    const generator = new NearAiGenerator({ fetch: async () => { throw new Error("unexpected request"); } });
    assert.throws(() => generator.assertConfigured(), hasCode("AI_NOT_CONFIGURED", 503));
    await assert.rejects(generator.generate(input), hasCode("AI_NOT_CONFIGURED", 503));
  });

  for (const endpoint of [
    "not a URL",
    "http://cloud-api.near.ai/v1",
    "https://cloud-api.near.ai.attacker.test/v1",
    "https://user:secret@cloud-api.near.ai/v1",
    "https://cloud-api.near.ai/v1?token=secret",
    "https://cloud-api.near.ai/v1#secret",
    "https://cloud-api.near.ai:8443/v1",
    "https://cloud-api.near.ai/v1/chat/completions",
  ]) {
    it(`rejects an invalid endpoint: ${endpoint}`, () => {
      process.env.NEAR_AI_BASE_URL = endpoint;
      assert.throws(() => new NearAiGenerator().assertConfigured(), hasCode("AI_NOT_CONFIGURED", 503));
    });
  }

  it("normalizes case without silently deleting invalid answer characters", async () => {
    const lowercase = entries.map((entry) => ({ clue: ` ${entry.clue} `, answer: entry.answer.toLowerCase() }));
    const generator = new NearAiGenerator({ fetch: async () => completion({ entries: lowercase }) });
    assert.deepEqual(await generator.generate(input), entries);
  });

  for (const [name, invalidEntries] of [
    ["too few entries", entries.slice(0, 2)],
    ["too many entries", [...entries, { clue: "Another clue", answer: "EXTRA" }]],
    ["duplicate normalized answers", [entries[0], { ...entries[1], answer: "wallet" }, entries[2]]],
    ["answer punctuation that would change the answer", [{ ...entries[0], answer: "WAL!LET" }, ...entries.slice(1)]],
    ["short clue", [{ ...entries[0], clue: "x" }, ...entries.slice(1)]],
    ["long clue", [{ ...entries[0], clue: "x".repeat(301) }, ...entries.slice(1)]],
    ["long answer", [{ ...entries[0], answer: "X".repeat(33) }, ...entries.slice(1)]],
    ["unknown clue fields", [{ ...entries[0], secret: "unexpected" }, ...entries.slice(1)]],
  ] as const) {
    it(`rejects ${name}`, async () => {
      const generator = new NearAiGenerator({ fetch: async () => completion({ entries: invalidEntries }) });
      await assert.rejects(generator.generate(input), hasCode("AI_RESPONSE_INVALID", 502));
    });
  }

  for (const [name, response] of [
    ["truncated output even when its JSON parses", () => completion({ entries }, "length")],
    ["a refusal", () => completion({ entries }, "stop", "I cannot provide this")],
    ["missing choices", () => Response.json({})],
    ["null response", () => Response.json(null)],
    ["malformed content JSON", () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "{broken" } }] })],
    ["fenced JSON instead of structured output", () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "```json\n{}\n```" } }] })],
  ] as const) {
    it(`rejects ${name}`, async () => {
      const generator = new NearAiGenerator({ fetch: async () => response() });
      await assert.rejects(generator.generate(input), hasCode("AI_RESPONSE_INVALID", 502));
    });
  }

  for (const [status, code, appStatus] of [
    [402, "AI_CREDITS_EXHAUSTED", 503],
    [429, "AI_RATE_LIMITED", 503],
    [401, "AI_AUTH_FAILED", 503],
    [403, "AI_AUTH_FAILED", 503],
    [500, "AI_UNAVAILABLE", 502],
  ] as const) {
    it(`sanitizes HTTP ${status} and does not retry provider billing`, async () => {
      let requests = 0;
      const generator = new NearAiGenerator({ fetch: async () => {
        requests++;
        return Response.json({ error: { message: "near-ai-test-secret and unpublished answer" } }, { status });
      } });
      await assert.rejects(generator.generate(input), (error: unknown) => {
        assert.ok(hasCode(code, appStatus)(error));
        assert.doesNotMatch(String(error), /near-ai-test-secret|unpublished answer/);
        assert.doesNotMatch(JSON.stringify(error), /near-ai-test-secret|unpublished answer/);
        return true;
      });
      assert.equal(requests, 1);
    });
  }

  it("sanitizes transport errors", async () => {
    let requests = 0;
    const generator = new NearAiGenerator({ fetch: async () => {
      requests++;
      throw new Error("near-ai-test-secret leaked by transport");
    } });
    await assert.rejects(generator.generate(input), hasCode("AI_UNAVAILABLE", 502));
    assert.equal(requests, 1);
  });

  it("aborts a stalled response body within the overall deadline", async () => {
    const keepAlive = setTimeout(() => undefined, 1000);
    let aborted = false;
    const generator = new NearAiGenerator({
      timeoutMs: 20,
      fetch: async (_url, init) => new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            controller.error(new DOMException("Request aborted", "AbortError"));
          }, { once: true });
        },
      }), { headers: { "content-type": "application/json" } }),
    });
    try {
      await assert.rejects(generator.generate(input), hasCode("AI_TIMEOUT", 504));
      assert.equal(aborted, true);
    } finally {
      clearTimeout(keepAlive);
    }
  });
});
