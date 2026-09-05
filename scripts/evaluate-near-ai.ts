import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { z } from "zod";
import { NearAiLearningDraftGenerator } from "../src/server/v2/learning-draft";
import { learningSourceFixture } from "../src/server/v2/learning-draft.fixture";
import { AppError } from "../src/server/v2/errors";

async function main() {
  const { values } = parseArgs({ options: {
    "env-file": { type: "string" },
    model: { type: "string" },
    "base-url": { type: "string" },
  } });
  if (values["env-file"]) {
    const env = dotenv.parse(readFileSync(values["env-file"]));
    for (const key of ["NEAR_AI_API_KEY", "NEAR_AI_BASE_URL", "V2_AI_MODEL"]) {
      if (env[key] && !process.env[key]) process.env[key] = env[key];
    }
  }
  if (values.model) process.env.V2_AI_MODEL = values.model;
  if (values["base-url"]) process.env.NEAR_AI_BASE_URL = values["base-url"];
  const start = Date.now();
  const draft = await new NearAiLearningDraftGenerator({ fetch: async (url, init) => {
    const response = await fetch(url, init);
    const requestId = z.string().uuid().safeParse(response.headers.get("x-request-id"));
    const inferenceId = z.string().uuid().safeParse(response.headers.get("inference-id"));
    console.log(JSON.stringify({
      phase: "headers", status: response.status, elapsedMs: Date.now() - start,
      serverRequestId: requestId.success ? requestId.data : null,
      inferenceId: inferenceId.success ? inferenceId.data : null,
    }));
    return response;
  } }).generate(learningSourceFixture);
  // One paid-provider request using only synthetic source text. Never print keys, drafts, or reasoning.
  console.log(JSON.stringify({
    ok: true, model: draft.model, elapsedMs: Date.now() - start, usage: draft.usage,
    sourceCount: draft.sourceManifest.length, paragraphs: draft.paragraphs.length,
    entries: draft.entries.length, reviewStatus: draft.reviewStatus,
    sourceValidation: "passed", qualityReview: "not performed",
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error instanceof AppError ? error.code : "EVALUATION_FAILED" }));
  process.exitCode = 1;
});
