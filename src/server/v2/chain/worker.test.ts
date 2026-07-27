import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { MemoryRepository, resetMemoryRepositoryForTests } from "../memory-repository";
import type { Repository } from "../repository";
import type {
  Campaign,
  Claim,
  FundingOrder,
  FundingQuote,
  Job,
  JsonValue,
} from "../types";
import type {
  FinalizationDecision,
  FundingObservation,
} from "../funding/types";
import type {
  AllocateExternalFundingInput,
  OnChainCampaign,
  StorageRegistrationResult,
  SubmitContractClaimInput,
  V2ChainClient,
  WorkerLogger,
} from "./types";
import {
  enqueueCampaignLifecycle,
  enqueueCampaignRefund,
  enqueueFundingReconciliation,
} from "./jobs";
import { getV2Campaign, getV2CampaignClaimNonce } from "./view";
import { runChainWorkerBatch } from "./worker";

const NOW = new Date("2026-07-24T20:00:00.000Z");
const CREATOR_ACCOUNT = "creator.testnet";
const CONTRACT_ID = "campaigns.testnet";
const USDC_ID = "usdc.testnet";
const SOLUTION_KEY = Buffer.alloc(32, 7).toString("base64");
const CONTENT_HASH = "ab".repeat(32);
const PAYOUT_DIGEST = Buffer.alloc(32, 8).toString("base64");
const SIGNATURE = Buffer.alloc(64, 9).toString("base64");

function quote(): FundingQuote {
  return {
    rail: "ONE_CLICK",
    origin: { assetId: "eth:usdc", amountAtomic: "1000000" },
    principal: { assetId: "nep141:usdc.testnet", amountAtomic: "1000000" },
    routingFee: { assetId: "eth:usdc", amountAtomic: "1000" },
    platformFee: { assetId: "eth:usdc", amountAtomic: "0" },
    depositAddress: "deposit.testnet",
    depositMemo: null,
    deadline: "2026-07-24T20:05:00.000Z",
    providerQuoteId: "quote-1",
    providerStatus: "SUCCESS",
    rawDigest: "quote-digest",
    instructions: {},
  };
}

function directQuote(
  fundingReference: string,
  deadline = "2026-07-24T20:05:00.000Z",
): FundingQuote {
  return {
    ...quote(),
    rail: "DIRECT_NEAR",
    origin: {
      assetId: "nep141:usdc.testnet",
      amountAtomic: "1000000",
    },
    routingFee: {
      assetId: "nep141:usdc.testnet",
      amountAtomic: "0",
    },
    platformFee: {
      assetId: "nep141:usdc.testnet",
      amountAtomic: "0",
    },
    depositAddress: CONTRACT_ID,
    depositMemo: JSON.stringify({
      action: "create_campaign",
      funding_reference: fundingReference,
    }),
    deadline,
    providerQuoteId: fundingReference,
    providerStatus: "AWAITING_FT_TRANSFER_CALL",
  };
}

async function createCampaign(
  repository: Repository,
  status: Campaign["status"],
  id = "campaign-1",
  overrides: Partial<
    Parameters<Repository["createCampaign"]>[0]
  > = {},
): Promise<Campaign> {
  return repository.createCampaign({
    id,
    slug: id,
    creatorId: "actor-1",
    creatorAccountId: CREATOR_ACCOUNT,
    title: "A funded crossword campaign",
    description: null,
    sponsorName: "Sponsor",
    sponsorUrl: null,
    visibility: "PUBLIC",
    status,
    puzzle: {
      width: 3,
      height: 3,
      clues: [
        {
          number: 1,
          clue: "First clue",
          row: 0,
          column: 0,
          direction: "across",
          length: 3,
        },
        {
          number: 2,
          clue: "Second clue",
          row: 0,
          column: 0,
          direction: "down",
          length: 3,
        },
      ],
    },
    contentHash: CONTENT_HASH,
    solutionPublicKey: SOLUTION_KEY,
    reward: {
      type: "TOKEN_PRIZE",
      assetId: "nep141:usdc.testnet",
      amountAtomic: "1000000",
      decimals: 6,
      symbol: "USDC",
    },
    contractId: CONTRACT_ID,
    openingAt: "2026-07-24T19:00:00.000Z",
    expiresAt: "2026-07-31T19:00:00.000Z",
    refundAccount: CREATOR_ACCOUNT,
    fundingReference: null,
    chainCampaignId: null,
    ...overrides,
  });
}

async function createSettledOrder(
  repository: Repository,
  campaign: Campaign,
  overrides: Partial<
    Parameters<Repository["createFundingOrderIdempotent"]>[0]
  > = {},
): Promise<FundingOrder> {
  const result = await repository.createFundingOrderIdempotent({
    id: "order-1",
    campaignId: campaign.id,
    creatorId: campaign.creatorId,
    rail: "ONE_CLICK",
    status: "SETTLED",
    idempotencyKey: "funding-request-0001",
    originAssetId: "eth:usdc",
    destinationAssetId: "nep141:usdc.testnet",
    principalAmountAtomic: "1000000",
    inputAmountAtomic: "1001000",
    routingFeeAtomic: "1000",
    platformFeeAtomic: "0",
    refundTo: "0x0000000000000000000000000000000000000001",
    quote: quote(),
    providerReference: "quote-1",
    depositAddress: "deposit.testnet",
    depositTxHash: "deposit-hash",
    settlementTxHash: "settlement-hash",
    fundingReference: "intents:settlement-1",
    evidence: {},
    expiresAt: "2026-07-24T20:05:00.000Z",
    ...overrides,
  });
  return result.fundingOrder;
}

async function allocateOrder(
  repository: Repository,
  order: FundingOrder,
): Promise<FundingOrder> {
  const allocated = await repository.transitionFundingOrder(
    order.id,
    [order.status],
    "ALLOCATED",
    order.version,
  );
  assert.ok(allocated);
  return allocated;
}

async function enqueueAllocation(
  repository: Repository,
  campaign: Campaign,
  order: FundingOrder,
  maxAttempts = 3,
): Promise<Job> {
  const result = await repository.enqueueJob({
    id: "allocation-job",
    type: "ALLOCATE_EXTERNAL_FUNDING",
    aggregateType: "FUNDING_ORDER",
    aggregateId: order.id,
    deduplicationKey: `allocate:${order.id}`,
    payload: {
      fundingOrderId: order.id,
      campaignId: campaign.id,
      expectedAmountAtomic: order.principalAmountAtomic,
    },
    maxAttempts,
    runAfter: "2026-07-24T19:59:00.000Z",
  });
  return result.job;
}

function onChainCampaign(
  campaign: Campaign,
  overrides: Partial<OnChainCampaign> = {},
): OnChainCampaign {
  return {
    campaignId: campaign.id,
    creatorId: CREATOR_ACCOUNT,
    controllerId: CREATOR_ACCOUNT,
    sponsorId: CREATOR_ACCOUNT,
    contentHash: Buffer.from(CONTENT_HASH, "hex").toString("base64"),
    solutionPublicKey: SOLUTION_KEY,
    amount: "1000000",
    opensAtMs: String(new Date(campaign.openingAt!).getTime()),
    expiresAtMs: String(new Date(campaign.expiresAt!).getTime()),
    refundAccountId: CREATOR_ACCOUNT,
    claimNonce: "0",
    fundingReference: "intents:settlement-1",
    fundingRail: "intents",
    status: { state: "active" },
    ...overrides,
  };
}

class FakeChain implements V2ChainClient {
  readonly contractId = CONTRACT_ID;
  readonly usdcContractId = USDC_ID;
  readonly campaigns = new Map<string, OnChainCampaign>();
  readonly authorizedAllocations = new Map<string, OnChainCampaign>();
  readonly allocations: AllocateExternalFundingInput[] = [];
  readonly claims: SubmitContractClaimInput[] = [];
  readonly registrations: string[] = [];
  readonly cancellations: string[] = [];
  readonly expirations: string[] = [];
  readonly refundRetries: string[] = [];
  allocationError: Error | null = null;
  claimResult: "claimed" | "failed_transfer" = "claimed";

  async getCampaign(campaignId: string): Promise<OnChainCampaign | null> {
    return structuredClone(this.campaigns.get(campaignId) ?? null);
  }

  async allocateExternalFunding(
    input: AllocateExternalFundingInput,
  ): Promise<{ txHash: string }> {
    if (this.allocationError) throw this.allocationError;
    this.allocations.push(structuredClone(input));
    const authorization = this.authorizedAllocations.get(input.campaignId);
    if (!authorization) throw new Error("missing creator authorization fixture");
    assert.equal(authorization.fundingReference, input.fundingReference);
    this.campaigns.set(input.campaignId, structuredClone(authorization));
    return { txHash: "allocation-chain-hash" };
  }

  async ensureStorageRegistration(
    accountId: string,
  ): Promise<StorageRegistrationResult> {
    this.registrations.push(accountId);
    return { alreadyRegistered: false, txHash: "storage-chain-hash" };
  }

  async submitContractClaim(
    input: SubmitContractClaimInput,
  ): Promise<{ txHash: string }> {
    this.claims.push(structuredClone(input));
    const current = this.campaigns.get(input.campaignId)!;
    if (this.claimResult === "claimed") {
      this.campaigns.set(input.campaignId, {
        ...current,
        claimNonce: String(input.nonce + 1),
        status: {
          state: "claimed",
          receiverId: input.receiverId,
          payoutDigest: input.payoutDigest,
          nonce: String(input.nonce),
          claimedAtMs: String(NOW.getTime()),
        },
      });
    } else {
      this.campaigns.set(input.campaignId, {
        ...current,
        claimNonce: String(input.nonce + 1),
        status: { state: "active" },
      });
    }
    return { txHash: "claim-chain-hash" };
  }

  private finishRefund(campaignId: string): { txHash: string } {
    const current = this.campaigns.get(campaignId);
    assert.ok(current);
    this.campaigns.set(campaignId, {
      ...current,
      status: {
        state: "refunded",
        refundAccountId: current.refundAccountId,
        refundedAtMs: String(NOW.getTime()),
      },
    });
    return { txHash: "refund-chain-hash" };
  }

  async cancelBeforeOpen(campaignId: string): Promise<{ txHash: string }> {
    this.cancellations.push(campaignId);
    return this.finishRefund(campaignId);
  }

  async expireAndRefund(campaignId: string): Promise<{ txHash: string }> {
    this.expirations.push(campaignId);
    return this.finishRefund(campaignId);
  }

  async retryRefund(campaignId: string): Promise<{ txHash: string }> {
    this.refundRetries.push(campaignId);
    return this.finishRefund(campaignId);
  }
}

async function submittedClaim(
  repository: Repository,
  campaign: Campaign,
): Promise<Claim> {
  const created = await repository.createClaimIdempotent({
    id: "claim-1",
    campaignId: campaign.id,
    claimantId: "solver-1",
    status: "AWAITING_PROOF",
    idempotencyKey: "claim-request-0001",
    payout: {
      kind: "DIRECT_NEAR",
      destinationAsset: "nep141:usdc.testnet",
      recipient: "winner.testnet",
      recoveryAccount: "winner.testnet",
    },
    payoutQuote: null,
    solutionProofDigest: null,
    solutionProof: null,
    contractTxHash: null,
    settlementTxHash: null,
    evidence: {
      receiverId: "winner.testnet",
      payoutDigest: PAYOUT_DIGEST,
      nonce: "0",
      deadlineMs: "1784923500000",
    },
    expiresAt: "2026-07-24T20:05:00.000Z",
  });
  const submitted = await repository.submitClaimAtomically(
    created.claim.id,
    created.claim.version,
    campaign.version,
    "cd".repeat(32),
    {
      signature: SIGNATURE,
      nonce: "0",
      deadlineMs: "1784923500000",
      payoutDigest: PAYOUT_DIGEST,
    },
  );
  assert.ok(submitted);
  return submitted.claim;
}

async function submittedOneClickClaim(
  repository: Repository,
  campaign: Campaign,
): Promise<Claim> {
  const payoutQuote: FundingQuote = {
    rail: "ONE_CLICK",
    origin: {
      assetId: "nep141:usdc.testnet",
      amountAtomic: "1000000",
    },
    principal: {
      assetId: "nep141:usdc.testnet",
      amountAtomic: "1000000",
    },
    routingFee: {
      assetId: "nep141:usdc.testnet",
      amountAtomic: "0",
    },
    platformFee: {
      assetId: "nep141:usdc.testnet",
      amountAtomic: "0",
    },
    depositAddress: "route.testnet",
    depositMemo: null,
    deadline: "2026-07-24T20:05:00.000Z",
    providerQuoteId: "payout-quote-1",
    providerStatus: "PENDING_DEPOSIT",
    rawDigest: "ef".repeat(32),
    instructions: {},
  };
  const created = await repository.createClaimIdempotent({
    id: "claim-1",
    campaignId: campaign.id,
    claimantId: "solver-1",
    status: "AWAITING_PROOF",
    idempotencyKey: "claim-request-0001",
    payout: {
      kind: "ONE_CLICK",
      destinationAsset: "opaque:base-usdc-route",
      recipient: "0xwinner",
      recoveryAccount: "winner.testnet",
    },
    payoutQuote,
    solutionProofDigest: null,
    solutionProof: null,
    contractTxHash: null,
    settlementTxHash: null,
    evidence: {
      receiverId: "route.testnet",
      payoutDigest: PAYOUT_DIGEST,
      nonce: "0",
      deadlineMs: "1784923500000",
    },
    expiresAt: "2026-07-24T20:05:00.000Z",
  });
  const submitted = await repository.submitClaimAtomically(
    created.claim.id,
    created.claim.version,
    campaign.version,
    "de".repeat(32),
    {
      signature: SIGNATURE,
      nonce: "0",
      deadlineMs: "1784923500000",
      payoutDigest: PAYOUT_DIGEST,
    },
  );
  assert.ok(submitted);
  return submitted.claim;
}

async function enqueueClaim(
  repository: Repository,
  campaign: Campaign,
  claim: Claim,
  receiverId = "winner.testnet",
): Promise<Job> {
  const result = await repository.enqueueJob({
    id: "claim-job",
    type: "SUBMIT_CONTRACT_CLAIM",
    aggregateType: "CLAIM",
    aggregateId: claim.id,
    deduplicationKey: `claim:${claim.id}`,
    payload: {
      claimId: claim.id,
      campaignId: campaign.id,
      receiverId,
    },
    maxAttempts: 3,
    runAfter: "2026-07-24T19:59:00.000Z",
  });
  return result.job;
}

async function run(
  repository: Repository,
  chain: V2ChainClient,
  logger?: WorkerLogger,
  reconcileFunding?: (order: FundingOrder) => Promise<FinalizationDecision>,
  observeOneClickPayout?: (
    depositAddress: string,
  ) => Promise<FundingObservation>,
) {
  return runChainWorkerBatch(repository, chain, "worker-1", {
    now: NOW,
    verificationAttempts: 2,
    verificationDelayMs: 0,
    sleep: async () => undefined,
    logger,
    reconcileFunding,
    observeOneClickPayout,
  });
}

beforeEach(() => {
  resetMemoryRepositoryForTests();
});

afterEach(() => {
  delete process.env.V2_OPERATOR_PRIVATE_KEY;
});

describe("v2 chain worker", () => {
  it("fails unsupported leased jobs instead of abandoning their leases", async () => {
    const repository = new MemoryRepository();
    const { job } = await repository.enqueueJob({
      type: "RETIRED_LEGACY_JOB",
      aggregateType: "JOB",
      aggregateId: "retired-job",
      deduplicationKey: "unsupported:retired-job",
      payload: {},
      maxAttempts: 1,
      runAfter: "2026-07-24T20:00:00.000Z",
    });
    const result = await run(repository, new FakeChain());
    assert.equal(result.processed, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.ignored, 0);
    const after = await repository.leaseJobs(
      "inspect",
      10,
      "2026-07-25T00:00:00.000Z",
      "2026-07-25T00:00:00.000Z",
    );
    assert.equal(after.length, 0);
    const stored = await repository.enqueueJob({
      type: job.type,
      aggregateType: job.aggregateType,
      aggregateId: job.aggregateId,
      deduplicationKey: job.deduplicationKey,
      payload: job.payload,
      maxAttempts: job.maxAttempts,
      runAfter: job.runAfter,
    });
    assert.equal(stored.job.status, "DEAD");
  });

  it("allocates settled external funding with exact contract-v2 arguments", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "FUNDING");
    const order = await createSettledOrder(repository, campaign);
    await enqueueAllocation(repository, campaign, order);
    const chain = new FakeChain();
    chain.authorizedAllocations.set(campaign.id, onChainCampaign(campaign));

    const result = await run(repository, chain);
    assert.equal(result.succeeded, 1);
    assert.deepEqual(chain.allocations, [
      {
        campaignId: campaign.id,
        fundingReference: "intents:settlement-1",
      },
    ]);
    assert.equal((await repository.getFundingOrder(order.id))?.status, "ALLOCATED");
    assert.equal((await repository.getCampaign(campaign.id))?.status, "ACTIVE");
    assert.equal(
      (await repository.getCampaign(campaign.id))?.chainCampaignId,
      campaign.id,
    );
    const lifecycleJobs = await repository.leaseJobs(
      "other-worker",
      10,
      "2026-07-24T21:00:00.000Z",
      "2026-07-24T20:01:00.000Z",
    );
    assert.deepEqual(
      lifecycleJobs.map((candidate) => candidate.type),
      ["RECONCILE_CAMPAIGN_LIFECYCLE"],
    );
  });

  it("reconciles an existing on-chain allocation without rebroadcasting", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "FUNDING");
    const order = await createSettledOrder(repository, campaign);
    await enqueueAllocation(repository, campaign, order);
    const chain = new FakeChain();
    chain.campaigns.set(campaign.id, onChainCampaign(campaign));

    const result = await run(repository, chain);
    assert.equal(result.succeeded, 1);
    assert.equal(chain.allocations.length, 0);
    assert.equal((await repository.getFundingOrder(order.id))?.status, "ALLOCATED");
  });

  it("rejects reconciliation when immutable on-chain campaign fields differ", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "FUNDING");
    const order = await createSettledOrder(repository, campaign);
    await enqueueAllocation(repository, campaign, order);
    const chain = new FakeChain();
    chain.campaigns.set(
      campaign.id,
      onChainCampaign(campaign, {
        controllerId: "unexpected-controller.testnet",
      }),
    );

    const result = await run(repository, chain);
    assert.equal(result.failed, 1);
    assert.equal(chain.allocations.length, 0);
    assert.equal((await repository.getFundingOrder(order.id))?.status, "SETTLED");
    assert.equal((await repository.getCampaign(campaign.id))?.status, "FUNDING");
  });

  it("observes 1Click settlement durably and enqueues allocation", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "FUNDING");
    const order = await createSettledOrder(repository, campaign, {
      status: "AWAITING_DEPOSIT",
      depositTxHash: null,
      settlementTxHash: null,
      fundingReference: null,
    });
    await enqueueFundingReconciliation(
      repository,
      order,
      "2026-07-24T19:59:00.000Z",
    );
    const chain = new FakeChain();
    const reconcileFunding = async (): Promise<FinalizationDecision> => ({
      readyForAllocation: true,
      terminal: true,
      observation: {
        providerStatus: "SUCCESS",
        orderStatus: "SETTLED",
        depositTxHash: "observed-deposit-hash",
        settlementTxHash: "observed-settlement-hash",
        fundingReference: "intents:observed-settlement",
        evidence: { provider: "one-click-simulator" },
      },
    });

    const result = await run(
      repository,
      chain,
      undefined,
      reconcileFunding,
    );
    assert.equal(result.succeeded, 1);
    const settled = await repository.getFundingOrder(order.id);
    assert.equal(settled?.status, "SETTLED");
    assert.equal(settled?.depositTxHash, "observed-deposit-hash");
    assert.equal(settled?.fundingReference, "intents:observed-settlement");

    const ready = await repository.leaseJobs(
      "inspection-worker",
      10,
      "2026-07-24T21:00:00.000Z",
      "2026-07-24T20:00:00.000Z",
    );
    assert.deepEqual(
      ready.map((candidate) => candidate.type).sort(),
      ["ALLOCATE_EXTERNAL_FUNDING"],
    );
    const recurring = await repository.leaseJobs(
      "inspection-worker-2",
      10,
      "2026-07-24T21:00:00.000Z",
      "2026-07-24T20:00:15.000Z",
    );
    assert.deepEqual(
      recurring.map((candidate) => candidate.type),
      ["RECONCILE_FUNDING_ORDER"],
    );
    assert.equal(recurring[0].attempts, 1);
  });

  it("never allocates an incomplete 1Click deposit even if an adapter marks it ready", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "FUNDING");
    const order = await createSettledOrder(repository, campaign, {
      status: "AWAITING_DEPOSIT",
      depositTxHash: null,
      settlementTxHash: null,
      fundingReference: null,
    });
    await enqueueFundingReconciliation(
      repository,
      order,
      "2026-07-24T19:59:00.000Z",
    );
    const chain = new FakeChain();
    const reconcileFunding = async (): Promise<FinalizationDecision> => ({
      readyForAllocation: true,
      terminal: false,
      observation: {
        providerStatus: "INCOMPLETE_DEPOSIT",
        orderStatus: "INCOMPLETE",
        depositTxHash: "partial-deposit-hash",
        settlementTxHash: null,
        fundingReference: null,
        evidence: {
          provider: "one-click-simulator",
          depositedAmount: "500000",
        },
      },
    });

    const result = await run(
      repository,
      chain,
      undefined,
      reconcileFunding,
    );
    assert.equal(result.succeeded, 1);
    assert.equal(chain.allocations.length, 0);
    assert.equal(
      (await repository.getFundingOrder(order.id))?.status,
      "INCOMPLETE",
    );
    const pending = await repository.leaseJobs(
      "inspection-worker",
      10,
      "2026-07-24T21:00:00.000Z",
      "2026-07-24T20:00:15.000Z",
    );
    assert.deepEqual(
      pending.map((candidate) => candidate.type),
      ["RECONCILE_FUNDING_ORDER"],
    );
  });

  it("refuses a stale allocation job for an existing incomplete order", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "FUNDING");
    const order = await createSettledOrder(repository, campaign, {
      status: "INCOMPLETE",
      settlementTxHash: null,
      fundingReference: null,
    });
    await enqueueAllocation(repository, campaign, order, 1);
    const chain = new FakeChain();

    const result = await run(repository, chain);
    assert.equal(result.failed, 1);
    assert.equal(chain.allocations.length, 0);
    assert.equal(
      (await repository.getFundingOrder(order.id))?.status,
      "INCOMPLETE",
    );
    assert.equal((await repository.getCampaign(campaign.id))?.status, "FUNDING");
  });

  it("recognizes direct ft_transfer_call funding from final contract state", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "FUNDING");
    const fundingReference = "campaign:campaign-1:direct-request";
    const quotedDirect = directQuote(fundingReference);
    const order = await createSettledOrder(repository, campaign, {
      rail: "DIRECT_NEAR",
      status: "AWAITING_DEPOSIT",
      originAssetId: "nep141:usdc.testnet",
      inputAmountAtomic: "1000000",
      routingFeeAtomic: "0",
      providerReference: fundingReference,
      depositAddress: CONTRACT_ID,
      depositTxHash: null,
      settlementTxHash: null,
      fundingReference: null,
      quote: quotedDirect,
    });
    await enqueueFundingReconciliation(
      repository,
      order,
      "2026-07-24T19:59:00.000Z",
    );
    const chain = new FakeChain();
    chain.campaigns.set(
      campaign.id,
      onChainCampaign(campaign, {
        fundingReference,
        fundingRail: "direct_usdc",
      }),
    );

    const result = await run(repository, chain);
    assert.equal(result.succeeded, 1);
    assert.equal(chain.allocations.length, 0);
    assert.equal((await repository.getFundingOrder(order.id))?.status, "ALLOCATED");
    assert.equal(
      (await repository.getFundingOrder(order.id))?.fundingReference,
      fundingReference,
    );
    assert.equal((await repository.getCampaign(campaign.id))?.status, "ACTIVE");
  });

  it("keeps direct funding reconcilable during the finality grace window", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "FUNDING");
    const fundingReference = "campaign:campaign-1:direct-grace";
    const deadline = "2026-07-24T19:59:30.000Z";
    const order = await createSettledOrder(repository, campaign, {
      rail: "DIRECT_NEAR",
      status: "AWAITING_DEPOSIT",
      originAssetId: "nep141:usdc.testnet",
      inputAmountAtomic: "1000000",
      routingFeeAtomic: "0",
      providerReference: fundingReference,
      depositAddress: CONTRACT_ID,
      depositTxHash: null,
      settlementTxHash: null,
      fundingReference: null,
      quote: directQuote(fundingReference, deadline),
      expiresAt: deadline,
    });
    await enqueueFundingReconciliation(
      repository,
      order,
      "2026-07-24T19:59:00.000Z",
    );

    const result = await run(repository, new FakeChain());
    assert.equal(result.succeeded, 1);
    assert.equal(
      (await repository.getFundingOrder(order.id))?.status,
      "AWAITING_DEPOSIT",
    );
  });

  it("recovers a matching direct campaign discovered after its order expired", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "FUNDING");
    const fundingReference = "campaign:campaign-1:direct-final";
    const deadline = "2026-07-24T19:57:00.000Z";
    const order = await createSettledOrder(repository, campaign, {
      rail: "DIRECT_NEAR",
      status: "EXPIRED",
      originAssetId: "nep141:usdc.testnet",
      inputAmountAtomic: "1000000",
      routingFeeAtomic: "0",
      providerReference: fundingReference,
      depositAddress: CONTRACT_ID,
      depositTxHash: null,
      settlementTxHash: null,
      fundingReference: null,
      quote: directQuote(fundingReference, deadline),
      expiresAt: deadline,
    });
    await enqueueFundingReconciliation(
      repository,
      order,
      "2026-07-24T19:59:00.000Z",
    );
    const chain = new FakeChain();
    chain.campaigns.set(
      campaign.id,
      onChainCampaign(campaign, {
        fundingReference,
        fundingRail: "direct_usdc",
      }),
    );

    const result = await run(repository, chain);
    assert.equal(result.succeeded, 1);
    assert.equal(chain.allocations.length, 0);
    assert.equal((await repository.getFundingOrder(order.id))?.status, "ALLOCATED");
    assert.equal((await repository.getCampaign(campaign.id))?.status, "ACTIVE");
  });

  it("advances a scheduled campaign when final chain state becomes active", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "SCHEDULED");
    const order = await allocateOrder(
      repository,
      await createSettledOrder(repository, campaign),
    );
    await enqueueCampaignLifecycle(
      repository,
      campaign.id,
      order.id,
      "2026-07-24T19:59:00.000Z",
    );
    const chain = new FakeChain();
    chain.campaigns.set(campaign.id, onChainCampaign(campaign));

    const result = await run(repository, chain);
    assert.equal(result.succeeded, 1);
    assert.equal((await repository.getCampaign(campaign.id))?.status, "ACTIVE");
    assert.equal(chain.expirations.length, 0);
  });

  it("expires and refunds an active campaign with final callback verification", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "ACTIVE", "campaign-1", {
      expiresAt: "2026-07-24T19:59:00.000Z",
    });
    const order = await allocateOrder(
      repository,
      await createSettledOrder(repository, campaign),
    );
    await enqueueCampaignLifecycle(
      repository,
      campaign.id,
      order.id,
      "2026-07-24T19:59:00.000Z",
    );
    const chain = new FakeChain();
    chain.campaigns.set(campaign.id, onChainCampaign(campaign));

    const lifecycle = await run(repository, chain);
    assert.equal(lifecycle.succeeded, 1);
    assert.equal((await repository.getCampaign(campaign.id))?.status, "REFUNDING");
    const refund = await run(repository, chain);
    assert.equal(refund.succeeded, 1);
    assert.deepEqual(chain.expirations, [campaign.id]);
    assert.equal((await repository.getCampaign(campaign.id))?.status, "REFUNDED");
    assert.equal((await repository.getFundingOrder(order.id))?.status, "REFUNDED");
  });

  it("uses the callback retry method for a recoverable on-chain refund", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "REFUNDING");
    const order = await allocateOrder(
      repository,
      await createSettledOrder(repository, campaign),
    );
    await enqueueCampaignRefund(
      repository,
      campaign.id,
      order.id,
      "EXPIRED",
      "2026-07-24T19:59:00.000Z",
    );
    const chain = new FakeChain();
    chain.campaigns.set(
      campaign.id,
      onChainCampaign(campaign, {
        status: {
          state: "refunding",
          refundAccountId: CREATOR_ACCOUNT,
          refundAttempt: "0",
          refundInFlight: false,
        },
      }),
    );

    const result = await run(repository, chain);
    assert.equal(result.succeeded, 1);
    assert.deepEqual(chain.refundRetries, [campaign.id]);
    assert.equal((await repository.getCampaign(campaign.id))?.status, "REFUNDED");
  });

  it("registers the payout account, submits exact claim args, and verifies claimed state", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "ACTIVE");
    const claim = await submittedClaim(repository, campaign);
    await enqueueClaim(repository, campaign, claim);
    const chain = new FakeChain();
    chain.campaigns.set(campaign.id, onChainCampaign(campaign));

    const result = await run(repository, chain);
    assert.equal(result.succeeded, 1);
    assert.deepEqual(chain.registrations, ["winner.testnet"]);
    assert.deepEqual(chain.claims, [
      {
        campaignId: campaign.id,
        receiverId: "winner.testnet",
        payoutDigest: PAYOUT_DIGEST,
        nonce: 0,
        deadlineMs: 1784923500000,
        signature: SIGNATURE,
      },
    ]);
    assert.equal((await repository.getClaim(claim.id))?.status, "PAID");
    assert.equal(
      (await repository.getClaim(claim.id))?.contractTxHash,
      "claim-chain-hash",
    );
    assert.equal((await repository.getCampaign(campaign.id))?.status, "CLAIMED");
  });

  it("keeps a 1Click claim pending until its downstream receipt settles", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "ACTIVE");
    const claim = await submittedOneClickClaim(repository, campaign);
    await enqueueClaim(repository, campaign, claim, "route.testnet");
    const chain = new FakeChain();
    chain.campaigns.set(campaign.id, onChainCampaign(campaign));

    const deposit = await run(repository, chain);
    assert.equal(deposit.succeeded, 1);
    assert.deepEqual(chain.registrations, ["route.testnet"]);
    assert.equal((await repository.getClaim(claim.id))?.status, "PAYING");
    assert.equal((await repository.getCampaign(campaign.id))?.status, "CLAIMING");

    const observeOneClickPayout = async (
      depositAddress: string,
    ): Promise<FundingObservation> => {
      assert.equal(depositAddress, "route.testnet");
      return {
        providerStatus: "SUCCESS",
        orderStatus: "SETTLED",
        depositTxHash: "contract-deposit-receipt",
        settlementTxHash: "destination-receipt",
        fundingReference: null,
        evidence: {
          provider: "one-click-simulator",
          depositAddress,
          depositTxHash: "contract-deposit-receipt",
          settlementTxHash: "destination-receipt",
          responseDigest: "aa".repeat(32),
        },
      };
    };
    const routed = await run(
      repository,
      chain,
      undefined,
      undefined,
      observeOneClickPayout,
    );
    assert.equal(routed.succeeded, 1);
    assert.equal((await repository.getClaim(claim.id))?.status, "PAID");
    assert.equal(
      (await repository.getClaim(claim.id))?.settlementTxHash,
      "destination-receipt",
    );
    assert.equal((await repository.getCampaign(campaign.id))?.status, "CLAIMED");
  });

  it("repairs the terminal 1Click crash window without observing or recounting escrow", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "ACTIVE");
    const claim = await submittedOneClickClaim(repository, campaign);
    await enqueueClaim(repository, campaign, claim, "route.testnet");
    const chain = new FakeChain();
    chain.campaigns.set(campaign.id, onChainCampaign(campaign));

    const deposited = await run(repository, chain);
    assert.equal(deposited.succeeded, 1);
    const paying = await repository.getClaim(claim.id);
    assert.equal(paying?.status, "PAYING");
    assert.equal(
      eventObject(paying?.evidence).contractState,
      "claimed",
    );
    assert.deepEqual(await repository.getLiveLiabilities(), {
      amountAtomic: "0",
      campaignCount: 0,
      routingInFlightAmountAtomic: "1000000",
      routingInFlightCampaignCount: 1,
    });

    // Model the former two-write failure boundary: the claim receipt landed,
    // then the process stopped before the campaign liability row was released.
    const terminal = await repository.transitionClaim(
      paying!.id,
      ["PAYING"],
      "PAID",
      paying!.version,
      {
        settlementTxHash: "destination-receipt",
        evidence: {
          ...eventObject(paying?.evidence),
          oneClickProviderStatus: "SUCCESS",
          oneClickOutcome: "SETTLED",
          downstreamReceipt: "destination-receipt",
          responseDigest: "dd".repeat(32),
        },
      },
    );
    assert.ok(terminal);
    assert.equal((await repository.getCampaign(campaign.id))?.status, "CLAIMING");
    assert.deepEqual(await repository.getLiveLiabilities(), {
      amountAtomic: "0",
      campaignCount: 0,
      routingInFlightAmountAtomic: "0",
      routingInFlightCampaignCount: 0,
    });

    let observations = 0;
    const repaired = await run(
      repository,
      chain,
      undefined,
      undefined,
      async (): Promise<FundingObservation> => {
        observations += 1;
        throw new Error("terminal repair must not call the provider");
      },
    );
    assert.equal(repaired.succeeded, 1);
    assert.equal(repaired.failed, 0);
    assert.equal(observations, 0);
    assert.equal((await repository.getCampaign(campaign.id))?.status, "CLAIMED");
    assert.equal((await repository.getClaim(claim.id))?.status, "PAID");
    assert.deepEqual(await repository.getLiveLiabilities(), {
      amountAtomic: "0",
      campaignCount: 0,
      routingInFlightAmountAtomic: "0",
      routingInFlightCampaignCount: 0,
    });
    assert.equal(
      (
        await repository.listEvents("CLAIM", claim.id)
      ).filter((event) => event.eventType === "ONE_CLICK_PAYOUT_SETTLED").length,
      1,
    );
  });

  it("records a terminal 1Click refund to the winner recovery account", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "ACTIVE");
    const claim = await submittedOneClickClaim(repository, campaign);
    await enqueueClaim(repository, campaign, claim, "route.testnet");
    const chain = new FakeChain();
    chain.campaigns.set(campaign.id, onChainCampaign(campaign));

    await run(repository, chain);
    const recovered = await run(
      repository,
      chain,
      undefined,
      undefined,
      async (depositAddress): Promise<FundingObservation> => ({
        providerStatus: "REFUNDED",
        orderStatus: "REFUNDED",
        depositTxHash: "contract-deposit-receipt",
        settlementTxHash: "winner-refund-receipt",
        fundingReference: null,
        evidence: {
          provider: "one-click-simulator",
          depositAddress,
          depositTxHash: "contract-deposit-receipt",
          settlementTxHash: "winner-refund-receipt",
          responseDigest: "bb".repeat(32),
        },
      }),
    );

    assert.equal(recovered.succeeded, 1);
    const current = await repository.getClaim(claim.id);
    assert.equal(current?.status, "RECOVERED");
    assert.equal(current?.settlementTxHash, "winner-refund-receipt");
    assert.equal(
      eventObject(current?.evidence).winnerRecoveryAccount,
      "winner.testnet",
    );
    assert.equal((await repository.getCampaign(campaign.id))?.status, "CLAIMED");
  });

  it("does not report provider success without a downstream receipt", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "ACTIVE");
    const claim = await submittedOneClickClaim(repository, campaign);
    await enqueueClaim(repository, campaign, claim, "route.testnet");
    const chain = new FakeChain();
    chain.campaigns.set(campaign.id, onChainCampaign(campaign));

    await run(repository, chain);
    const pending = await run(
      repository,
      chain,
      undefined,
      undefined,
      async (depositAddress): Promise<FundingObservation> => ({
        providerStatus: "SUCCESS",
        orderStatus: "SETTLED",
        depositTxHash: "contract-deposit-receipt",
        settlementTxHash: null,
        fundingReference: null,
        evidence: {
          provider: "one-click-simulator",
          depositAddress,
          depositTxHash: "contract-deposit-receipt",
          settlementTxHash: null,
          responseDigest: "cc".repeat(32),
        },
      }),
    );

    assert.equal(pending.succeeded, 1);
    assert.equal((await repository.getClaim(claim.id))?.status, "PAYING");
    assert.equal((await repository.getCampaign(campaign.id))?.status, "CLAIMING");
    const tooSoon = await repository.leaseJobs(
      "inspection-worker",
      10,
      "2026-07-24T21:00:00.000Z",
      "2026-07-24T20:00:14.999Z",
    );
    assert.equal(tooSoon.length, 0);
    const retry = await repository.leaseJobs(
      "inspection-worker",
      10,
      "2026-07-24T21:00:00.000Z",
      "2026-07-24T20:00:15.000Z",
    );
    assert.deepEqual(
      retry.map((candidate) => candidate.type),
      ["RECONCILE_ONE_CLICK_PAYOUT"],
    );
  });

  it("recovers a failed token payout when the contract consumed the permit nonce", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "ACTIVE");
    const claim = await submittedClaim(repository, campaign);
    await enqueueClaim(repository, campaign, claim);
    const chain = new FakeChain();
    chain.claimResult = "failed_transfer";
    chain.campaigns.set(campaign.id, onChainCampaign(campaign));

    const result = await run(repository, chain);
    assert.equal(result.succeeded, 1);
    assert.equal((await repository.getClaim(claim.id))?.status, "FAILED");
    assert.equal((await repository.getCampaign(campaign.id))?.status, "ACTIVE");
    assert.equal(
      eventObject((await repository.getClaim(claim.id))?.evidence).nextClaimNonce,
      "1",
    );
  });

  it("recovers an expired permit without storage or claim broadcasts", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "ACTIVE");
    const created = await repository.createClaimIdempotent({
      id: "claim-1",
      campaignId: campaign.id,
      claimantId: "solver-1",
      status: "AWAITING_PROOF",
      idempotencyKey: "claim-request-0001",
      payout: {
        kind: "DIRECT_NEAR",
        destinationAsset: "nep141:usdc.testnet",
        recipient: "winner.testnet",
        recoveryAccount: "winner.testnet",
      },
      payoutQuote: null,
      solutionProofDigest: null,
      solutionProof: null,
      contractTxHash: null,
      settlementTxHash: null,
      evidence: {
        receiverId: "winner.testnet",
        payoutDigest: PAYOUT_DIGEST,
        nonce: "0",
        deadlineMs: String(NOW.getTime() - 1),
      },
      expiresAt: "2026-07-24T20:05:00.000Z",
    });
    const submitted = await repository.submitClaimAtomically(
      created.claim.id,
      created.claim.version,
      campaign.version,
      "cd".repeat(32),
      {
        signature: SIGNATURE,
        nonce: "0",
        deadlineMs: String(NOW.getTime() - 1),
        payoutDigest: PAYOUT_DIGEST,
      },
    );
    assert.ok(submitted);
    await enqueueClaim(repository, campaign, submitted.claim);
    const chain = new FakeChain();
    chain.campaigns.set(campaign.id, onChainCampaign(campaign));

    const result = await run(repository, chain);
    assert.equal(result.succeeded, 1);
    assert.equal(chain.registrations.length, 0);
    assert.equal(chain.claims.length, 0);
    assert.equal((await repository.getClaim(created.claim.id))?.status, "FAILED");
    assert.equal((await repository.getCampaign(campaign.id))?.status, "ACTIVE");
  });

  it("keeps the campaign claimed when a different on-chain permit won", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "ACTIVE");
    const claim = await submittedClaim(repository, campaign);
    await enqueueClaim(repository, campaign, claim);
    const chain = new FakeChain();
    chain.campaigns.set(
      campaign.id,
      onChainCampaign(campaign, {
        claimNonce: "1",
        status: {
          state: "claimed",
          receiverId: "other-winner.testnet",
          payoutDigest: Buffer.alloc(32, 1).toString("base64"),
          nonce: "0",
          claimedAtMs: String(NOW.getTime()),
        },
      }),
    );

    const result = await run(repository, chain);
    assert.equal(result.succeeded, 1);
    assert.equal(chain.claims.length, 0);
    assert.equal((await repository.getClaim(claim.id))?.status, "FAILED");
    assert.equal((await repository.getCampaign(campaign.id))?.status, "CLAIMED");
  });

  it("keeps allocation recoverable, schedules a bounded retry, and redacts secrets", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, "FUNDING");
    const order = await createSettledOrder(repository, campaign);
    const job = await enqueueAllocation(repository, campaign, order);
    const chain = new FakeChain();
    const secret = `ed25519:${"S".repeat(64)}`;
    process.env.V2_OPERATOR_PRIVATE_KEY = secret;
    chain.allocationError = new Error(`RPC rejected key ${secret}`);
    const logEntries: JsonValue[] = [];
    const logger: WorkerLogger = {
      info: (_message, metadata) => logEntries.push(metadata ?? null),
      error: (_message, metadata) => logEntries.push(metadata ?? null),
    };

    const result = await run(repository, chain, logger);
    assert.equal(result.failed, 1);
    assert.equal((await repository.getFundingOrder(order.id))?.status, "ALLOCATING");
    const leased = await repository.leaseJobs(
      "inspection-worker",
      10,
      "2026-07-24T21:00:00.000Z",
      "2026-07-24T20:00:04.999Z",
    );
    assert.equal(leased.length, 0);
    const retry = await repository.leaseJobs(
      "inspection-worker",
      10,
      "2026-07-24T21:00:00.000Z",
      "2026-07-24T20:00:05.000Z",
    );
    assert.equal(retry.length, 1);
    assert.equal(retry[0].id, job.id);
    assert.doesNotMatch(retry[0].lastError ?? "", /SSSS/);
    assert.doesNotMatch(JSON.stringify(logEntries), /SSSS/);
  });
});

describe("v2 contract view helper", () => {
  it("parses final get_campaign state and exposes the live claim nonce", async () => {
    const campaign = await createCampaign(new MemoryRepository(), "ACTIVE", "view-one");
    const raw = {
      campaign_id: campaign.id,
      creator_id: CREATOR_ACCOUNT,
      controller_id: CREATOR_ACCOUNT,
      sponsor_id: CREATOR_ACCOUNT,
      content_hash: Buffer.from(CONTENT_HASH, "hex").toString("base64"),
      solution_public_key: SOLUTION_KEY,
      amount: "1000000",
      opens_at_ms: new Date(campaign.openingAt!).getTime(),
      expires_at_ms: new Date(campaign.expiresAt!).getTime(),
      refund_account_id: CREATOR_ACCOUNT,
      claim_nonce: 4,
      funding_reference: "intents:settlement-1",
      funding_rail: "intents",
      status: { state: "active" },
    };
    const provider = {
      async query() {
        return { result: [...Buffer.from(JSON.stringify(raw), "utf8")] };
      },
    };

    const view = await getV2Campaign(campaign.id, {
      contractId: CONTRACT_ID,
      provider,
    });
    assert.equal(view?.claimNonce, "4");
    assert.equal(
      await getV2CampaignClaimNonce(campaign.id, {
        contractId: CONTRACT_ID,
        provider,
      }),
      "4",
    );
  });
});

function eventObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
