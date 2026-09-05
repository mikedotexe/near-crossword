import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import pg from "pg";
import { setTimeout as sleep } from "node:timers/promises";
import type { Address } from "viem";
import { GET as listReviews, POST as createReview } from "../../../app/api/base/reviews/route";
import { GET as getReview, PUT as updateReview } from "../../../app/api/base/reviews/[id]/route";
import { POST as approveReview } from "../../../app/api/base/reviews/[id]/approve/route";
import { getDatabasePool } from "../v2/repository-factory";
import { BaseRewardIssuer, type BaseChainReader, type BaseClaimSigner, type EligibilityVerifier, type FinalizedCampaignState } from "./issuer";
import { PostgresReviewRepository, type PrivateReview } from "./review-repository";
import { recipient, reviewFixture, rotatedTestSigner, testSigner } from "./workflow.fixture";
import { LearningPublication } from "./publication";
import { PostgresParticipantRepository } from "./participant-repository";
import { publicationHandlers } from "./publication-api";
import { ClaimSponsorship } from "./sponsorship";
import { gasPolicy, gasRequest, gasResult } from "./sponsorship.fixture";
import { claimCall } from "../../lib/base/account";
import { createSponsorshipHandlers } from "./sponsorship-api";
import type { SponsorshipRequest } from "./sponsorship-policy";

test("publication requires owner approval, exact layout and finalized funding; public fields exclude private evidence", async () => {
  const ctx = await setup(); const publication = new LearningPublication(pool, ctx.reader);
  const preview = await publication.preview(owner, ctx.review.id);
  assert.equal(preview.approved, false);
  await assert.rejects(publication.preview(outsider, ctx.review.id), { status: 404 });
  await assert.rejects(publication.approveLayout(owner, ctx.review.id, { ...preview, revision: 2 }), { status: 409 });
  await assert.rejects(publication.publish(owner, ctx.review.id, preview));
  await publication.approveLayout(owner, ctx.review.id, preview);
  await assert.rejects(publication.publish(owner, ctx.review.id, preview));
  await ctx.issuer.bindApprovedCampaign(owner, ctx.review.id, ctx.state.onChainId, preview);
  const results = await Promise.all(Array.from({ length: 5 }, () => publication.publish(owner, ctx.review.id, preview)));
  assert.equal(new Set(results.map((r) => r.publicationHash)).size, 1);
  const publicView = await publication.get(ctx.review.id);
  assert.equal(publicView.availability, "OPEN"); assert.equal(publicView.remainingSlots, 3);
  assert.equal(publicView.termsHash, ctx.review.termsHash);
  assert.doesNotMatch(JSON.stringify(publicView), /WALLET|LEDGER|TRANSFER|sourceId|quote|reviewHash|sourceManifest|submission|email/);
  assert.ok((await publication.list()).some((l) => l.id === ctx.review.id));
  ctx.state.observedAt -= 61;
  await assert.rejects(publication.get(ctx.review.id), { status: 409 });
  await assert.rejects(publication.publish(owner, ctx.review.id, preview), { status: 409 });
});

test("withdrawal blocks new completions and allocations but preserves an existing allocation and immutable publication", async () => {
  const ctx = await setup(); const publication = new LearningPublication(pool, ctx.reader);
  const preview = await publication.preview(owner, ctx.review.id);
  await publication.approveLayout(owner, ctx.review.id, preview); await ctx.bind(); await publication.publish(owner, ctx.review.id, preview);
  const issuer = new BaseRewardIssuer(pool, ctx.reader, ctx.eligibility, ctx.signer, true);
  const input = { campaignId: ctx.review.id, userId: learners[0], recipient, proof: "TEST_ONLY_VERIFIED" };
  const issued = await issuer.issue(input);
  await publication.withdraw(owner, ctx.review.id, preview);
  assert.equal((await publication.list()).some((l) => l.id === ctx.review.id), false);
  await assert.rejects(publication.get(ctx.review.id), { status: 404 });
  assert.equal((await issuer.issue(input)).allocationId, issued.allocationId);
  await assert.rejects(issuer.issue({ ...input, userId: learners[1] }), { status: 409 });
  const participants = new PostgresParticipantRepository(pool, ctx.reader, { verifyWalletMessage: async () => true }, "https://crossword.example.test", true);
  await assert.rejects(participants.complete(learners[1], ctx.review.id, { revision: 1, answers: ["WALLET", "LEDGER", "TRANSFER"] }), { status: 409 });
  await publication.publish(owner, ctx.review.id, preview);
  assert.equal((await publication.get(ctx.review.id)).remainingSlots, 2);
  await participants.complete(learners[1], ctx.review.id, { revision: 1, answers: ["WALLET", "LEDGER", "TRANSFER"] });
  await assert.rejects(reviews.revise(owner, ctx.review.id, 1, reviewFixture()), { status: 409 });
  assert.equal((await pool.query("SELECT COUNT(*) FROM base_learning_publications WHERE campaign_id = $1", [ctx.review.id])).rows[0].count, "1");
});

test("review revisions cannot inherit layout approval or race old layout expectations into funding", async () => {
  const ctx = await setup(); const publication = new LearningPublication(pool, ctx.reader);
  const preview = await publication.preview(owner, ctx.review.id);
  await publication.approveLayout(owner, ctx.review.id, preview);
  const changed = reviewFixture(); changed.draft.title = "A revised private lesson";
  const revision = await reviews.revise(owner, ctx.review.id, 1, changed);
  assert.equal((await publication.preview(owner, ctx.review.id)).approved, false);
  await assert.rejects(publication.approveLayout(owner, ctx.review.id, preview), { status: 409 });
  await reviews.approve(owner, revision.id, revision.revision, revision.reviewHash, revision.termsHash);
  await assert.rejects(ctx.issuer.bindApprovedCampaign(owner, ctx.review.id, ctx.state.onChainId, preview), { status: 409 });
});

// Never fall back to DATABASE_URL. Each run owns only its random, isolated schema.
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL must name a disposable local PostgreSQL target");
const url = new URL(connectionString);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Integration tests require a local PostgreSQL target");
const schema = `base_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString, max: 1 });
url.searchParams.set("options", `-c search_path=${schema}`);
const pool = new pg.Pool({ connectionString: url.toString(), max: 16 });
const reviews = new PostgresReviewRepository(pool);
let owner: string;
let outsider: string;
let learners: string[];
let unverified: string;
let onChainSequence = 1n;
const previousEnv = Object.fromEntries(["DATABASE_URL", "BASE_REVIEW_ENABLED", "BASE_PARTICIPANT_ENABLED", "BASE_PAYMASTER_PROXY_ENABLED", "BASE_SPONSORED_GAS_ENABLED", "NEXTAUTH_URL", "V2_DATABASE_SSL", "V2_TRUSTED_CLIENT_IP_HEADER"].map((key) => [key, process.env[key]]));
let httpPoolOpened = false;

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (let pass = 0; pass < 2; pass++) {
    const migrated = spawnSync(process.execPath, ["scripts/migrate-v2.mjs"], {
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 30000,
    });
    assert.equal(migrated.status, 0, "Isolated migration run must succeed");
    assert.equal(migrated.stdout.split(pass === 0 ? "Applied " : "Already applied ").length - 1, 13);
  }
  const result = await pool.query(
    `INSERT INTO users (email, email_verified)
     SELECT 'base-test-' || n || '@example.test', CASE WHEN n < 20 THEN NOW() ELSE NULL END
     FROM generate_series(1, 20) n RETURNING id::TEXT`,
  );
  [owner, outsider, ...learners] = result.rows.slice(0, 19).map((row) => row.id);
  unverified = result.rows[19].id;
  process.env.DATABASE_URL = url.toString();
  process.env.BASE_REVIEW_ENABLED = "true";
  process.env.NEXTAUTH_URL = "https://crossword.example.test";
  process.env.V2_DATABASE_SSL = "disable";
  process.env.V2_TRUSTED_CLIENT_IP_HEADER = "x-real-ip";
});

after(async () => {
  if (httpPoolOpened) await getDatabasePool().end();
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

async function approve(input = reviewFixture()): Promise<PrivateReview> {
  const draft = await reviews.create(owner, randomUUID(), input);
  return reviews.approve(owner, draft.id, draft.revision, draft.reviewHash, draft.termsHash);
}

async function setup(input = reviewFixture()) {
  const review = await approve(input);
  const terms = review.submission.terms;
  const now = Math.floor(Date.now() / 1000);
  const state: FinalizedCampaignState = {
    chainId: terms.chainId, escrow: terms.escrow as Address, onChainId: onChainSequence++,
    token: terms.token as Address, sponsor: terms.sponsor as Address,
    rewardAtomic: BigInt(terms.rewardAtomic), maxClaims: terms.maxClaims,
    startsAt: terms.startsAt, endsAt: terms.endsAt, claimDeadline: terms.claimDeadline,
    termsHash: review.termsHash, fundedAtomic: BigInt(terms.rewardAtomic) * BigInt(terms.maxClaims),
    outstandingAtomic: BigInt(terms.rewardAtomic) * BigInt(terms.maxClaims), refundedAtomic: 0n, paidCount: 0,
    signer: testSigner.address, signerEpoch: 1n, paused: false, closed: false,
    blockHash: `0x${"aa".repeat(32)}`, blockNumber: 42n, blockTimestamp: now, observedAt: now,
  };
  const use = { slotUsed: false, participantUsed: false };
  const reader: BaseChainReader = {
    maxFinalizedLagSeconds: 300,
    readFinalizedCampaign: async () => structuredClone(state),
    readClaimUse: async (_binding, _claim, blockHash) => { assert.equal(blockHash, state.blockHash); return { ...use }; },
  };
  const eligibility: EligibilityVerifier = {
    verify: async (request) => {
      assert.equal(request.campaignId, review.id);
      assert.equal(request.revision, review.revision);
      if (request.proof !== "TEST_ONLY_VERIFIED") throw new Error("private wallet/answer material");
      return { receiptId: randomUUID() };
    },
  };
  const signer: BaseClaimSigner = { address: testSigner.address, sign: (data) => testSigner.signTypedData(data) };
  const issuer = new BaseRewardIssuer(pool, reader, eligibility, signer);
  return {
    review, state, use, reader, eligibility, signer, issuer,
    bind: () => issuer.bindApprovedCampaign(owner, review.id, state.onChainId),
    issue: (userId = learners[0], proof: unknown = "TEST_ONLY_VERIFIED", to: Address = recipient) =>
      issuer.issue({ campaignId: review.id, userId, recipient: to, proof }),
  };
}

test("migrations are repeatable; private creation is idempotent even across concurrent requests", async () => {
  const key = randomUUID();
  const input = reviewFixture();
  const results = await Promise.all(Array.from({ length: 8 }, () => reviews.create(owner, key, input)));
  assert.equal(new Set(results.map((result) => result.id)).size, 1);
  assert.equal(results[0].status, "REQUIRES_REVIEW");
  await assert.rejects(reviews.create(owner, key, { ...input, draft: { ...input.draft, title: "Different title" } }), { status: 409 });
  const count = await pool.query("SELECT count(*)::INTEGER AS n FROM base_learning_revisions WHERE campaign_id = $1", [results[0].id]);
  assert.equal(count.rows[0].n, 1);
});

test("private review ownership is enforced for reads, edits, approval and listing", async () => {
  const draft = await reviews.create(owner, randomUUID(), reviewFixture());
  await assert.rejects(reviews.get(outsider, draft.id), { status: 404 });
  await assert.rejects(reviews.revise(outsider, draft.id, 1, reviewFixture()), { status: 404 });
  await assert.rejects(reviews.approve(outsider, draft.id, 1, draft.reviewHash, draft.termsHash), { status: 404 });
  assert.deepEqual(await reviews.list(outsider), []);
  await assert.rejects(reviews.get("demo:1", draft.id), { status: 401 });
});

test("approval binds both hashes; revision races have one winner and invalidate only current approval", async () => {
  const draft = await approve();
  const replay = await reviews.approve(owner, draft.id, 1, draft.reviewHash, draft.termsHash);
  assert.deepEqual(replay.approval, draft.approval);
  await assert.rejects(reviews.approve(owner, draft.id, 1, "00".repeat(32), draft.termsHash), { status: 409 });
  await assert.rejects(reviews.approve(owner, draft.id, 1, draft.reviewHash, `0x${"00".repeat(32)}`), { status: 409 });
  const edits = await Promise.allSettled([
    reviews.revise(owner, draft.id, 1, reviewFixture()), reviews.revise(owner, draft.id, 1, reviewFixture()),
  ]);
  assert.equal(edits.filter((edit) => edit.status === "fulfilled").length, 1);
  for (const edit of edits) if (edit.status === "rejected") assert.equal(edit.reason.status, 409);
  const current = await reviews.get(owner, draft.id);
  assert.equal(current.revision, 2);
  assert.equal(current.status, "REQUIRES_REVIEW");
  assert.equal(current.approval, null);
  await assert.rejects(reviews.approve(owner, draft.id, 1, draft.reviewHash, draft.termsHash), { status: 409 });
  const history = await pool.query("SELECT * FROM base_learning_approvals WHERE campaign_id = $1", [draft.id]);
  assert.equal(history.rowCount, 1);
});

test("funding binding rejects mismatched finalized terms and freezes approved material", async () => {
  const ctx = await setup();
  const mutations: Partial<FinalizedCampaignState>[] = [
    { token: recipient }, { sponsor: recipient }, { rewardAtomic: 1n }, { termsHash: `0x${"bb".repeat(32)}` },
    { fundedAtomic: 1n }, { outstandingAtomic: 0n }, { chainId: 8453 }, { escrow: recipient },
    { startsAt: ctx.state.startsAt + 1 }, { signerEpoch: 2n }, { signer: rotatedTestSigner.address },
    { paused: true }, { closed: true }, { observedAt: ctx.state.observedAt - 61 },
  ];
  for (const mutation of mutations) {
    const original = { ...ctx.state };
    Object.assign(ctx.state, mutation);
    await assert.rejects(ctx.bind(), { status: 409 });
    Object.assign(ctx.state, original);
  }
  await ctx.bind();
  await ctx.bind();
  await assert.rejects(reviews.revise(owner, ctx.review.id, 1, reviewFixture()), { status: 409 });
  assert.equal((await reviews.get(owner, ctx.review.id)).fundingBound, true);
});

test("unapproved and changed-during-verification material cannot bind", async () => {
  const ctx = await setup();
  const draft = await reviews.create(owner, randomUUID(), reviewFixture());
  await assert.rejects(ctx.issuer.bindApprovedCampaign(owner, draft.id, 10n), { status: 409 });
  ctx.reader.readFinalizedCampaign = async () => {
    await reviews.revise(owner, ctx.review.id, 1, reviewFixture());
    return { ...ctx.state };
  };
  await assert.rejects(ctx.bind(), { status: 409 });
});

test("stored material cannot silently inherit approval when its commitments diverge", async () => {
  const draft = await approve();
  await pool.query(
    `UPDATE base_learning_revisions SET submission = jsonb_set(submission, '{draft,title}', '"Changed after approval"')
     WHERE campaign_id = $1 AND revision = 1`, [draft.id],
  );
  await assert.rejects(reviews.get(owner, draft.id), { status: 409 });
  await assert.rejects(reviews.approve(owner, draft.id, 1, draft.reviewHash, draft.termsHash), { status: 409 });
});

test("full authorization is committed before signing and a restart replays the exact saved result", async () => {
  const ctx = await setup();
  await ctx.bind();
  let signed = 0;
  ctx.signer.sign = async (data) => {
    const saved = await pool.query(
      `SELECT a.typed_data, a.signature FROM base_reward_authorizations a
       JOIN base_reward_allocations r ON r.id = a.allocation_id WHERE r.campaign_id = $1`, [ctx.review.id],
    );
    assert.equal(saved.rowCount, 1);
    assert.equal(saved.rows[0].signature, null);
    assert.equal(saved.rows[0].typed_data.message.participantId, data.message.participantId);
    assert.equal(saved.rows[0].typed_data.message.deadline, data.message.deadline.toString());
    signed++;
    return testSigner.signTypedData(data);
  };
  const first = await ctx.issue();
  assert.equal(first.status, "AUTHORIZED");
  const restarted = new BaseRewardIssuer(pool, ctx.reader, ctx.eligibility, ctx.signer);
  const replay = await restarted.issue({ campaignId: ctx.review.id, userId: learners[0], recipient, proof: "TEST_ONLY_VERIFIED" });
  assert.deepEqual(replay, first);
  assert.equal(signed, 1);
});

test("concurrent exhaustion never overbooks and duplicate participants have one allocation", async () => {
  const ctx = await setup();
  await ctx.bind();
  const same = await Promise.all(Array.from({ length: 10 }, () => ctx.issue()));
  assert.equal(new Set(same.map((result) => result.allocationId)).size, 1);
  assert.equal(new Set(same.map((result) => result.signature)).size, 1);
  const rest = await Promise.allSettled(learners.slice(1).map((learner) => ctx.issue(learner)));
  assert.equal(rest.filter((result) => result.status === "fulfilled").length, 2);
  const rows = await pool.query("SELECT slot, participant_id FROM base_reward_allocations WHERE campaign_id = $1 ORDER BY slot", [ctx.review.id]);
  assert.deepEqual(rows.rows.map((row) => Number(row.slot)), [0, 1, 2]);
  assert.equal(new Set(rows.rows.map((row) => row.participant_id)).size, 3);
  const counter = await pool.query("SELECT next_slot FROM base_reward_campaigns WHERE campaign_id = $1", [ctx.review.id]);
  assert.equal(Number(counter.rows[0].next_slot), 3);
});

test("failed signing retains capacity and recipient; retry signs the same tuple", async () => {
  const input = reviewFixture(); input.terms.maxClaims = 1;
  const ctx = await setup(input);
  await ctx.bind();
  ctx.signer.sign = async () => { throw new Error("secret key or upstream body must not escape"); };
  await assert.rejects(ctx.issue(), { code: "BASE_SIGNING_UNAVAILABLE" });
  const before = await pool.query("SELECT * FROM base_reward_allocations WHERE campaign_id = $1", [ctx.review.id]);
  await assert.rejects(ctx.issue(learners[1]), { status: 409 });
  await assert.rejects(ctx.issue(learners[0], "TEST_ONLY_VERIFIED", rotatedTestSigner.address), { status: 409 });
  ctx.signer.sign = (data) => testSigner.signTypedData(data);
  const retried = await ctx.issue();
  assert.equal(retried.allocationId, before.rows[0].id);
  assert.equal(retried.typedData.message.participantId, before.rows[0].participant_id);
});

test("unverified email and failed eligibility consume no slots", async () => {
  const ctx = await setup(); await ctx.bind();
  await assert.rejects(ctx.issue(unverified), { code: "VERIFIED_EMAIL_REQUIRED" });
  await assert.rejects(ctx.issue(learners[0], { completed: true, walletVerified: true }), { code: "BASE_ELIGIBILITY_REQUIRED" });
  const count = await pool.query("SELECT count(*)::INTEGER AS n FROM base_reward_allocations WHERE campaign_id = $1", [ctx.review.id]);
  assert.equal(count.rows[0].n, 0);
});

test("signer rotation preserves the allocation and all previous authorizations", async () => {
  const ctx = await setup(); await ctx.bind();
  const original = await ctx.issue();
  ctx.state.signerEpoch = 2n; ctx.state.signer = rotatedTestSigner.address;
  await assert.rejects(ctx.issue(), { status: 409 });
  ctx.signer.address = rotatedTestSigner.address;
  ctx.signer.sign = (data) => rotatedTestSigner.signTypedData(data);
  const rotated = await ctx.issue();
  assert.equal(rotated.allocationId, original.allocationId);
  assert.notEqual(rotated.digest, original.digest);
  assert.deepEqual({ ...rotated.typedData.message, signerEpoch: "1" }, original.typedData.message);
  const history = await pool.query("SELECT signer_epoch, signature FROM base_reward_authorizations WHERE allocation_id = $1 ORDER BY signer_epoch", [original.allocationId]);
  assert.deepEqual(history.rows.map((row) => row.signer_epoch), ["1", "2"]);
  assert.equal(history.rows[0].signature, original.signature);
});

test("rotation or payment during signing is rechecked before returning an authorization", async () => {
  for (const change of ["rotation", "payment", "pause"] as const) {
    const ctx = await setup(); await ctx.bind();
    ctx.signer.sign = async (data) => {
      if (change === "rotation") ctx.state.signerEpoch = 2n;
      if (change === "payment") ctx.use.slotUsed = true;
      if (change === "pause") ctx.state.paused = true;
      return testSigner.signTypedData(data);
    };
    await assert.rejects(ctx.issue(), { status: 409 });
    const rows = await pool.query("SELECT id FROM base_reward_allocations WHERE campaign_id = $1", [ctx.review.id]);
    assert.equal(rows.rowCount, 1);
  }
});

test("paused, closed, stale, consumed and invalid-signature states fail closed", async () => {
  const ctx = await setup(); await ctx.bind();
  ctx.state.paused = true;
  await assert.rejects(ctx.issue(), { status: 409 });
  ctx.state.paused = false; ctx.state.closed = true;
  await assert.rejects(ctx.issue(), { status: 409 });
  ctx.state.closed = false;
  ctx.state.blockTimestamp -= 301;
  await assert.rejects(ctx.issue(), { status: 409 });
  ctx.state.blockTimestamp += 301;
  ctx.signer.sign = (data) => rotatedTestSigner.signTypedData(data);
  await assert.rejects(ctx.issue(), { code: "BASE_SIGNING_UNAVAILABLE" });
  ctx.signer.sign = (data) => testSigner.signTypedData(data);
  ctx.use.participantUsed = true;
  await assert.rejects(ctx.issue(), { status: 409 });
});

test("new allocations stop at the completion cutoff", async () => {
  const input = reviewFixture(); input.terms.endsAt = Math.floor(Date.now() / 1000);
  const ctx = await setup(input); await ctx.bind();
  await assert.rejects(ctx.issue(), { status: 409 });
  const rows = await pool.query("SELECT id FROM base_reward_allocations WHERE campaign_id = $1", [ctx.review.id]);
  assert.equal(rows.rowCount, 0);
});

test("database and chain failures are sanitized", async () => {
  await assert.rejects(reviews.create("9223372036854775807", randomUUID(), reviewFixture()), {
    code: "BASE_WORKFLOW_UNAVAILABLE", message: "The learning workflow is temporarily unavailable",
  });
  const ctx = await setup(); await ctx.bind();
  ctx.reader.readFinalizedCampaign = async () => { throw new Error("private RPC credentials"); };
  await assert.rejects(ctx.issue(), { code: "BASE_CHAIN_UNAVAILABLE", message: "Finalized reward state is unavailable" });
});

test("an existing reservation can recover after the new-allocation cutoff, but not after redemption expiry", async () => {
  const input = reviewFixture();
  input.terms.endsAt = Math.floor(Date.now() / 1000) + 5;
  input.terms.claimDeadline = input.terms.endsAt + 2;
  const ctx = await setup(input); await ctx.bind();
  ctx.signer.sign = async () => { throw new Error("ambiguous signer timeout"); };
  await assert.rejects(ctx.issue(), { code: "BASE_SIGNING_UNAVAILABLE" });
  await sleep(Math.max(0, input.terms.endsAt * 1000 - Date.now() + 50));
  ctx.signer.sign = (data) => testSigner.signTypedData(data);
  assert.equal((await ctx.issue()).typedData.message.slot, 0);
  await assert.rejects(ctx.issue(learners[1]), { status: 409 });
  await sleep(Math.max(0, (input.terms.claimDeadline + 1) * 1000 - Date.now() + 50));
  await assert.rejects(ctx.issue(), { status: 409 });
});

test("issuer rejects a backwards epoch and a finalized block fork during signing", async () => {
  const ctx = await setup(); await ctx.bind();
  ctx.state.signerEpoch = 2n;
  await ctx.issue();
  ctx.state.signerEpoch = 1n;
  await assert.rejects(ctx.issue(), { status: 409 });
  ctx.state.signerEpoch = 2n;
  ctx.signer.sign = async (data) => {
    ctx.state.blockHash = `0x${"bb".repeat(32)}`;
    return testSigner.signTypedData(data);
  };
  await assert.rejects(ctx.issue(learners[1]), { status: 409 });
});

test("database constraints reject duplicate slots and users independently of the issuer", async () => {
  const ctx = await setup(); await ctx.bind();
  await ctx.issue();
  for (const [userId, slot] of [[learners[1], 0], [learners[0], 1]] as const) {
    await assert.rejects(pool.query(
      `INSERT INTO base_reward_allocations
       (id, campaign_id, user_id, slot, participant_id, recipient, amount, deadline, eligibility_receipt, email_verified_at)
       SELECT $1, campaign_id, $2, $3, $4, recipient, amount, deadline, eligibility_receipt, email_verified_at
       FROM base_reward_allocations WHERE campaign_id = $5 LIMIT 1`,
      [randomUUID(), userId, slot, `0x${"ee".repeat(32)}`, ctx.review.id],
    ), { code: "23505" });
  }
});

test("private route handlers enforce real sessions, ownership, same-origin mutations and hash-bound approval", async () => {
  const token = randomUUID(); const outsiderToken = randomUUID();
  await pool.query("INSERT INTO sessions (user_id, session_token, expires) VALUES ($1, $2, NOW() + INTERVAL '1 hour'), ($3, $4, NOW() + INTERVAL '1 hour')", [owner, token, outsider, outsiderToken]);
  httpPoolOpened = true;
  function request(method: string, body?: unknown, session = token, origin = "https://crossword.example.test") {
    return new Request("https://crossword.example.test/api/base/reviews", {
      method, headers: { cookie: `next-auth.session-token=${session}`, origin,
        "content-type": "application/json", "idempotency-key": randomUUID(), "x-real-ip": "127.0.0.1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const noSession = await listReviews(new Request("https://crossword.example.test/api/base/reviews"));
  assert.equal(noSession.status, 401);
  const foreignOrigin = await createReview(request("POST", reviewFixture(), token, "https://elsewhere.test"));
  assert.equal(foreignOrigin.status, 403);
  const created = await createReview(request("POST", reviewFixture()));
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "no-store");
  const draft = await created.json() as PrivateReview;
  const context = { params: Promise.resolve({ id: draft.id }) };
  assert.equal((await getReview(request("GET", undefined, outsiderToken), context)).status, 404);
  assert.equal((await updateReview(request("PUT", { expectedRevision: 1, submission: reviewFixture() }, outsiderToken), context)).status, 404);
  const approval = { revision: 1, reviewHash: draft.reviewHash, termsHash: draft.termsHash };
  assert.equal((await approveReview(request("POST", approval, outsiderToken), context)).status, 404);
  assert.equal((await approveReview(request("POST", approval), context)).status, 200);
  assert.equal((await publicationHandlers.preview(request("GET", undefined, outsiderToken), context)).status, 404);
  const layoutResponse = await publicationHandlers.preview(request("GET"), context);
  assert.equal(layoutResponse.status, 200); assert.equal(layoutResponse.headers.get("cache-control"), "no-store");
  const grid = await layoutResponse.json();
  const layoutApproval = { action: "approve-layout", expected: { revision: grid.revision, termsHash: grid.termsHash, layoutHash: grid.layoutHash } };
  assert.equal((await publicationHandlers.update(request("POST", layoutApproval, outsiderToken), context)).status, 404);
  assert.equal((await publicationHandlers.update(request("POST", layoutApproval, token, "https://elsewhere.test"), context)).status, 403);
  assert.equal((await publicationHandlers.update(request("POST", layoutApproval), context)).status, 200);
  const read = await getReview(request("GET"), context);
  assert.equal((await read.json()).status, "APPROVED");
  process.env.BASE_REVIEW_ENABLED = "false";
  assert.equal((await getReview(request("GET"), context)).status, 404);
  process.env.BASE_REVIEW_ENABLED = "true";
});

async function sponsorshipSetup() {
  const input = reviewFixture();
  input.terms.escrow = `0x${(1000n + onChainSequence).toString(16).padStart(40, "0")}`;
  const ctx = await setup(input); await ctx.bind();
  const issued = await ctx.issue();
  const policy = gasPolicy(ctx.state.escrow); policy.chainId = ctx.state.chainId;
  const call = claimCall(issued, { recipient, chainId: ctx.state.chainId, escrow: ctx.state.escrow,
    onChainId: ctx.state.onChainId.toString(), rewardAtomic: ctx.state.rewardAtomic.toString(), claimDeadline: ctx.state.claimDeadline });
  const controls = { calls: 0, fail: false, accountFail: false, after: async () => {} };
  const service = () => new ClaimSponsorship(pool, ctx.reader, { verifySponsorshipAccount: async () => { if (controls.accountFail) throw new Error("Private RPC error"); } }, policy,
    async () => { controls.calls++; await controls.after(); if (controls.fail) throw new Error("Provider SECRET"); return gasResult(policy); });
  const permit = await service().permit(learners[0], ctx.review.id, issued.digest);
  const request = gasRequest(policy, recipient, call.data, permit.token);
  return { ...ctx, policy, controls, service, issued, permit, request };
}

test("gas permit is private, claim bound and refreshed without extending a possibly signed operation", async () => {
  const ctx = await sponsorshipSetup();
  await assert.rejects(ctx.service().permit(outsider, ctx.review.id, ctx.issued.digest), { status: 403 });
  const rows = await pool.query("SELECT * FROM base_gas_sponsorships WHERE allocation_id = $1", [ctx.issued.allocationId]);
  assert.doesNotMatch(JSON.stringify(rows.rows), new RegExp(ctx.permit.token));
  assert.equal(rows.rows[0].reserved_wei, "0");
  const response = await ctx.service().proxy(ctx.request);
  const fresh = await ctx.service().permit(learners[0], ctx.review.id, ctx.issued.digest);
  assert.notEqual(fresh.token, ctx.permit.token); assert.equal(fresh.expiresAt, ctx.permit.expiresAt);
  await assert.rejects(ctx.service().proxy(ctx.request), { status: 403 });
  ctx.request.params[3].token = fresh.token;
  assert.deepEqual(await ctx.service().proxy(ctx.request), response); assert.equal(ctx.controls.calls, 1);
});

test("gas requests reserve once, deduplicate concurrent requests and replay after process restart without contacting upstream", async () => {
  const ctx = await sponsorshipSetup();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(r => { enter = r; }), gate = new Promise<void>(r => { release = r; });
  ctx.controls.after = async () => {
    const intent = await pool.query("SELECT s.reserved_wei, r.state FROM base_gas_sponsorships s JOIN base_gas_requests r ON r.allocation_id = s.allocation_id WHERE s.allocation_id = $1 ORDER BY r.created_at DESC LIMIT 1", [ctx.issued.allocationId]);
    assert.equal(intent.rows[0].state, "IN_FLIGHT");
    assert.equal(intent.rows[0].reserved_wei, ctx.policy.maxOperationWei.toString());
    enter(); await gate;
  };
  const first = ctx.service().proxy(ctx.request); await entered;
  await assert.rejects(ctx.service().proxy(ctx.request), { code: "SPONSORSHIP_UNAVAILABLE" });
  release(); const response = await first;
  assert.deepEqual(await ctx.service().proxy(ctx.request), response);
  assert.equal(ctx.controls.calls, 1);
  ctx.request.method = "pm_getPaymasterData";
  await ctx.service().proxy(ctx.request); await ctx.service().proxy(ctx.request);
  assert.equal(ctx.controls.calls, 2);
  const rows = await pool.query("SELECT reserved_wei, attempts FROM base_gas_sponsorships WHERE allocation_id = $1", [ctx.issued.allocationId]);
  assert.equal(rows.rows[0].reserved_wei, ctx.policy.maxOperationWei.toString()); assert.equal(rows.rows[0].attempts, 2);
  ctx.request.params[0].callGasLimit = "0x186a1";
  await assert.rejects(ctx.service().proxy(ctx.request), { status: 403 });
});

test("unknown provider outcomes survive restarts, cannot bypass by changing estimates, and retain budget", async () => {
  const ctx = await sponsorshipSetup(); ctx.controls.fail = true;
  await assert.rejects(ctx.service().proxy(ctx.request), { code: "SPONSORSHIP_UNAVAILABLE" });
  ctx.controls.fail = false;
  await assert.rejects(ctx.service().proxy(ctx.request), { code: "SPONSORSHIP_UNAVAILABLE" });
  ctx.request.params[0].callGasLimit = "0x186a1";
  await assert.rejects(ctx.service().proxy(ctx.request), { code: "SPONSORSHIP_UNAVAILABLE" });
  assert.equal(ctx.controls.calls, 1);
  const saved = await pool.query("SELECT * FROM base_gas_requests WHERE allocation_id = $1", [ctx.issued.allocationId]);
  assert.equal(saved.rows[0].state, "UNKNOWN"); assert.equal(saved.rows[0].result, null);
  assert.doesNotMatch(JSON.stringify(saved.rows), /SECRET/);
});

test("expired, nonce-replaced, rotated, paused, paid and unpinned accounts cannot obtain sponsorship", async () => {
  const ctx = await sponsorshipSetup();
  ctx.controls.accountFail = true; await assert.rejects(ctx.service().proxy(ctx.request)); ctx.controls.accountFail = false;
  ctx.state.paused = true; await assert.rejects(ctx.service().proxy(ctx.request)); ctx.state.paused = false;
  ctx.state.signerEpoch = 2n; await assert.rejects(ctx.service().proxy(ctx.request)); ctx.state.signerEpoch = 1n;
  ctx.use.slotUsed = true; await assert.rejects(ctx.service().proxy(ctx.request)); ctx.use.slotUsed = false;
  assert.equal(ctx.controls.calls, 0);
  await ctx.service().proxy(ctx.request);
  ctx.request.params[0].nonce = "0x1"; await assert.rejects(ctx.service().proxy(ctx.request)); ctx.request.params[0].nonce = "0x0";
  await pool.query("UPDATE base_gas_sponsorships SET expires_at = NOW() - INTERVAL '1 second' WHERE allocation_id = $1", [ctx.issued.allocationId]);
  await assert.rejects(ctx.service().proxy(ctx.request));
  await assert.rejects(ctx.service().permit(learners[0], ctx.review.id, ctx.issued.digest));
  assert.equal(ctx.controls.calls, 1);
});

test("deployment-wide gas quota is atomic across different allocations and does not consume prize principal", async () => {
  const ctx = await sponsorshipSetup();
  const requests: SponsorshipRequest[] = [ctx.request];
  for (const userId of learners.slice(1, 3)) {
    const reward = await ctx.issue(userId);
    const permit = await ctx.service().permit(userId, ctx.review.id, reward.digest);
    const call = claimCall(reward, { recipient, chainId: ctx.state.chainId, escrow: ctx.state.escrow,
      onChainId: ctx.state.onChainId.toString(), rewardAtomic: ctx.state.rewardAtomic.toString(), claimDeadline: ctx.state.claimDeadline });
    requests.push(gasRequest(ctx.policy, recipient, call.data, permit.token));
  }
  const results = await Promise.allSettled(requests.map(r => ctx.service().proxy(r)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 2);
  assert.equal(ctx.controls.calls, 2);
  const total = await pool.query("SELECT SUM(s.reserved_wei)::TEXT AS amount FROM base_gas_sponsorships s JOIN base_reward_allocations r ON r.id = s.allocation_id WHERE r.campaign_id = $1", [ctx.review.id]);
  assert.equal(total.rows[0].amount, ctx.policy.totalBudgetWei.toString());
  assert.equal(ctx.state.outstandingAtomic, 300000n);
});

test("provider completion followed by signer rotation is held for recovery, never returned as sponsored success", async () => {
  const ctx = await sponsorshipSetup(); ctx.controls.after = async () => { ctx.state.signerEpoch = 2n; };
  await assert.rejects(ctx.service().proxy(ctx.request), { code: "SPONSORSHIP_UNAVAILABLE" });
  assert.equal((await pool.query("SELECT state FROM base_gas_requests WHERE allocation_id = $1", [ctx.issued.allocationId])).rows[0].state, "UNKNOWN");
});

test("global gas budget and per-recipient limits are independent and cannot reset through another campaign", async () => {
  for (const mode of ["global", "recipient"] as const) {
    const ctx = await sponsorshipSetup();
    if (mode === "global") { ctx.policy.totalBudgetWei = ctx.policy.maxOperationWei; ctx.policy.maxOperationsPerAccount = 10; }
    else { ctx.policy.totalBudgetWei = ctx.policy.maxOperationWei * 10n; ctx.policy.maxOperationsPerAccount = 1; }
    // Policy approval precedes first use; refresh the initially unused synthetic record for this fixture only.
    await pool.query("DELETE FROM base_gas_sponsorships WHERE allocation_id = $1", [ctx.issued.allocationId]);
    ctx.request.params[3].token = (await ctx.service().permit(learners[0], ctx.review.id, ctx.issued.digest)).token;
    await ctx.service().proxy(ctx.request);
    const input = reviewFixture(); input.terms.escrow = ctx.policy.escrow;
    const another = await setup(input); await another.bind();
    const target = mode === "global" ? rotatedTestSigner.address : recipient;
    const reward = await another.issue(learners[1], "TEST_ONLY_VERIFIED", target);
    let calls = 0;
    const service = new ClaimSponsorship(pool, another.reader, { verifySponsorshipAccount: async () => {} }, ctx.policy, async () => { calls++; return gasResult(ctx.policy); });
    const permit = await service.permit(learners[1], another.review.id, reward.digest);
    const call = claimCall(reward, { recipient: target, chainId: another.state.chainId, escrow: another.state.escrow,
      onChainId: another.state.onChainId.toString(), rewardAtomic: another.state.rewardAtomic.toString(), claimDeadline: another.state.claimDeadline });
    await assert.rejects(service.proxy(gasRequest(ctx.policy, target, call.data, permit.token)), { status: 403 });
    assert.equal(calls, 0);
  }
});

test("permit HTTP requires real owner session and origin; proxy uses scoped context without cookies and denies arbitrary RPC", async () => {
  const ctx = await sponsorshipSetup();
  process.env.BASE_PARTICIPANT_ENABLED = "true"; process.env.BASE_PAYMASTER_PROXY_ENABLED = "true"; process.env.BASE_SPONSORED_GAS_ENABLED = "true";
  const handlers = createSponsorshipHandlers(() => ctx.service());
  const token = randomUUID();
  await pool.query("INSERT INTO sessions (user_id, session_token, expires) VALUES ($1, $2, NOW() + INTERVAL '1 hour')", [learners[0], token]);
  const context = { params: Promise.resolve({ id: ctx.review.id }) };
  const request = (body: unknown, cookie = "", origin = "https://crossword.example.test") => new Request("https://crossword.example.test/api/base/paymaster", {
    method: "POST", headers: { "content-type": "application/json", "x-real-ip": "127.0.0.1", origin, cookie }, body: JSON.stringify(body) });
  assert.equal((await handlers.permit(request({ digest: ctx.issued.digest }), context)).status, 401);
  const cookie = `next-auth.session-token=${token}`;
  assert.equal((await handlers.permit(request({ digest: ctx.issued.digest }, cookie, "https://elsewhere.test"), context)).status, 403);
  const grant = await handlers.permit(request({ digest: ctx.issued.digest }, cookie), context);
  assert.equal(grant.status, 200); assert.equal(grant.headers.get("cache-control"), "no-store");
  ctx.request.params[3].token = (await grant.json()).token;
  const response = await handlers.proxy(request(ctx.request, "", "https://wallet.example.test"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.equal((await response.json()).id, ctx.request.id);
  const bad = await handlers.proxy(request({ ...ctx.request, method: "eth_sendRawTransaction" }));
  assert.equal(bad.status, 403); assert.equal(ctx.controls.calls, 1);
  assert.equal((await handlers.options()).status, 204);
  process.env.BASE_PAYMASTER_PROXY_ENABLED = "false";
  assert.equal((await handlers.proxy(request(ctx.request))).status, 404);
  assert.equal((await handlers.options()).status, 404);
});
