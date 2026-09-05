import { createPublicClient, decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, hashMessage, http, keccak256, parseAbi, verifyMessage, type Address, type Hex } from "viem";
import { z } from "zod";
import { baseNativeUsdc, learningRewardsAbi } from "../../lib/base/escrow-abi";
import type { BaseClaim } from "../../lib/base/claim";
import type { BaseChainReader, ChainBinding, FinalizedCampaignState } from "./issuer";
import { AppError } from "../v2/errors";
import { call, verifyMessage as verifyOnchainMessage } from "viem/actions";
import { accountFactoryAbi, counterfactualCreation, type CounterfactualPolicy } from "./counterfactual";

export const chainHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((v) => v.toLowerCase() as Hex);
const erc1271Abi = parseAbi(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]);
const address = z.string().transform((v) => getAddress(v).toLowerCase() as Address).refine((v) => BigInt(v) !== 0n);
const configSchema = z.object({
  chainId: z.union([z.literal(8453), z.literal(84532), z.literal(31337)]),
  escrow: address, token: address, runtimeCodeHash: chainHash,
  deploymentBlock: z.bigint().nonnegative(), deploymentBlockHash: chainHash,
  maxFinalizedLagSeconds: z.number().int().min(1).max(86400),
  rpcUrl: z.string().url(),
}).strict();
export type BaseDeployment = z.infer<typeof configSchema>;
export function deploymentPins(deployment: BaseDeployment) {
  const { chainId, escrow, token, runtimeCodeHash, deploymentBlock, deploymentBlockHash, maxFinalizedLagSeconds } = deployment;
  return { chainId, escrow, token, runtimeCodeHash, deploymentBlock: deploymentBlock.toString(), deploymentBlockHash, maxFinalizedLagSeconds };
}
export interface ChainBlock { number: bigint; hash: Hex; parentHash: Hex; timestamp: number }
export interface EscrowLog {
  blockHash: Hex; blockNumber: bigint; transactionHash: Hex; transactionIndex: number; logIndex: number;
  data: Hex; topics: [Hex, ...Hex[]];
}
export interface EscrowTotals { campaignCount: bigint; totalReserved: bigint; balance: bigint }
export function chainFailure(code = "BASE_CHAIN_UNAVAILABLE"): never {
  throw new AppError(503, code, "Verified Base accounting is unavailable; retry or reconcile before proceeding");
}
export function chainInteger(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) chainFailure();
  return number;
}
export function parseBaseDeployment(raw: unknown, allowLocalChain = false): BaseDeployment {
  try {
    const config = configSchema.parse(raw);
    const url = new URL(config.rpcUrl);
    const local = allowLocalChain && config.chainId === 31337;
    if (url.username || url.password || url.hash ||
        (url.protocol !== "https:" && !(local && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) ||
        (!local && config.chainId === 31337) || config.escrow === config.token ||
        (config.chainId !== 31337 && config.token !== baseNativeUsdc[config.chainId])) throw new Error();
    return Object.freeze(config);
  } catch { throw new AppError(503, "BASE_CHAIN_NOT_CONFIGURED", "Reviewed Base deployment pins and finality policy are required"); }
}

// These are operator configuration, never request parameters. No signer or broadcast method exists here.
export function baseDeploymentFromEnvironment(): BaseDeployment {
  try {
    const chainId = Number(process.env.BASE_CHAIN_ID);
    if (chainId !== 8453 && chainId !== 84532) throw new Error();
    return parseBaseDeployment({
      chainId, token: baseNativeUsdc[chainId], escrow: process.env.BASE_ESCROW_ADDRESS,
      runtimeCodeHash: process.env.BASE_ESCROW_RUNTIME_CODE_HASH,
      deploymentBlock: BigInt(process.env.BASE_ESCROW_DEPLOYMENT_BLOCK || "-1"),
      deploymentBlockHash: process.env.BASE_ESCROW_DEPLOYMENT_BLOCK_HASH,
      maxFinalizedLagSeconds: Number(process.env.BASE_MAX_FINALIZED_LAG_SECONDS), rpcUrl: process.env.BASE_RPC_URL,
    });
  } catch { throw new AppError(503, "BASE_CHAIN_NOT_CONFIGURED", "Reviewed Base deployment pins and finality policy are required"); }
}

export interface BaseAccountingReader extends BaseChainReader {
  readonly deployment: BaseDeployment;
  block(tag: "latest" | "finalized" | bigint, signal: AbortSignal): Promise<ChainBlock>;
  logs(block: ChainBlock, signal: AbortSignal): Promise<EscrowLog[]>;
  verifyDeployment(block: ChainBlock, signal: AbortSignal): Promise<void>;
  campaignAt(id: bigint, block: ChainBlock, signal: AbortSignal): Promise<FinalizedCampaignState>;
  totalsAt(block: ChainBlock, signal: AbortSignal): Promise<EscrowTotals>;
}

export class RpcBaseChainReader implements BaseAccountingReader {
  readonly deployment: BaseDeployment;
  get maxFinalizedLagSeconds() { return this.deployment.maxFinalizedLagSeconds; }
  constructor(config: BaseDeployment, private readonly options: { fetch?: typeof fetch; allowLocalChain?: boolean; counterfactual?: CounterfactualPolicy } = {}) {
    this.deployment = parseBaseDeployment(config, options.allowLocalChain);
  }
  private client(signal: AbortSignal) {
    signal.throwIfAborted();
    return createPublicClient({
      cacheTime: 0, ccipRead: false,
      transport: http(this.deployment.rpcUrl, {
        retryCount: 0, timeout: 10000, batch: false, maxResponseBodySize: 2 * 1024 * 1024,
        fetchFn: this.options.fetch, fetchOptions: { signal, redirect: "error" },
        methods: { include: ["eth_chainId", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getCode", "eth_call", "eth_getLogs"] },
      }),
    });
  }
  private async safe<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch { chainFailure(); }
  }
  private binding(binding: ChainBinding) {
    if (binding.chainId !== this.deployment.chainId || binding.escrow.toLowerCase() !== this.deployment.escrow ||
        binding.onChainId <= 0n || binding.onChainId >= 1n << 256n) chainFailure();
  }
  async block(tag: "latest" | "finalized" | bigint, signal: AbortSignal): Promise<ChainBlock> {
    return this.safe(async () => {
      const client = this.client(signal);
      if (await client.getChainId() !== this.deployment.chainId) chainFailure();
      const block = await client.getBlock(typeof tag === "bigint" ? { blockNumber: tag } : { blockTag: tag });
      if (block.number === null || block.number < 0n || (typeof tag === "bigint" && block.number !== tag)) chainFailure();
      return { number: block.number, hash: chainHash.parse(block.hash), parentHash: chainHash.parse(block.parentHash), timestamp: chainInteger(block.timestamp) };
    });
  }
  async verifyDeployment(block: ChainBlock, signal: AbortSignal): Promise<void> {
    return this.safe(async () => {
      const client = this.client(signal);
      if (block.number < this.deployment.deploymentBlock || await client.getChainId() !== this.deployment.chainId) chainFailure();
      const anchor = await this.block(this.deployment.deploymentBlock, signal);
      if (anchor.hash !== this.deployment.deploymentBlockHash) chainFailure();
      const selector = { blockHash: block.hash, requireCanonical: true } as const;
      const code = await client.getCode({ address: this.deployment.escrow, ...selector });
      if (!code || keccak256(code) !== this.deployment.runtimeCodeHash) chainFailure();
      const token = await client.readContract({ address: this.deployment.escrow, abi: learningRewardsAbi, functionName: "token", ...selector });
      if (token.toLowerCase() !== this.deployment.token) chainFailure();
      const canonical = await this.block(block.number, signal);
      if (canonical.hash !== block.hash) chainFailure();
    });
  }
  async campaignAt(id: bigint, block: ChainBlock, signal: AbortSignal): Promise<FinalizedCampaignState> {
    return this.safe(async () => {
      const client = this.client(signal);
      const selector = { address: this.deployment.escrow, abi: learningRewardsAbi, blockHash: block.hash, requireCanonical: true } as const;
      const campaign = await client.readContract({ ...selector, functionName: "getCampaign", args: [id] });
      const outstandingAtomic = await client.readContract({ ...selector, functionName: "outstanding", args: [id] });
      return {
        chainId: this.deployment.chainId, escrow: this.deployment.escrow, onChainId: id,
        token: this.deployment.token, sponsor: campaign.sponsor.toLowerCase() as Address,
        rewardAtomic: campaign.terms.rewardAtomic, maxClaims: campaign.terms.maxClaims,
        startsAt: chainInteger(campaign.terms.startsAt), endsAt: chainInteger(campaign.terms.endsAt), claimDeadline: chainInteger(campaign.terms.claimDeadline),
        termsHash: campaign.terms.termsHash, fundedAtomic: campaign.fundedAtomic, outstandingAtomic,
        refundedAtomic: campaign.refundedAtomic, paidCount: campaign.paidCount,
        signer: campaign.terms.eligibilitySigner.toLowerCase() as Address, signerEpoch: campaign.signerEpoch,
        paused: campaign.paused, closed: campaign.closed,
        blockHash: block.hash, blockNumber: block.number, blockTimestamp: block.timestamp, observedAt: Math.floor(Date.now() / 1000),
      };
    });
  }
  async totalsAt(block: ChainBlock, signal: AbortSignal): Promise<EscrowTotals> {
    return this.safe(async () => {
      const client = this.client(signal);
      const selector = { blockHash: block.hash, requireCanonical: true } as const;
      const contract = { address: this.deployment.escrow, abi: learningRewardsAbi, ...selector } as const;
      const campaignCount = await client.readContract({ ...contract, functionName: "campaignCount" });
      const totalReserved = await client.readContract({ ...contract, functionName: "totalReserved" });
      const balance = await client.readContract({ address: this.deployment.token, abi: erc20Abi, functionName: "balanceOf", args: [this.deployment.escrow], ...selector });
      return { campaignCount, totalReserved, balance };
    });
  }
  async logs(block: ChainBlock, signal: AbortSignal): Promise<EscrowLog[]> {
    return this.safe(async () => {
      const logs = await this.client(signal).getLogs({ address: this.deployment.escrow, blockHash: block.hash });
      if (logs.length > 2000) chainFailure();
      const unique = new Map<number, EscrowLog>();
      for (const log of logs) {
        if (log.removed || log.address.toLowerCase() !== this.deployment.escrow || log.blockHash !== block.hash ||
            log.blockNumber !== block.number || log.logIndex === null || log.transactionIndex === null ||
            !Number.isSafeInteger(log.logIndex) || log.logIndex < 0 || !Number.isSafeInteger(log.transactionIndex) || log.transactionIndex < 0 ||
            !/^0x(?:[0-9a-fA-F]{2})*$/.test(log.data) || !log.topics.length || log.topics.length > 4) chainFailure();
        const parsed: EscrowLog = {
          blockHash: block.hash, blockNumber: block.number, transactionHash: chainHash.parse(log.transactionHash),
          transactionIndex: log.transactionIndex, logIndex: log.logIndex, data: log.data.toLowerCase() as Hex,
          topics: log.topics.map((topic) => chainHash.parse(topic)) as [Hex, ...Hex[]],
        };
        const existing = unique.get(parsed.logIndex);
        if (existing && JSON.stringify({ ...existing, blockNumber: String(existing.blockNumber) }) !== JSON.stringify({ ...parsed, blockNumber: String(parsed.blockNumber) })) chainFailure();
        unique.set(parsed.logIndex, parsed);
      }
      return [...unique.values()].sort((a, b) => a.logIndex - b.logIndex);
    });
  }
  async readFinalizedCampaign(binding: ChainBinding, signal: AbortSignal): Promise<FinalizedCampaignState> {
    this.binding(binding);
    const block = await this.block("finalized", signal);
    const now = Math.floor(Date.now() / 1000);
    if (block.timestamp > now + 30 || block.timestamp < now - this.maxFinalizedLagSeconds) chainFailure();
    await this.verifyDeployment(block, signal);
    const state = await this.campaignAt(binding.onChainId, block, signal);
    const totals = await this.totalsAt(block, signal);
    if (totals.balance < totals.totalReserved || totals.totalReserved < state.outstandingAtomic || totals.campaignCount < binding.onChainId ||
        (await this.block(block.number, signal)).hash !== block.hash) chainFailure();
    return state;
  }
  async readClaimUse(binding: ChainBinding, claim: BaseClaim, blockHash: Hex, signal: AbortSignal) {
    this.binding(binding);
    return this.safe(async () => {
      if (claim.campaignId !== binding.onChainId) chainFailure();
      const client = this.client(signal);
      const block = await client.getBlock({ blockHash });
      if (block.number === null || (await this.block("finalized", signal)).number < block.number ||
          (await this.block(block.number, signal)).hash !== blockHash) chainFailure();
      const selector = { address: this.deployment.escrow, abi: learningRewardsAbi, blockHash, requireCanonical: true } as const;
      const slotUsed = await client.readContract({ ...selector, functionName: "usedSlots", args: [binding.onChainId, claim.slot] });
      const participantUsed = await client.readContract({ ...selector, functionName: "claimedParticipants", args: [binding.onChainId, claim.participantId] });
      if ((await this.block(block.number, signal)).hash !== blockHash) chainFailure();
      return { slotUsed, participantUsed };
    });
  }

  async verifyWalletMessage(input: { recipient: Address; message: string; signature: Hex }, signal: AbortSignal) {
    return this.safe(async () => {
      // Delegation preparation is not supported. Counterfactual simulation is separately pinned.
      if (input.signature.endsWith("8010".repeat(16))) return false;
      const wrapped = input.signature.endsWith("6492".repeat(16));
      if (wrapped && !this.options.counterfactual) return false;
      const block = await this.block("finalized", signal);
      const now = Math.floor(Date.now() / 1000);
      if (block.timestamp > now + 30 || block.timestamp < now - this.maxFinalizedLagSeconds) chainFailure();
      await this.verifyDeployment(block, signal);
      const client = this.client(signal);
      const selector = { blockHash: block.hash, requireCanonical: true } as const;
      const code = await client.getCode({ address: input.recipient, ...selector });
      let valid: boolean;
      if (wrapped) {
        const policy = this.options.counterfactual!;
        const creation = counterfactualCreation(input.signature, policy);
        const factoryCode = await client.getCode({ address: policy.factory, ...selector });
        if (!factoryCode || keccak256(factoryCode) !== policy.factoryCodeHash) return false;
        const implementation = await client.readContract({ address: policy.factory, abi: accountFactoryAbi, functionName: "implementation", ...selector });
        const implementationCode = await client.getCode({ address: implementation, ...selector });
        if (!implementationCode || keccak256(implementationCode) !== policy.implementationCodeHash) return false;
        const predicted = await client.readContract({ address: policy.factory, abi: accountFactoryAbi, functionName: "getAddress", args: [creation.owners, creation.nonce], ...selector });
        if (predicted.toLowerCase() !== input.recipient.toLowerCase()) return false;
        const boundedClient = client.extend((base) => ({ call: (args: Parameters<typeof call>[1]) => call(base, { ...args, gas: 1000000n }) }));
        valid = await verifyOnchainMessage(boundedClient, { address: input.recipient, message: input.message, signature: input.signature, ...selector });
      } else if (code && code !== "0x") {
        // Contract authority wins, including delegated EOAs. Never fall back to an old EOA key.
        const result = await client.call({ to: input.recipient, gas: 200000n, ...selector,
          data: encodeFunctionData({ abi: erc1271Abi, functionName: "isValidSignature", args: [hashMessage(input.message), input.signature] }) });
        const magic = decodeFunctionResult({ abi: erc1271Abi, functionName: "isValidSignature", data: result.data || "0x" });
        valid = magic === "0x1626ba7e";
      } else {
        valid = await verifyMessage({ address: input.recipient, message: input.message, signature: input.signature });
      }
      if ((await this.block(block.number, signal)).hash !== block.hash) chainFailure();
      signal.throwIfAborted();
      return valid;
    });
  }
}
