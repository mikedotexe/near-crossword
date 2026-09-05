import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, erc20Abi, keccak256, numberToHex, toEventSelector, type Address, type Hex } from "viem";
import { learningRewardsAbi } from "../../lib/base/escrow-abi";
import { parseBaseDeployment, type ChainBlock, type EscrowLog } from "./chain-reader";
import type { FinalizedCampaignState } from "./issuer";
import { recipient, testSigner } from "./workflow.fixture";

export const testHash = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
export const participant = testHash(900);
export const testCode = "0x60006000f3" as const;
export function encodeEscrowEvent(name: string, args: Record<string, unknown>, block: ChainBlock, logIndex = 0): EscrowLog {
  const event = learningRewardsAbi.find((item) => item.type === "event" && item.name === name);
  if (!event || event.type !== "event") throw new Error("Unknown test event");
  const plain = event.inputs.filter((input) => !("indexed" in input && input.indexed));
  const indexed = event.inputs.filter((input) => "indexed" in input && input.indexed);
  return {
    blockHash: block.hash, blockNumber: block.number, transactionHash: testHash(Number(block.number) * 100 + logIndex), transactionIndex: logIndex, logIndex,
    topics: [toEventSelector(event), ...indexed.map((input) => encodeAbiParameters([input], [args[input.name]]))],
    data: encodeAbiParameters(plain, plain.map((input) => args[input.name])),
  };
}

// An independent synthetic RPC transcript, not states derived from the event reducer under test.
export function chainFixture() {
  const now = Math.floor(Date.now() / 1000);
  const blocks = new Map<bigint, ChainBlock>([10, 11, 12, 13, 14].map((n) => [BigInt(n), {
    number: BigInt(n), hash: testHash(n), parentHash: testHash(n - 1), timestamp: now - 120 + (n - 10) * 30,
  }]));
  const deployment = parseBaseDeployment({
    chainId: 31337, escrow: "0x4444444444444444444444444444444444444444", token: "0x5555555555555555555555555555555555555555",
    runtimeCodeHash: keccak256(testCode), deploymentBlock: 10n, deploymentBlockHash: testHash(10),
    maxFinalizedLagSeconds: 300, rpcUrl: "https://rpc.example.test/private-api-key",
  }, true);
  const base: FinalizedCampaignState = {
    chainId: 31337, escrow: deployment.escrow, onChainId: 1n, token: deployment.token,
    sponsor: "0x6666666666666666666666666666666666666666", rewardAtomic: 100000n, maxClaims: 3,
    startsAt: now - 90, endsAt: now + 3600, claimDeadline: now + 90000,
    termsHash: testHash(88), fundedAtomic: 300000n, outstandingAtomic: 300000n, refundedAtomic: 0n, paidCount: 0,
    signer: testSigner.address.toLowerCase() as Address, signerEpoch: 1n, paused: false, closed: false,
    blockHash: testHash(10), blockNumber: 10n, blockTimestamp: now - 120, observedAt: now,
  };
  const terms = { rewardAtomic: base.rewardAtomic, maxClaims: base.maxClaims, startsAt: BigInt(base.startsAt), endsAt: BigInt(base.endsAt), claimDeadline: BigInt(base.claimDeadline), termsHash: base.termsHash, eligibilitySigner: base.signer };
  const logs = new Map<bigint, EscrowLog[]>([
    [10n, [encodeEscrowEvent("CampaignFunded", { campaignId: 1n, sponsor: base.sponsor, token: base.token, terms, fundedAtomic: 300000n, signerEpoch: 1n }, blocks.get(10n)!)]],
    [11n, [encodeEscrowEvent("RewardPaid", { campaignId: 1n, slot: 0, participantId: participant, recipient, amount: 100000n }, blocks.get(11n)!)]],
  ]);
  const control = { latest: 12n, finalized: 10n, chainId: 31337, code: testCode as Hex, token: deployment.token, balanceExtra: 0n, balanceOverride: null as bigint | null, countOverride: null as bigint | null, omitLogs: false, duplicateLogs: false, paidFrom: 11n };
  const requests: Array<{ method: string; params: unknown[] }> = [];
  function stateAt(block: ChainBlock) {
    const paidCount = block.number >= control.paidFrom ? 1 : 0;
    return { ...base, paidCount, outstandingAtomic: 300000n - BigInt(paidCount) * 100000n, blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp };
  }
  const fetcher: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    if (init?.redirect !== "error" || !init.signal) throw new Error("Test requires bounded no-redirect transport");
    const [first, second] = request.params || [];
    let result: unknown;
    if (request.method === "eth_chainId") result = numberToHex(control.chainId);
    else if (request.method === "eth_getBlockByNumber" || request.method === "eth_getBlockByHash") {
      const block = request.method === "eth_getBlockByHash" ? [...blocks.values()].find((b) => b.hash === first) : blocks.get(first === "latest" ? control.latest : first === "finalized" ? control.finalized : BigInt(first));
      result = block ? { number: numberToHex(block.number), hash: block.hash, parentHash: block.parentHash, timestamp: numberToHex(block.timestamp), transactions: [] } : null;
    } else if (request.method === "eth_getLogs") {
      const block = [...blocks.values()].find((b) => b.hash === first.blockHash);
      if (!block || first.address !== deployment.escrow) throw new Error("Wrong log scope");
      const selected = control.omitLogs ? [] : logs.get(block.number) || [];
      result = [...selected, ...(control.duplicateLogs ? selected : [])].map((log) => ({
        ...log, address: deployment.escrow, removed: false, blockNumber: numberToHex(log.blockNumber), logIndex: numberToHex(log.logIndex), transactionIndex: numberToHex(log.transactionIndex),
      }));
    } else if (request.method === "eth_getCode" || request.method === "eth_call") {
      if (!second?.blockHash || second.requireCanonical !== true) throw new Error("Unpinned test request");
      const block = [...blocks.values()].find((b) => b.hash === second.blockHash);
      if (!block) throw new Error("Noncanonical test hash");
      const state = stateAt(block);
      if (request.method === "eth_getCode") result = control.code;
      else if (first.to.toLowerCase() === deployment.token) {
        result = encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: control.balanceOverride ?? state.outstandingAtomic + control.balanceExtra });
      } else {
        const call = decodeFunctionData({ abi: learningRewardsAbi, data: first.data });
        if (call.functionName === "getCampaign") result = encodeFunctionResult({ abi: learningRewardsAbi, functionName: "getCampaign", result: {
          sponsor: state.sponsor, terms: { ...terms, eligibilitySigner: state.signer }, fundedAtomic: state.fundedAtomic,
          refundedAtomic: state.refundedAtomic, signerEpoch: state.signerEpoch, paidCount: state.paidCount, paused: state.paused, closed: state.closed,
        } });
        else if (call.functionName === "token") result = encodeFunctionResult({ abi: learningRewardsAbi, functionName: "token", result: control.token });
        else if (call.functionName === "outstanding") result = encodeFunctionResult({ abi: learningRewardsAbi, functionName: "outstanding", result: state.outstandingAtomic });
        else if (call.functionName === "totalReserved") result = encodeFunctionResult({ abi: learningRewardsAbi, functionName: "totalReserved", result: state.outstandingAtomic });
        else if (call.functionName === "campaignCount") result = encodeFunctionResult({ abi: learningRewardsAbi, functionName: "campaignCount", result: control.countOverride ?? 1n });
        else if (call.functionName === "usedSlots" || call.functionName === "claimedParticipants") result = encodeFunctionResult({ abi: learningRewardsAbi, functionName: call.functionName, result: state.paidCount === 1 });
      }
    }
    if (result === undefined) throw new Error("Unexpected test RPC method");
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  };
  return { deployment, base, blocks, logs, control, fetcher, requests, stateAt };
}
