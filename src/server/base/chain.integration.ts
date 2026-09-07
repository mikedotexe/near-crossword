import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";
import { BaseChainIndexer } from "./chain-indexer";
import { RpcBaseChainReader } from "./chain-reader";
import { ReconciledBaseChainReader } from "./reconciled-chain-reader";
import { chainFixture, encodeEscrowEvent, participant, testHash } from "./chain.fixture";
import { recipient } from "./workflow.fixture";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL must name a disposable local PostgreSQL target");
const url = new URL(connectionString);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Integration tests require local PostgreSQL");
const schema = `base_chain_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString, max: 1 });
url.searchParams.set("options", `-c search_path=${schema}`);
const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (let pass = 0; pass < 2; pass++) {
    const migrated = spawnSync(process.execPath, ["scripts/migrate-v2.mjs"], {
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 30000,
    });
    assert.equal(migrated.status, 0, "Isolated migrations must succeed");
    assert.equal(migrated.stdout.split(pass === 0 ? "Applied " : "Already applied ").length - 1, 15);
  }
});
beforeEach(async () => { await pool.query("TRUNCATE base_chain_deployments CASCADE"); });
after(async () => { await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); });

function setup(options = {}) {
  const fixture = chainFixture();
  const reader = new RpcBaseChainReader(fixture.deployment, { fetch: fixture.fetcher, allowLocalChain: true });
  return { ...fixture, reader, indexer: new BaseChainIndexer(pool, reader, options) };
}
async function saved() {
  return {
    deployment: (await pool.query("SELECT * FROM base_chain_deployments")).rows[0],
    blocks: (await pool.query("SELECT * FROM base_chain_blocks ORDER BY block_number, block_hash")).rows,
    events: (await pool.query("SELECT * FROM base_chain_events ORDER BY block_hash, log_index")).rows,
    campaigns: (await pool.query("SELECT * FROM base_chain_campaign_snapshots")).rows,
  };
}

test("indexer replays exact logs without double counting and finalizes only reconciled receipts", async () => {
  const ctx = setup(); ctx.control.duplicateLogs = true;
  assert.equal((await ctx.indexer.sync()).blocks, 3);
  let result = await saved();
  assert.equal(result.events.length, 2); assert.equal(result.campaigns[0].accounting.paidCount, 0);
  assert.equal(result.deployment.finalized_number, "10"); assert.equal(result.deployment.state, "HEALTHY");
  assert.equal((await ctx.indexer.sync()).blocks, 0);
  assert.equal((await saved()).events.length, 2);
  ctx.control.finalized = 11n;
  await ctx.indexer.sync(); result = await saved();
  assert.equal(result.campaigns[0].accounting.paidCount, 1); assert.equal(result.deployment.totals.totalReserved, "200000");
  assert.doesNotMatch(JSON.stringify(result), /private-api-key|rpcUrl/);
});

test("ordinary reorg rewinds only unfinalized history and retains orphaned evidence for replay", async () => {
  const ctx = setup(); await ctx.indexer.sync();
  for (const n of [11n, 12n, 13n]) {
    const block = ctx.blocks.get(n)!;
    block.hash = testHash(Number(n) + 1000); block.parentHash = n === 11n ? testHash(10) : testHash(Number(n) - 1 + 1000);
  }
  ctx.logs.delete(11n); ctx.control.paidFrom = 13n; ctx.control.latest = 13n;
  ctx.logs.set(13n, [encodeEscrowEvent("RewardPaid", { campaignId: 1n, slot: 0, participantId: participant, recipient, amount: 100000n }, ctx.blocks.get(13n)!)]);
  assert.equal((await ctx.indexer.sync()).rewoundBlocks, 2);
  let result = await saved();
  assert.equal(result.blocks.filter((b) => !b.canonical).length, 2); assert.equal(result.events.length, 2);
  assert.equal(result.deployment.finalized_number, "10"); assert.equal(result.campaigns[0].accounting.paidCount, 0);
  await ctx.indexer.sync(); ctx.control.finalized = 13n; await ctx.indexer.sync(); result = await saved();
  assert.equal(result.events.length, 3); assert.equal(result.campaigns[0].accounting.paidCount, 1);
  assert.equal(result.deployment.finalized_hash, testHash(1013));
  assert.equal((await pool.query("SELECT count(*)::INTEGER AS n FROM base_reward_allocations")).rows[0].n, 0);
});

test("a finalized-history contradiction halts without rewriting prior accounting", async () => {
  const ctx = setup(); ctx.control.finalized = 11n; await ctx.indexer.sync();
  const old = await saved(); ctx.blocks.get(11n)!.hash = testHash(1011);
  await assert.rejects(ctx.indexer.sync(), { code: "BASE_FINALITY_CONFLICT" });
  const result = await saved();
  assert.equal(result.deployment.state, "HALTED"); assert.deepEqual(result.campaigns, old.campaigns);
  assert.equal(result.deployment.finalized_hash, testHash(11));
  await assert.rejects(ctx.indexer.sync(), { code: "BASE_INDEXER_HALTED" });
});

test("missing logs, inconsistent totals and insolvency cannot advance the reconciled checkpoint", async () => {
  const ctx = setup(); ctx.control.omitLogs = true;
  await assert.rejects(ctx.indexer.sync(), { code: "BASE_RECONCILIATION_MISMATCH" });
  let result = await saved();
  assert.equal(result.deployment.state, "HALTED"); assert.equal(result.deployment.tip_number, null); assert.equal(result.campaigns.length, 0);
  await pool.query("TRUNCATE base_chain_deployments CASCADE");
  ctx.control.omitLogs = false; await ctx.indexer.sync();
  const previous = (await saved()).campaigns;
  ctx.control.balanceOverride = 1n;
  await assert.rejects(ctx.indexer.sync(), { code: "BASE_RECONCILIATION_MISMATCH" });
  result = await saved(); assert.deepEqual(result.campaigns, previous); assert.equal(result.deployment.state, "HALTED");
});

test("concurrent scanners use compare-and-swap and cannot publish a stale snapshot", async () => {
  const ctx = setup(); const block = ctx.reader.block.bind(ctx.reader);
  let entered = 0; let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  ctx.reader.block = async (tag, signal) => {
    if (tag === "latest" && entered < 2) { if (++entered === 2) release(); await gate; }
    return block(tag, signal);
  };
  const results = await Promise.allSettled([ctx.indexer.sync(), ctx.indexer.sync()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  for (const result of results) if (result.status === "rejected") assert.equal(result.reason.code, "BASE_INDEXER_RETRY");
  const data = await saved(); assert.equal(data.blocks.length, 3); assert.equal(data.events.length, 2);
});

test("bounded catch-up distinguishes an incomplete scan from current finalized accounting", async () => {
  const ctx = setup({ batchBlocks: 1 }); ctx.control.latest = 14n; ctx.control.finalized = 12n;
  assert.equal((await ctx.indexer.sync()).state, "CATCHING_UP");
  assert.equal((await ctx.indexer.sync()).state, "CATCHING_UP");
  assert.equal((await ctx.indexer.sync()).state, "HEALTHY");
  assert.equal((await saved()).deployment.finalized_number, "12");
});

test("reorgs deeper than the bounded rewind window halt rather than deleting history", async () => {
  const ctx = setup({ maxReorgBlocks: 1 }); ctx.control.latest = 14n;
  await ctx.indexer.sync();
  for (const n of [12n, 13n, 14n]) ctx.blocks.get(n)!.hash = testHash(Number(n) + 1000);
  await assert.rejects(ctx.indexer.sync(), { code: "BASE_REORG_TOO_DEEP" });
  const result = await saved();
  assert.equal(result.deployment.state, "HALTED"); assert.equal(result.blocks.filter((b) => !b.canonical).length, 0);
});

test("RPC failures preserve the last checkpoint and never persist credential-bearing errors", async () => {
  const ctx = setup(); await ctx.indexer.sync(); const old = await saved();
  ctx.control.latest = 13n;
  ctx.reader.logs = async () => { throw new Error("private-api-key NEVER_PRINT"); };
  await assert.rejects(ctx.indexer.sync(), (error) => { assert.doesNotMatch(String(error), /private-api-key|NEVER_PRINT/); return true; });
  assert.deepEqual(await saved(), old);
});

test("deployment pins cannot silently change on a populated ledger", async () => {
  const ctx = setup(); await ctx.indexer.sync();
  const other = new RpcBaseChainReader({ ...ctx.deployment, runtimeCodeHash: testHash(999) }, { fetch: ctx.fetcher, allowLocalChain: true });
  await assert.rejects(new BaseChainIndexer(pool, other).sync(), { code: "BASE_DEPLOYMENT_PINS_CHANGED" });
});

test("issuance reader requires a fresh healthy ledger at the exact finalized snapshot", async () => {
  const ctx = setup();
  const guarded = new ReconciledBaseChainReader(pool, ctx.reader);
  await assert.rejects(guarded.readFinalizedCampaign(ctx.base, AbortSignal.timeout(1000)), { code: "BASE_ACCOUNTING_NOT_READY" });
  await ctx.indexer.sync();
  assert.equal((await guarded.readFinalizedCampaign(ctx.base, AbortSignal.timeout(1000))).paidCount, 0);
  ctx.control.finalized = 11n;
  await assert.rejects(guarded.readFinalizedCampaign(ctx.base, AbortSignal.timeout(1000)), { code: "BASE_ACCOUNTING_NOT_READY" });
  await ctx.indexer.sync();
  assert.equal((await guarded.readFinalizedCampaign(ctx.base, AbortSignal.timeout(1000))).paidCount, 1);
  await pool.query("UPDATE base_chain_deployments SET checked_at = NOW() - INTERVAL '61 seconds'");
  await assert.rejects(guarded.readFinalizedCampaign(ctx.base, AbortSignal.timeout(1000)), { code: "BASE_ACCOUNTING_NOT_READY" });
  await ctx.indexer.sync(); ctx.blocks.get(11n)!.hash = testHash(9911);
  await assert.rejects(ctx.indexer.sync(), { code: "BASE_FINALITY_CONFLICT" });
  await assert.rejects(guarded.readFinalizedCampaign(ctx.base, AbortSignal.timeout(1000)), { code: "BASE_ACCOUNTING_NOT_READY" });
});

test("issuance reader tolerates an unfinalized tip update during a finalized read", async () => {
  const ctx = setup();
  await ctx.indexer.sync();
  const guarded = new ReconciledBaseChainReader(pool, ctx.reader);
  const read = ctx.reader.readFinalizedCampaign.bind(ctx.reader);
  let advanced = false;
  ctx.reader.readFinalizedCampaign = async (binding, signal) => {
    if (!advanced) {
      advanced = true;
      ctx.control.latest = 13n;
      await ctx.indexer.sync();
    }
    return read(binding, signal);
  };
  const state = await guarded.readFinalizedCampaign(
    ctx.base,
    AbortSignal.timeout(1000),
  );
  assert.equal(state.blockNumber, 10n);
  const result = await saved();
  assert.equal(result.deployment.tip_number, "13");
  assert.equal(result.deployment.finalized_number, "10");
});

test("a previously orphaned block can return without duplicating its immutable logs", async () => {
  const ctx = setup(); await ctx.indexer.sync();
  const originals = [structuredClone(ctx.blocks.get(11n)!), structuredClone(ctx.blocks.get(12n)!)];
  const payment = structuredClone(ctx.logs.get(11n)!);
  ctx.blocks.get(11n)!.hash = testHash(1011); ctx.blocks.get(12n)!.hash = testHash(1012); ctx.blocks.get(12n)!.parentHash = testHash(1011);
  ctx.logs.delete(11n); ctx.control.paidFrom = 99n;
  await ctx.indexer.sync(); await ctx.indexer.sync();
  for (const block of originals) ctx.blocks.set(block.number, block);
  ctx.logs.set(11n, payment); ctx.control.paidFrom = 11n;
  await ctx.indexer.sync(); await ctx.indexer.sync(); ctx.control.finalized = 11n; await ctx.indexer.sync();
  const result = await saved();
  assert.equal(result.events.length, 2); assert.equal(result.blocks.filter((b) => b.canonical).length, 3);
  assert.equal(result.campaigns[0].accounting.paidCount, 1);
});
