import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { before, beforeEach, after, test } from "node:test";
import pg from "pg";
import { verifyMessage, type Address } from "viem";
import { parseSiweMessage } from "viem/siwe";
import PgAdapter from "../../lib/pg-adapter";
import { getPool } from "../../lib/dbPool";
import { persistGoogleEmailVerification } from "../v2/oauth-verification";
import { getDatabasePool } from "../v2/repository-factory";
import { resetRateLimitsForTests } from "../v2/security";
import { BaseChainIndexer } from "./chain-indexer";
import { RpcBaseChainReader } from "./chain-reader";
import { chainFixture, encodeEscrowEvent, testHash } from "./chain.fixture";
import { BaseRewardIssuer } from "./issuer";
import { createParticipantHandlers } from "./participant-api";
import { ParticipantRecovery } from "./participant-recovery";
import { PostgresParticipantRepository } from "./participant-repository";
import { ReconciledBaseChainReader } from "./reconciled-chain-reader";
import { PostgresReviewRepository } from "./review-repository";
import { reviewFixture, rotatedTestSigner, testSigner } from "./workflow.fixture";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL must name disposable local PostgreSQL");
const url = new URL(connectionString);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Participant tests refuse nonlocal PostgreSQL");
const schema = `base_participant_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString, max: 1 });
url.searchParams.set("options", `-c search_path=${schema}`);
const pool = new pg.Pool({ connectionString: url.toString(), max: 16 });
const origin = "https://crossword.example.test";
const priorEnv = Object.fromEntries(["DATABASE_URL", "NEXTAUTH_URL", "BASE_PARTICIPANT_ENABLED", "BASE_CLAIM_ISSUANCE_ENABLED", "V2_DATABASE_SSL", "V2_TRUSTED_CLIENT_IP_HEADER", "V2_FUNDING_MODE", "NODE_ENV"].map((key) => [key, process.env[key]]));
let owner: string; let learner: string; let outsider: string; let unverified: string; let token: string; let otherToken: string;
const recipient = rotatedTestSigner.address.toLowerCase() as Address;
const answers = ["WALLET", "LEDGER", "TRANSFER"];
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (let pass = 0; pass < 2; pass++) {
    const migrated = spawnSync(process.execPath, ["scripts/migrate-v2.mjs"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 30000 });
    assert.equal(migrated.status, 0, "Participant migrations must succeed");
    assert.equal(migrated.stdout.split(pass ? "Already applied " : "Applied ").length - 1, 13);
  }
  Object.assign(process.env, { DATABASE_URL: url.toString(), NEXTAUTH_URL: origin, BASE_PARTICIPANT_ENABLED: "true", BASE_CLAIM_ISSUANCE_ENABLED: "false",
    V2_DATABASE_SSL: "disable", V2_TRUSTED_CLIENT_IP_HEADER: "x-real-ip", V2_FUNDING_MODE: "direct", NODE_ENV: "test" });
});
beforeEach(async () => {
  await pool.query("TRUNCATE users, base_learning_campaigns, base_chain_deployments CASCADE");
  const users = await pool.query("INSERT INTO users (email, email_verified) SELECT 'participant-' || n || '@example.test', CASE WHEN n < 4 THEN NOW() ELSE NULL END FROM generate_series(1, 4) n RETURNING id::TEXT");
  [owner, learner, outsider, unverified] = users.rows.map((row) => row.id);
  token = randomUUID(); otherToken = randomUUID();
  await pool.query("INSERT INTO sessions (user_id, session_token, expires) VALUES ($1, $2, NOW() + INTERVAL '1 hour'), ($3, $4, NOW() + INTERVAL '1 hour')", [learner, token, outsider, otherToken]);
  resetRateLimitsForTests();
});
after(async () => {
  await getDatabasePool().end(); await getPool().end(); await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
  for (const [key, value] of Object.entries(priorEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

async function setup() {
  const fixture = chainFixture(); fixture.logs.delete(11n); fixture.control.paidFrom = 99999n;
  const input = reviewFixture(); Object.assign(input.terms, { startsAt: fixture.base.startsAt, endsAt: fixture.base.endsAt, claimDeadline: fixture.base.claimDeadline });
  const reviews = new PostgresReviewRepository(pool);
  const draft = await reviews.create(owner, randomUUID(), input);
  const review = await reviews.approve(owner, draft.id, 1, draft.reviewHash, draft.termsHash);
  fixture.base.termsHash = review.termsHash;
  const terms = { rewardAtomic: fixture.base.rewardAtomic, maxClaims: fixture.base.maxClaims, startsAt: BigInt(fixture.base.startsAt),
    endsAt: BigInt(fixture.base.endsAt), claimDeadline: BigInt(fixture.base.claimDeadline), termsHash: review.termsHash, eligibilitySigner: fixture.base.signer };
  fixture.logs.set(10n, [encodeEscrowEvent("CampaignFunded", { campaignId: 1n, sponsor: fixture.base.sponsor, token: fixture.base.token, terms, fundedAtomic: 300000n, signerEpoch: 1n }, fixture.blocks.get(10n)!)]);
  const rpc = new RpcBaseChainReader(fixture.deployment, { fetch: fixture.fetcher, allowLocalChain: true });
  const chain = new ReconciledBaseChainReader(pool, rpc);
  const indexer = new BaseChainIndexer(pool, rpc); await indexer.sync();
  const wallet = { verifyWalletMessage: (input: { recipient: Address; message: string; signature: `0x${string}` }) => verifyMessage({ address: input.recipient, message: input.message, signature: input.signature }) };
  const repository = new PostgresParticipantRepository(pool, chain, wallet, origin);
  const recovery = new ParticipantRecovery(pool, chain);
  const signer = { address: testSigner.address, sign: (data: Parameters<typeof testSigner.signTypedData>[0]) => testSigner.signTypedData(data) };
  const issuer = new BaseRewardIssuer(pool, chain, repository, signer);
  await issuer.bindApprovedCampaign(owner, review.id, 1n);
  const handlers = createParticipantHandlers(() => ({ repository, recovery, issuer: () => issuer }));
  const context = { params: Promise.resolve({ id: review.id }) };
  const complete = (user = learner) => repository.complete(user, review.id, { revision: 1, answers });
  const challenge = (user = learner) => repository.challenge(user, review.id, { revision: 1, recipient });
  const proof = async () => {
    await complete(); const value = await challenge();
    return { challengeId: value.challengeId, signature: await rotatedTestSigner.signMessage({ message: value.message }) };
  };
  const issue = async () => issuer.issue({ campaignId: review.id, userId: learner, recipient, proof: await proof() });
  return { ...fixture, review, chain, indexer, repository, recovery, issuer, signer, wallet, handlers, context, complete, challenge, proof, issue };
}
function request(method: string, body?: unknown, session = token, from = origin) {
  return new Request(`${origin}/api/base/participants/example`, { method,
    headers: { cookie: `next-auth.session-token=${session}`, origin: from, "content-type": "application/json", "x-real-ip": "127.0.0.1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test("correct completion is durable and revision bound, without retaining answers or requiring email yet", async () => {
  const ctx = await setup();
  await assert.rejects(ctx.repository.complete(learner, ctx.review.id, { revision: 2, answers }), { status: 409 });
  await assert.rejects(ctx.repository.complete(learner, ctx.review.id, { revision: 1, answers: ["WRONG", "LEDGER", "TRANSFER"] }), { code: "COMPLETION_INCORRECT" });
  const results = await Promise.all(Array.from({ length: 8 }, () => ctx.complete()));
  assert.equal(new Set(results.map((r) => r.completedAt)).size, 1);
  await ctx.complete(unverified);
  await assert.rejects(ctx.challenge(unverified), { code: "VERIFIED_EMAIL_REQUIRED" });
  const rows = await pool.query("SELECT * FROM base_participant_completions");
  assert.equal(rows.rowCount, 2); assert.doesNotMatch(JSON.stringify(rows.rows), /WALLET|LEDGER|TRANSFER|answers/);
  const recovery = await ctx.recovery.get(learner, ctx.review.id);
  assert.equal(recovery.status, "NOT_ALLOCATED"); assert.equal(recovery.completed, true);
});

test("wallet challenges bind account, campaign, revision, recipient, origin and expiry", async () => {
  const ctx = await setup();
  await assert.rejects(ctx.challenge(), { code: "COMPLETION_REQUIRED" });
  await ctx.complete(); const challenge = await ctx.challenge();
  const message = parseSiweMessage(challenge.message);
  assert.equal(message.domain, new URL(origin).host); assert.equal(message.chainId, 31337);
  assert.ok(message.resources?.includes(`urn:crossword:campaign:${ctx.review.id}:revision:1`));
  assert.doesNotMatch(challenge.message, /participant-.*@example.test/);
  const signature = await rotatedTestSigner.signMessage({ message: challenge.message });
  const input = { campaignId: ctx.review.id, revision: 1, userId: learner, recipient, proof: { challengeId: challenge.challengeId, signature } };
  for (const patch of [{ userId: outsider }, { campaignId: randomUUID() }, { revision: 2 }, { recipient: testSigner.address }]) {
    await assert.rejects(ctx.repository.verify({ ...input, ...patch }, AbortSignal.timeout(1000)));
  }
  await assert.rejects(ctx.repository.verify({ ...input, proof: { ...input.proof, signature: await testSigner.signMessage({ message: challenge.message }) } }, AbortSignal.timeout(1000)));
  const otherOrigin = new PostgresParticipantRepository(pool, ctx.chain, ctx.wallet, "https://other.example.test");
  await assert.rejects(otherOrigin.verify(input, AbortSignal.timeout(1000)));
  const first = await ctx.repository.verify(input, AbortSignal.timeout(1000));
  const retries = await Promise.all(Array.from({ length: 6 }, () => ctx.repository.verify(input, AbortSignal.timeout(10000))));
  assert.ok(retries.every((r) => r.receiptId === first.receiptId));
  const stored = await pool.query("SELECT * FROM base_participant_eligibility");
  assert.equal(stored.rowCount, 1); assert.doesNotMatch(JSON.stringify(stored.rows), new RegExp(signature.slice(2)));
  await pool.query("UPDATE base_wallet_challenges SET created_at = NOW() - INTERVAL '6 minutes', expires_at = NOW() - INTERVAL '1 minute'");
  await assert.rejects(ctx.repository.verify(input, AbortSignal.timeout(1000)), { code: "WALLET_PROOF_REQUIRED" });
});

test("wallet expiry or failed verification allocates nothing; lost signing responses recover the original tuple", async () => {
  const ctx = await setup(); const proof = await ctx.proof();
  const input = { campaignId: ctx.review.id, userId: learner, recipient, proof };
  await assert.rejects(ctx.issuer.issue({ ...input, proof: { completed: true, walletVerified: true } }), { code: "BASE_ELIGIBILITY_REQUIRED" });
  assert.equal((await pool.query("SELECT * FROM base_reward_allocations")).rowCount, 0);
  ctx.signer.sign = async () => { throw new Error("NEVER_PRINT_SIGNER_SECRET"); };
  await assert.rejects(ctx.issuer.issue(input), { code: "BASE_SIGNING_UNAVAILABLE" });
  assert.equal((await ctx.recovery.get(learner, ctx.review.id)).status, "RECOVERABLE");
  assert.equal((await ctx.recovery.get(outsider, ctx.review.id)).status, "NOT_ALLOCATED");
  await assert.rejects(ctx.repository.challenge(learner, ctx.review.id, { revision: 1, recipient: testSigner.address }), { status: 409 });
  ctx.signer.sign = (data) => testSigner.signTypedData(data);
  const recovered = await ctx.issuer.issue(input);
  assert.deepEqual(await ctx.issuer.issue(input), recovered);
  const records = await pool.query("SELECT a.eligibility_receipt, e.id FROM base_reward_allocations a JOIN base_participant_eligibility e ON e.id = a.eligibility_receipt");
  assert.equal(records.rowCount, 1);
});

test("only finalized matching RewardPaid events recover as paid; HTTP retries return the receipt without signing", async () => {
  const ctx = await setup(); const authorized = await ctx.issue(); const claim = authorized.typedData.message;
  const block = ctx.blocks.get(11n)!;
  // Reorg the previously empty unfinalized block to introduce the synthetic payment.
  block.hash = testHash(1011); ctx.blocks.get(12n)!.parentHash = block.hash; ctx.blocks.get(12n)!.hash = testHash(1012);
  ctx.logs.set(11n, [encodeEscrowEvent("RewardPaid", { campaignId: 1n, slot: claim.slot, participantId: claim.participantId, recipient, amount: 100000n }, block)]);
  ctx.control.paidFrom = 11n;
  assert.equal((await ctx.indexer.sync()).state, "CATCHING_UP");
  await assert.rejects(ctx.recovery.get(learner, ctx.review.id), { code: "BASE_ACCOUNTING_NOT_READY" });
  assert.equal((await ctx.indexer.sync()).state, "HEALTHY");
  assert.equal((await ctx.recovery.get(learner, ctx.review.id)).status, "RECOVERABLE");
  ctx.control.finalized = 11n; await ctx.indexer.sync();
  const paid = await ctx.recovery.get(learner, ctx.review.id);
  assert.equal(paid.status, "PAID"); assert.ok("receipt" in paid); assert.equal(paid.receipt?.blockHash, block.hash);
  const privateGet = await ctx.handlers.recovery(request("GET"), ctx.context);
  assert.equal(privateGet.status, 200); assert.equal(privateGet.headers.get("cache-control"), "no-store");
  const body = await privateGet.json(); assert.equal(body.status, "PAID");
  assert.doesNotMatch(JSON.stringify(body), /signature|typedData|participantId|eligibility_receipt|@example.test|WALLET/);
  ctx.signer.sign = async () => { throw new Error("Paid recovery must not sign"); };
  const replay = await ctx.handlers.claim(request("POST", { recipient, proof: { challengeId: randomUUID(), signature: "0xab" } }), ctx.context);
  assert.equal(replay.status, 200); assert.equal((await replay.json()).status, "PAID");
  await pool.query("UPDATE base_chain_deployments SET state = 'HALTED', failure_code = 'BASE_FINALITY_CONFLICT'");
  await assert.rejects(ctx.recovery.get(learner, ctx.review.id), { code: "BASE_ACCOUNTING_NOT_READY" });
});

test("receipt recovery fails closed on wrong recipient, orphaned evidence or stale ledger", async () => {
  const ctx = await setup(); const issued = await ctx.issue();
  const block = ctx.blocks.get(11n)!; block.hash = testHash(2011); ctx.blocks.get(12n)!.parentHash = block.hash; ctx.blocks.get(12n)!.hash = testHash(2012);
  ctx.logs.set(11n, [encodeEscrowEvent("RewardPaid", { campaignId: 1n, slot: 0, participantId: issued.typedData.message.participantId, recipient: testSigner.address, amount: 100000n }, block)]);
  ctx.control.paidFrom = 11n; ctx.control.finalized = 11n; await ctx.indexer.sync();
  assert.equal((await ctx.indexer.sync()).state, "HEALTHY");
  await assert.rejects(ctx.recovery.get(learner, ctx.review.id), { code: "BASE_ACCOUNTING_NOT_READY" });
  await pool.query("UPDATE base_chain_blocks SET canonical = FALSE, orphaned_at = NOW() WHERE block_hash = $1", [block.hash]);
  await assert.rejects(ctx.recovery.get(learner, ctx.review.id), { code: "BASE_ACCOUNTING_NOT_READY" });
  await pool.query("UPDATE base_chain_deployments SET checked_at = NOW() - INTERVAL '61 seconds'");
  await assert.rejects(ctx.recovery.get(learner, ctx.review.id), { code: "BASE_ACCOUNTING_NOT_READY" });
});

test("optional contact consent is isolated, withdrawable, versioned and never required for rewards", async () => {
  const ctx = await setup(); await ctx.issue();
  assert.deepEqual((await ctx.recovery.get(learner, ctx.review.id)).consent, { version: 0, shareEmail: false });
  const preference = { expectedVersion: 0, shareEmail: true };
  const first = await ctx.repository.consent(learner, ctx.review.id, preference);
  assert.deepEqual(first, { version: 1, shareEmail: true });
  assert.deepEqual(await ctx.repository.consent(learner, ctx.review.id, preference), first);
  assert.deepEqual((await ctx.recovery.get(outsider, ctx.review.id)).consent, { version: 0, shareEmail: false });
  await pool.query("UPDATE users SET email = 'changed@example.test' WHERE id = $1", [learner]);
  assert.equal((await ctx.recovery.get(learner, ctx.review.id)).consent.shareEmail, false);
  await assert.rejects(ctx.repository.consent(learner, ctx.review.id, { expectedVersion: 0, shareEmail: false }), { status: 409 });
  await ctx.repository.consent(learner, ctx.review.id, { expectedVersion: 1, shareEmail: false });
  assert.equal((await pool.query("SELECT * FROM base_participant_consent_events")).rowCount, 2);
  await assert.rejects(ctx.repository.consent(unverified, ctx.review.id, preference), { code: "VERIFIED_EMAIL_REQUIRED" });
});

test("participant HTTP handlers reject unauthenticated, cross-origin, oversized, invalid and rate-limited requests", async () => {
  const ctx = await setup(); const input = { revision: 1, answers };
  assert.equal((await ctx.handlers.complete(request("POST", input, "missing"), ctx.context)).status, 401);
  assert.equal((await ctx.handlers.complete(request("POST", input, token, "https://elsewhere.test"), ctx.context)).status, 403);
  const crossSite = request("POST", input); crossSite.headers.set("sec-fetch-site", "cross-site");
  assert.equal((await ctx.handlers.complete(crossSite, ctx.context)).status, 403);
  const wrongType = request("POST", input); wrongType.headers.set("content-type", "text/plain");
  assert.equal((await ctx.handlers.complete(wrongType, ctx.context)).status, 415);
  assert.equal((await ctx.handlers.complete(request("POST", { answers: "secret".repeat(4000) }), ctx.context)).status, 413);
  assert.equal((await ctx.handlers.complete(request("POST", { ...input, userId: outsider }), ctx.context)).status, 400);
  resetRateLimitsForTests(); await pool.query("TRUNCATE v2_rate_limit_buckets");
  for (let i = 0; i < 20; i++) assert.equal((await ctx.handlers.complete(request("POST", { ...input, answers: ["WRONG", "LEDGER", "TRANSFER"] }), ctx.context)).status, 422);
  assert.equal((await ctx.handlers.complete(request("POST", input), ctx.context)).status, 429);
  process.env.BASE_PARTICIPANT_ENABLED = "false";
  assert.equal((await ctx.handlers.recovery(request("GET"), ctx.context)).status, 404);
  process.env.BASE_PARTICIPANT_ENABLED = "true";
});

test("authenticated completion/challenge/claim HTTP flow authorizes once and isolates another session", async () => {
  const ctx = await setup();
  const completed = await ctx.handlers.complete(request("POST", { revision: 1, answers }), ctx.context);
  assert.equal(completed.status, 200); assert.equal((await completed.json()).status, "COMPLETED");
  const challenged = await ctx.handlers.challenge(request("POST", { revision: 1, recipient }), ctx.context);
  assert.equal(challenged.status, 200);
  const challenge = await challenged.json();
  const signature = await rotatedTestSigner.signMessage({ message: challenge.message });
  const body = { recipient, proof: { challengeId: challenge.challengeId, signature } };
  const wrongSession = await ctx.handlers.claim(request("POST", body, otherToken), ctx.context);
  assert.equal(wrongSession.status, 403);
  const first = await ctx.handlers.claim(request("POST", body), ctx.context);
  assert.equal(first.status, 200); assert.equal(first.headers.get("cache-control"), "no-store");
  const issued = await first.json(); assert.equal(issued.status, "AUTHORIZED");
  assert.deepEqual(await (await ctx.handlers.claim(request("POST", body), ctx.context)).json(), issued);
  const own = await (await ctx.handlers.recovery(request("GET"), ctx.context)).json();
  const other = await (await ctx.handlers.recovery(request("GET", undefined, otherToken), ctx.context)).json();
  assert.equal(own.status, "RECOVERABLE"); assert.equal(other.status, "NOT_ALLOCATED");
  assert.equal(other.allocationId, undefined); assert.equal(own.signature, undefined);
  assert.equal((await pool.query("SELECT * FROM base_reward_allocations")).rowCount, 1);
});

test("Google sign-in persists verification only for the server-verified email and linked subject", async () => {
  const email = (await pool.query("SELECT email FROM users WHERE id = $1", [unverified])).rows[0].email;
  const event = { user: { id: unverified, email }, account: { provider: "google", providerAccountId: "google-subject" }, profile: { sub: "google-subject", email, email_verified: true } };
  await persistGoogleEmailVerification(pool, event);
  assert.equal((await pool.query("SELECT email_verified FROM users WHERE id = $1", [unverified])).rows[0].email_verified, null);
  await pool.query("INSERT INTO accounts (user_id, provider, type, provider_account_id) VALUES ($1, 'google', 'oauth', 'google-subject')", [unverified]);
  await persistGoogleEmailVerification(pool, { ...event, profile: { ...event.profile, email: "another@example.test" } });
  assert.equal((await pool.query("SELECT email_verified FROM users WHERE id = $1", [unverified])).rows[0].email_verified, null);
  await persistGoogleEmailVerification(pool, event);
  const verified = (await pool.query("SELECT email_verified FROM users WHERE id = $1", [unverified])).rows[0].email_verified;
  assert.ok(verified); await persistGoogleEmailVerification(pool, event);
  assert.deepEqual((await pool.query("SELECT email_verified FROM users WHERE id = $1", [unverified])).rows[0].email_verified, verified);
});

test("NextAuth adapter clears verification on email change and preserves it on unrelated updates", async () => {
  const adapter = PgAdapter();
  const original = await adapter.getUser(learner);
  assert.ok(original);
  assert.ok(original.emailVerified);
  const changed = await adapter.updateUser({ id: learner, email: "new-address@example.test", name: undefined, image: undefined, emailVerified: undefined });
  assert.equal(changed.emailVerified, null);
  const verifiedAt = new Date();
  const verified = await adapter.updateUser({ id: learner, email: undefined, name: undefined, image: undefined, emailVerified: verifiedAt });
  assert.deepEqual(verified.emailVerified, verifiedAt);
  const updated = await adapter.updateUser({ id: learner, email: undefined, name: "Participant", image: undefined, emailVerified: undefined });
  assert.deepEqual(updated.emailVerified, verifiedAt);
});
