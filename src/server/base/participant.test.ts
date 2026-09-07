import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { parseSiweMessage } from "viem/siwe";
import { createSiweMessage } from "viem/siwe";
import { persistGoogleEmailVerification } from "../v2/oauth-verification";
import { participantSignerFromEnvironment, readParticipantJson } from "./participant-api";
import { challengeSchema, claimSchema, completionSchema, consentSchema, correctAnswers, participantInput, participantOrigin } from "./participant-input";
import { testSigner } from "./workflow.fixture";

test("participant input is bounded, strict and compares the whole ordered answer set", () => {
  const input = participantInput(completionSchema, { revision: 1, answers: [" wallet ", "Ledger", "TRANSFER"] });
  assert.deepEqual(input.answers, ["WALLET", "LEDGER", "TRANSFER"]);
  assert.equal(correctAnswers(input.answers, ["WALLET", "LEDGER", "TRANSFER"]), true);
  assert.equal(correctAnswers(input.answers, ["LEDGER", "WALLET", "TRANSFER"]), false);
  for (const raw of [ { ...input, completed: true }, { ...input, answers: ["WALLET"] }, { ...input, answers: ["SECRET".repeat(9), "ABC", "DEF"] }, { ...input, revision: 0 }, { ...input, answers: ["WAL LET", "ABC", "DEF"] } ]) {
    assert.throws(() => participantInput(completionSchema, raw), { code: "INVALID_PARTICIPANT_REQUEST" });
  }
  assert.throws(() => participantInput(challengeSchema, { revision: 1, recipient: `0x${"00".repeat(20)}` }));
  assert.throws(() => participantInput(claimSchema, { recipient: testSigner.address, proof: { walletVerified: true } }));
  assert.throws(() => participantInput(consentSchema, { expectedVersion: 0, shareEmail: "true" }));
});

test("stream limits reject chunked bodies without Content-Length and sanitize malformed JSON", async () => {
  const request = (body: string) => new Request("https://example.test", { method: "POST", body });
  assert.deepEqual(await readParticipantJson(request('{"revision":1}')), { revision: 1 });
  await assert.rejects(readParticipantJson(request("x".repeat(16385))), { status: 413 });
  await assert.rejects(readParticipantJson(request("secret-private-answer")), { code: "INVALID_JSON", message: "Request body must be valid JSON" });
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < 20; i++) controller.enqueue(new Uint8Array(1024)); controller.close(); } });
  const chunked = new Request("https://example.test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readParticipantJson(chunked), { status: 413 });
});

test("participant origins and independent signer gate fail closed", () => {
  for (const value of ["", "ftp://example.test", "https://user:secret@example.test", "http://example.test", "https://example.test/?secret=x"]) {
    assert.throws(() => participantOrigin(value), { code: "BASE_PARTICIPANT_UNAVAILABLE" });
  }
  assert.equal(participantOrigin("https://crossword.xyz"), "https://crossword.xyz");
  const enabled = process.env.BASE_CLAIM_ISSUANCE_ENABLED; const key = process.env.BASE_ELIGIBILITY_PRIVATE_KEY;
  try {
    process.env.BASE_CLAIM_ISSUANCE_ENABLED = "false"; process.env.BASE_ELIGIBILITY_PRIVATE_KEY = `0x${"11".repeat(32)}`;
    assert.throws(participantSignerFromEnvironment, { code: "BASE_ISSUANCE_UNAVAILABLE" });
    process.env.BASE_CLAIM_ISSUANCE_ENABLED = "true";
    assert.equal(participantSignerFromEnvironment().address, testSigner.address);
    process.env.BASE_ELIGIBILITY_PRIVATE_KEY = "NEVER_PRINT";
    assert.throws(participantSignerFromEnvironment, { code: "BASE_ISSUANCE_UNAVAILABLE", message: "Reward signing is not enabled and configured" });
  } finally {
    if (enabled === undefined) delete process.env.BASE_CLAIM_ISSUANCE_ENABLED; else process.env.BASE_CLAIM_ISSUANCE_ENABLED = enabled;
    if (key === undefined) delete process.env.BASE_ELIGIBILITY_PRIVATE_KEY; else process.env.BASE_ELIGIBILITY_PRIVATE_KEY = key;
  }
});

test("SIWE encoder preserves domain, chain, purpose and opaque resources", () => {
  const message = createSiweMessage({ address: testSigner.address, domain: "crossword.xyz", chainId: 8453,
    nonce: "a".repeat(64), uri: "https://crossword.xyz/api/base/participants/example/claim", version: "1", resources: ["urn:uuid:example"],
    issuedAt: new Date("2026-09-04T00:00:00Z"), expirationTime: new Date("2026-09-04T00:05:00Z") });
  const parsed = parseSiweMessage(message);
  assert.equal(parsed.chainId, 8453); assert.equal(parsed.domain, "crossword.xyz");
  assert.deepEqual(parsed.resources, ["urn:uuid:example"]);
});

test("Google verification ignores client flags, unverified, mismatched and foreign-provider profiles", async () => {
  let called = 0;
  const pool = { query: async () => { called++; } } as unknown as Pool;
  const valid = { user: { id: "1", email: "learner@example.test" }, account: { provider: "google", providerAccountId: "subject" },
    profile: { sub: "subject", email: "learner@example.test", email_verified: true } };
  for (const event of [{ completed: true }, { ...valid, profile: { ...valid.profile, email_verified: false } },
    { ...valid, profile: { ...valid.profile, sub: "someone-else" } }, { ...valid, profile: { ...valid.profile, email: "other@example.test" } },
    { ...valid, account: { ...valid.account, provider: "credentials" } }]) await persistGoogleEmailVerification(pool, event);
  assert.equal(called, 0);
  await persistGoogleEmailVerification(pool, valid); assert.equal(called, 1);
});
