import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import pg from "pg";
import { createPublicClient, createTestClient, createWalletClient, http, keccak256, type Abi, type Address, type Hex } from "viem";
import { foundry } from "viem/chains";
import { baseClaimTypedData } from "../../lib/base/claim";
import { BaseChainIndexer } from "./chain-indexer";
import { RpcBaseChainReader, parseBaseDeployment } from "./chain-reader";
import { ReconciledBaseChainReader } from "./reconciled-chain-reader";
import { recipient, testSigner } from "./workflow.fixture";
import { participant, testHash } from "./chain.fixture";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL must name disposable local PostgreSQL");
const databaseUrl = new URL(connectionString);
if (!["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname)) throw new Error("Acceptance test refuses nonlocal PostgreSQL");
const require = createRequire(import.meta.url);
function artifact(path: string): { abi: Abi; bytecode: { object: Hex } } { return JSON.parse(readFileSync(path, "utf8")); }

test("compiled escrow, RPC adapter and Postgres ledger reconcile funding, reward, rotation and refund", { timeout: 120000 }, async () => {
  const portReservation = createServer();
  portReservation.listen(0, "127.0.0.1"); await once(portReservation, "listening");
  const bound = portReservation.address();
  assert.ok(bound && typeof bound === "object");
  const rpcUrl = `http://127.0.0.1:${bound.port}`;
  await new Promise<void>((resolve, reject) => portReservation.close((error) => error ? reject(error) : resolve()));
  const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : undefined;
  if (!arch) throw new Error("Unsupported local EVM architecture");
  const binary = require.resolve(`@foundry-rs/anvil-${process.platform}-${arch}/bin/${process.platform === "win32" ? "anvil.exe" : "anvil"}`);
  const child = spawn(binary, ["--host", "127.0.0.1", "--port", String(bound.port), "--chain-id", "31337", "--silent", "--slots-in-an-epoch", "1", "--timestamp", String(Math.floor(Date.now() / 1000) - 600)], { stdio: "ignore" });
  const exited = once(child, "exit").catch(() => undefined);
  const schema = `base_evm_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString, max: 1 });
  const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  try {
    const transport = http(rpcUrl, { retryCount: 0, timeout: 1000 });
    const client = createPublicClient({ chain: foundry, transport, cacheTime: 0 });
    const local = createTestClient({ chain: foundry, mode: "anvil", transport });
    const wallet = createWalletClient({ chain: foundry, account: testSigner, transport });
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { ready = await client.getChainId() === 31337; } catch { /* The disposable node is still starting. */ }
      if (ready) break;
      if (child.exitCode !== null) throw new Error("Local EVM exited during startup");
      await sleep(100);
    }
    assert.ok(ready, "Pinned local EVM must start");
    await admin.query(`CREATE SCHEMA ${schema}`);
    const migrated = spawnSync(process.execPath, ["scripts/migrate-v2.mjs"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 30000 });
    assert.equal(migrated.status, 0, "Local acceptance migrations must succeed");
    await local.setBalance({ address: testSigner.address, value: 10n ** 20n });
    const tokenArtifact = artifact("contract-base/out/Fixtures.sol/TestUSDC.json");
    const escrowArtifact = artifact("contract-base/out/LearningRewards.sol/LearningRewards.json");
    const wait = (hash: Hex) => client.waitForTransactionReceipt({ hash, pollingInterval: 10, timeout: 5000 });
    const tokenReceipt = await wait(await wallet.deployContract({ abi: tokenArtifact.abi, bytecode: tokenArtifact.bytecode.object }));
    const token = tokenReceipt.contractAddress!;
    const deploymentReceipt = await wait(await wallet.deployContract({ abi: escrowArtifact.abi, bytecode: escrowArtifact.bytecode.object, args: [token] }));
    const escrow = deploymentReceipt.contractAddress!;
    const write = async (address: Address, abi: Abi, functionName: string, args: unknown[]) => {
      const receipt = await wait(await wallet.writeContract({ address, abi, functionName, args }));
      assert.equal(receipt.status, "success"); return receipt;
    };
    await write(token, tokenArtifact.abi, "mint", [testSigner.address, 300000n]);
    await write(token, tokenArtifact.abi, "approve", [escrow, 300000n]);
    const startsAt = (await client.getBlock()).timestamp + 10n;
    const terms = { rewardAtomic: 100000n, maxClaims: 3, startsAt, endsAt: startsAt + 30n, claimDeadline: startsAt + 60n, termsHash: testHash(777), eligibilitySigner: testSigner.address };
    await write(escrow, escrowArtifact.abi, "createCampaign", [terms]);
    await write(token, tokenArtifact.abi, "mint", [escrow, 17n]);
    const anchor = await client.getBlock({ blockNumber: deploymentReceipt.blockNumber });
    const code = await client.getCode({ address: escrow }); assert.ok(code);
    const deployment = parseBaseDeployment({ chainId: 31337, rpcUrl, escrow, token, runtimeCodeHash: keccak256(code), deploymentBlock: anchor.number, deploymentBlockHash: anchor.hash, maxFinalizedLagSeconds: 3600 }, true);
    const reader = new RpcBaseChainReader(deployment, { allowLocalChain: true });
    const indexer = new BaseChainIndexer(pool, reader, { batchBlocks: 128 });
    const guarded = new ReconciledBaseChainReader(pool, reader);
    const binding = { chainId: 31337, escrow, onChainId: 1n };
    async function reconcile() {
      await local.mine({ blocks: 8, interval: 0 });
      await indexer.sync();
      return (await pool.query("SELECT * FROM base_chain_campaign_snapshots")).rows[0].accounting;
    }
    let accounting = await reconcile();
    assert.equal(accounting.fundedAtomic, "300000"); assert.equal(accounting.paidCount, 0);
    const funded = await guarded.readFinalizedCampaign(binding, AbortSignal.timeout(10000));
    assert.equal(funded.outstandingAtomic, 300000n);
    await local.setNextBlockTimestamp({ timestamp: startsAt + 1n });
    const claim = { campaignId: 1n, slot: 0, participantId: participant, recipient, amount: 100000n, deadline: terms.claimDeadline, signerEpoch: 1n };
    const signature = await testSigner.signTypedData(baseClaimTypedData(31337, escrow, claim));
    await write(escrow, escrowArtifact.abi, "claim", [claim, signature]);
    accounting = await reconcile(); assert.equal(accounting.paidCount, 1); assert.equal(accounting.outstandingAtomic, "200000");
    const paid = await guarded.readFinalizedCampaign(binding, AbortSignal.timeout(10000));
    assert.deepEqual(await guarded.readClaimUse(binding, claim, paid.blockHash, AbortSignal.timeout(10000)), { slotUsed: true, participantUsed: true });
    await write(escrow, escrowArtifact.abi, "rotateSigner", [1n, recipient]);
    await write(escrow, escrowArtifact.abi, "setPaused", [1n, true]);
    accounting = await reconcile(); assert.equal(accounting.signerEpoch, "2"); assert.equal(accounting.paused, true);
    await local.setNextBlockTimestamp({ timestamp: terms.claimDeadline + 1n });
    await write(escrow, escrowArtifact.abi, "refundExpired", [1n]);
    accounting = await reconcile(); assert.equal(accounting.refundedAtomic, "200000"); assert.equal(accounting.closed, true);
    const ledger = (await pool.query("SELECT totals FROM base_chain_deployments")).rows[0].totals;
    assert.equal(ledger.totalReserved, "0"); assert.equal(ledger.surplusAtomic, "17");
    assert.equal((await indexer.sync()).events, 0);
  } finally {
    child.kill("SIGTERM");
    const forced = setTimeout(() => child.kill("SIGKILL"), 3000);
    try { await exited; } finally { clearTimeout(forced); }
    await pool.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin.end(); }
  }
});
