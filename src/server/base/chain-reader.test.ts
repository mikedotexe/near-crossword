import assert from "node:assert/strict";
import { test } from "node:test";
import { RpcBaseChainReader, parseBaseDeployment } from "./chain-reader";
import { chainFixture, participant, testHash } from "./chain.fixture";
import { bounded } from "./bounded";
import { encodeAbiParameters, hashMessage } from "viem";
import { testSigner, rotatedTestSigner } from "./workflow.fixture";

test("Base deployment configuration fails closed without explicit matching pins", () => {
  const { deployment } = chainFixture();
  assert.throws(() => parseBaseDeployment(deployment), { code: "BASE_CHAIN_NOT_CONFIGURED" });
  for (const patch of [
    { chainId: 8453 }, { chainId: 84532 }, { runtimeCodeHash: "0x01" }, { maxFinalizedLagSeconds: 0 },
    { rpcUrl: "https://user:NEVER_PRINT@example.test" }, { rpcUrl: "http://example.test" }, { deploymentBlock: -1n },
  ]) assert.throws(() => parseBaseDeployment({ ...deployment, ...patch }, true), { code: "BASE_CHAIN_NOT_CONFIGURED" });
  assert.equal(parseBaseDeployment({ ...deployment, rpcUrl: "http://127.0.0.1:18545" }, true).chainId, 31337);
});

test("RPC reader verifies deployment and reads all state at the same canonical finalized hash", async () => {
  const fixture = chainFixture();
  const reader = new RpcBaseChainReader(fixture.deployment, { fetch: fixture.fetcher, allowLocalChain: true });
  const state = await reader.readFinalizedCampaign(fixture.base, AbortSignal.timeout(1000));
  assert.equal(state.fundedAtomic, 300000n); assert.equal(state.paidCount, 0); assert.equal(state.blockHash, testHash(10));
  const calls = fixture.requests.filter((request) => ["eth_call", "eth_getCode"].includes(request.method));
  assert.ok(calls.length >= 6);
  for (const call of calls) assert.deepEqual(call.params[1], { blockHash: testHash(10), requireCanonical: true });
  assert.ok(!fixture.requests.some((request) => /send|sign/.test(request.method)));
});

test("wrong chain, bytecode, token, anchor, insolvency and stale finality never produce a funding state", async () => {
  for (const kind of ["chain", "code", "token", "anchor", "balance", "stale"]) {
    const fixture = chainFixture();
    if (kind === "chain") fixture.control.chainId = 8453;
    if (kind === "code") fixture.control.code = "0x6001";
    if (kind === "token") fixture.control.token = fixture.deployment.escrow;
    if (kind === "anchor") fixture.blocks.get(10n)!.hash = testHash(91);
    if (kind === "balance") fixture.control.balanceOverride = 1n;
    if (kind === "stale") fixture.blocks.get(10n)!.timestamp -= 1000;
    const reader = new RpcBaseChainReader(fixture.deployment, { fetch: fixture.fetcher, allowLocalChain: true });
    await assert.rejects(reader.readFinalizedCampaign(fixture.base, AbortSignal.timeout(1000)), { code: "BASE_CHAIN_UNAVAILABLE" });
  }
});

test("claim-use reads reject another campaign and unfinalized or orphaned blocks", async () => {
  const fixture = chainFixture();
  const reader = new RpcBaseChainReader(fixture.deployment, { fetch: fixture.fetcher, allowLocalChain: true });
  const claim = { campaignId: 1n, slot: 0, participantId: participant, recipient: fixture.base.sponsor, amount: 100000n, deadline: BigInt(fixture.base.claimDeadline), signerEpoch: 1n };
  await assert.rejects(reader.readClaimUse(fixture.base, claim, testHash(11), AbortSignal.timeout(1000)));
  await assert.rejects(reader.readClaimUse(fixture.base, { ...claim, campaignId: 2n }, testHash(10), AbortSignal.timeout(1000)));
  fixture.control.finalized = 11n;
  assert.deepEqual(await reader.readClaimUse(fixture.base, claim, testHash(11), AbortSignal.timeout(1000)), { slotUsed: true, participantUsed: true });
});

test("RPC logs are hash scoped and exact duplicates are deduplicated", async () => {
  const fixture = chainFixture(); fixture.control.duplicateLogs = true;
  const reader = new RpcBaseChainReader(fixture.deployment, { fetch: fixture.fetcher, allowLocalChain: true });
  assert.equal((await reader.logs(fixture.blocks.get(10n)!, AbortSignal.timeout(1000))).length, 1);
  fixture.logs.get(10n)!.push({ ...fixture.logs.get(10n)![0], data: "0x" });
  await assert.rejects(reader.logs(fixture.blocks.get(10n)!, AbortSignal.timeout(1000)));
  fixture.logs.get(10n)!.pop();
  fixture.logs.get(10n)![0].blockHash = testHash(999);
  await assert.rejects(reader.logs(fixture.blocks.get(10n)!, AbortSignal.timeout(1000)));
});

test("RPC errors and aborted response bodies are sanitized without retries", async () => {
  const fixture = chainFixture(); let calls = 0;
  const reader = new RpcBaseChainReader(fixture.deployment, { allowLocalChain: true, fetch: async () => {
    calls++; throw new Error("private-api-key NEVER_PRINT");
  } });
  await assert.rejects(reader.block("finalized", AbortSignal.timeout(1000)), (error) => {
    assert.doesNotMatch(String(error), /private-api-key|NEVER_PRINT/); return true;
  });
  assert.equal(calls, 1);
  let aborted = false;
  const stalled = new RpcBaseChainReader(fixture.deployment, { allowLocalChain: true, fetch: async (_url, init) => new Response(new ReadableStream({
    start(controller) { init?.signal?.addEventListener("abort", () => { aborted = true; controller.error(new Error("NEVER_PRINT")); }, { once: true }); },
  }), { headers: { "content-type": "application/json" } }) });
  await assert.rejects(bounded((signal) => stalled.block("finalized", signal), 20));
  assert.equal(aborted, true);
});

test("wallet verification uses pinned EOA/ERC-1271 authority and never broadcasts or prepares counterfactual accounts", async () => {
  const fixture = chainFixture();
  const message = "Synthetic wallet control challenge";
  const signature = await testSigner.signMessage({ message });
  let contract = false; let magic = "0x1626ba7e";
  const fetcher: typeof fetch = async (url, init) => {
    const request = JSON.parse(String(init?.body));
    const [first, selector] = request.params || [];
    if ((request.method === "eth_getCode" && first.toLowerCase() === testSigner.address.toLowerCase()) ||
        (request.method === "eth_call" && first.to.toLowerCase() === testSigner.address.toLowerCase())) {
      assert.deepEqual(selector, { blockHash: testHash(10), requireCanonical: true });
      if (request.method === "eth_call") { assert.equal(first.gas, "0x30d40"); assert.ok(first.data.includes(hashMessage(message).slice(2))); }
      return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "eth_getCode" ? (contract ? "0xef0100" : "0x") : encodeAbiParameters([{ type: "bytes4" }], [magic as `0x${string}`]) });
    }
    return fixture.fetcher(url, init);
  };
  const reader = new RpcBaseChainReader(fixture.deployment, { fetch: fetcher, allowLocalChain: true });
  const input = { recipient: testSigner.address, message, signature };
  assert.equal(await reader.verifyWalletMessage(input, AbortSignal.timeout(1000)), true);
  assert.equal(await reader.verifyWalletMessage({ ...input, signature: await rotatedTestSigner.signMessage({ message }) }, AbortSignal.timeout(1000)), false);
  contract = true;
  assert.equal(await reader.verifyWalletMessage(input, AbortSignal.timeout(1000)), true);
  magic = "0xffffffff";
  assert.equal(await reader.verifyWalletMessage(input, AbortSignal.timeout(1000)), false, "No EOA fallback after contract rejection");
  const before = fixture.requests.length;
  assert.equal(await reader.verifyWalletMessage({ ...input, signature: `0x${"6492".repeat(16)}` }, AbortSignal.timeout(1000)), false);
  assert.equal(fixture.requests.length, before);
  assert.ok(!fixture.requests.some((r) => /send|sign/.test(r.method)));
});
