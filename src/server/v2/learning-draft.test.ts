import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createHash } from "node:crypto";
import { NearAiLearningDraftGenerator, parseLearningDraftInput, validateLearningDraft } from "./learning-draft";
import { learningSourceFixture as input, learningDraftFixture as draft } from "./learning-draft.fixture";
import { AppError } from "./errors";

const envKeys = ["NEAR_AI_API_KEY", "NEAR_AI_BASE_URL", "V2_AI_MODEL"];
let previous: (string | undefined)[];
beforeEach(() => {
  previous = envKeys.map((key) => process.env[key]);
  for (const key of envKeys) delete process.env[key];
  process.env.NEAR_AI_API_KEY = "test-only-near-ai-key";
});
afterEach(() => envKeys.forEach((key, index) => {
  if (previous[index] === undefined) delete process.env[key];
  else process.env[key] = previous[index];
}));

const invalid = (error: unknown) => error instanceof AppError && error.code === "AI_DRAFT_INVALID";

describe("source-grounded learning drafts", () => {
  it("requests cited content and returns private provenance requiring review", async () => {
    const generator = new NearAiLearningDraftGenerator({ fetch: async (url, options) => {
      assert.equal(String(url), "https://cloud-api.near.ai/v1/chat/completions");
      const request = JSON.parse(String(options?.body));
      assert.deepEqual(JSON.parse(request.messages[1].content), input);
      assert.match(request.messages[0].content, /untrusted data/);
      assert.equal(request.response_format.json_schema.schema.properties.entries.minItems, 3);
      assert.deepEqual(request.response_format.json_schema.schema.properties.entries.items.properties.evidence.items.properties.sourceId.enum, ["payment-basics"]);
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(draft) } }], usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } });
    } });
    const result = await generator.generate(input);
    assert.equal(result.reviewStatus, "REQUIRES_REVIEW");
    assert.equal(result.version, "learning-draft:v1");
    assert.deepEqual(result.entries, draft.entries);
    assert.equal(result.sourceManifest[0].sha256, createHash("sha256").update(input.sources[0].text).digest("hex"));
    assert.equal("text" in result.sourceManifest[0], false);
    assert.deepEqual(result.usage, { promptTokens: 100, completionTokens: 200, totalTokens: 300 });
  });

  for (const [name, mutate] of [
    ["invented source", (value: typeof draft) => { value.entries[0].evidence[0].sourceId = "imaginary"; }],
    ["fabricated quote", (value: typeof draft) => { value.paragraphs[0].evidence[0].quote = "An unsupported claim that is not in any source."; }],
    ["uncited answer", (value: typeof draft) => { value.entries[0].answer = "BLOCKCHAIN"; }],
    ["duplicate normalized answer", (value: typeof draft) => { value.entries[1].answer = "wallet"; }],
    ["missing clue", (value: typeof draft) => { value.entries.pop(); }],
    ["empty evidence", (value: typeof draft) => { value.entries[0].evidence = []; }],
    ["duplicate evidence", (value: typeof draft) => { value.entries[0].evidence.push(value.entries[0].evidence[0]); }],
    ["too-short lesson", (value: typeof draft) => { value.paragraphs[0].text = "Short"; }],
    ["model-supplied approval", (value: typeof draft) => { Object.assign(value, { reviewStatus: "APPROVED" }); }],
    ["model-supplied rewards", (value: typeof draft) => { Object.assign(value.entries[0], { reward: 100 }); }],
  ] as const) {
    it(`rejects ${name}`, () => {
      const value = structuredClone(draft);
      mutate(value);
      assert.throws(() => validateLearningDraft(value, input), invalid);
    });
  }

  it("normalizes answer case and trims outer text", () => {
    const value = structuredClone(draft);
    value.entries[0].answer = " wallet ";
    assert.equal(validateLearningDraft(value, input).entries[0].answer, "WALLET");
  });

  for (const badInput of [
    { ...input, sources: [] },
    { ...input, sources: [...input.sources, ...input.sources] },
    { ...input, sources: [{ ...input.sources[0], text: "Too short" }] },
    { ...input, sources: [{ ...input.sources[0], url: "javascript:alert(1)" }] },
    { ...input, sources: [{ ...input.sources[0], url: "not a URL" }] },
    { ...input, sources: [{ ...input.sources[0], url: "https://user:secret@example.com" }] },
    { ...input, count: 13 },
    { ...input, sources: ["a", "b", "c"].map((id) => ({ ...input.sources[0], id, text: "a".repeat(9000) })) },
  ]) {
    it("rejects invalid or oversized input without contacting the provider", async () => {
      let calls = 0;
      const generator = new NearAiLearningDraftGenerator({ fetch: async () => { calls++; throw new Error("Unexpected request"); } });
      await assert.rejects(generator.generate(badInput), (error: unknown) => error instanceof AppError && error.code === "INVALID_LEARNING_SOURCE");
      assert.equal(calls, 0);
    });
  }

  it("treats source URLs as provenance, never as fetch targets", () => {
    const source = { ...input.sources[0], url: "https://example.org/lesson" };
    assert.equal(parseLearningDraftInput({ ...input, sources: [source] }).sources[0].url, source.url);
  });

  it("does not turn malformed or truncated provider output into a draft", async () => {
    for (const [content, finishReason] of [["{broken", "stop"], [JSON.stringify(draft), "length"]]) {
      const generator = new NearAiLearningDraftGenerator({ fetch: async () => Response.json({ choices: [{ finish_reason: finishReason, message: { content } }] }) });
      await assert.rejects(generator.generate(input), (error: unknown) => error instanceof AppError && ["AI_DRAFT_INVALID", "AI_RESPONSE_INVALID"].includes(error.code));
    }
  });
});
