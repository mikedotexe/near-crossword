import assert from "node:assert/strict";
import { test } from "node:test";
import { assertReviewRequest, parseReviewApproval, parseReviewUpdate } from "./review-api";
import { parseReviewSubmission, realUserId, reviewMaterial, validId } from "./review";
import { reviewFixture } from "./workflow.fixture";
import termsFixture from "./fixtures/terms-v1.json";
const campaignId = "10000000-0000-4000-8000-000000000001";

test("public terms commit only public content, with deterministic key order after JSONB storage", () => {
  const input = reviewFixture(1800000000);
  const result = reviewMaterial(input, 1, campaignId);
  assert.deepEqual(result.publicTerms, termsFixture.publicTerms);
  assert.equal(result.termsHash, termsFixture.termsHash);
  const reordered = JSON.parse(JSON.stringify(input), (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).reverse());
    return value;
  });
  assert.deepEqual(reviewMaterial(reordered, 1, campaignId), result);
  const publicJSON = JSON.stringify({ content: result.publicContent, terms: result.publicTerms, termsHash: result.termsHash });
  for (const privateValue of ["WALLET", "LEDGER", "TRANSFER", "sourceManifest", "quote", "reviewHash", "email_verified"]) {
    assert.ok(!publicJSON.includes(privateValue));
  }
  assert.equal(result.publicTerms.version, "base-learning-terms:v1");
  assert.equal(result.sourceManifest[0].sha256.length, 64);
  assert.notEqual(reviewMaterial(input, 2, campaignId).termsHash, result.termsHash);
  assert.notEqual(reviewMaterial(input, 1, "10000000-0000-4000-8000-000000000002").termsHash, result.termsHash);
  input.source.sources[0].text += " Additional private source context.";
  assert.notEqual(reviewMaterial(input, 1, campaignId).reviewHash, result.reviewHash);
  assert.equal(reviewMaterial(input, 1, campaignId).termsHash, result.termsHash);
});

test("review validation rejects injected approval, bad evidence, wrong token, unsafe values and timestamps", () => {
  const input = reviewFixture();
  assert.throws(() => parseReviewSubmission({ ...input, approved: true }));
  assert.throws(() => parseReviewSubmission({ ...input, draft: { ...input.draft, reward: 1000 } }));
  input.draft.entries[0].evidence[0].quote = "This quote was never in the supplied source.";
  assert.throws(() => parseReviewSubmission(input), { code: "INVALID_REVIEW_DRAFT" });
  for (const terms of [
    { chainId: 8453 }, { rewardAtomic: "0" }, { rewardAtomic: "01" }, { rewardAtomic: (1n << 256n).toString() },
    { rewardAtomic: ((1n << 256n) - 1n).toString() }, { endsAt: 1 }, { maxClaims: 2 ** 32 },
    { sponsor: input.terms.escrow }, { escrow: "0x0000000000000000000000000000000000000000" },
    { claimDeadline: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    const valid = reviewFixture();
    assert.throws(() => parseReviewSubmission({ ...valid, terms: { ...valid.terms, ...terms } }));
  }
});

test("review request guard is off by default and protects cookie-authenticated mutations", () => {
  const previous = { enabled: process.env.BASE_REVIEW_ENABLED, url: process.env.NEXTAUTH_URL };
  try {
    delete process.env.BASE_REVIEW_ENABLED;
    assert.throws(() => assertReviewRequest(new Request("https://crossword.xyz/api/base/reviews")), { status: 404 });
    process.env.BASE_REVIEW_ENABLED = "true";
    process.env.NEXTAUTH_URL = "https://crossword.xyz";
    for (const origin of [undefined, "https://elsewhere.test", "https://crossword.xyz.evil.test", "null"]) {
      assert.throws(() => assertReviewRequest(new Request("https://crossword.xyz/api/base/reviews", {
        method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      })), { status: 403 });
    }
    assert.throws(() => assertReviewRequest(new Request("https://crossword.xyz/api/base/reviews", {
      method: "POST", headers: { origin: "https://crossword.xyz", "content-type": "text/plain" },
    })), { status: 415 });
    assert.doesNotThrow(() => assertReviewRequest(new Request("https://crossword.xyz/api/base/reviews", {
      method: "POST", headers: { origin: "https://crossword.xyz", "content-type": "application/json; charset=utf-8" },
    })));
    assert.doesNotThrow(() => assertReviewRequest(new Request("https://crossword.xyz/api/base/reviews")));
  } finally {
    if (previous.enabled === undefined) delete process.env.BASE_REVIEW_ENABLED; else process.env.BASE_REVIEW_ENABLED = previous.enabled;
    if (previous.url === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = previous.url;
  }
});

test("review identifiers and optimistic-approval payloads fail closed", () => {
  for (const id of ["demo:1", "0", "-1", "9223372036854775808", "1 OR 1=1"]) assert.throws(() => realUserId(id));
  assert.equal(realUserId("1"), "1");
  assert.throws(() => validId("not-an-id"));
  assert.throws(() => parseReviewUpdate({ expectedRevision: 1, submission: {}, approved: true }));
  assert.throws(() => parseReviewApproval({ revision: 1, termsHash: `0x${"ab".repeat(32)}` }));
  assert.equal(parseReviewUpdate({ expectedRevision: 1, submission: {} }).expectedRevision, 1);
});
