import type { Repository } from "../repository";
import { fundingAdapter } from "../funding";
import { observeOneClickTransfer } from "../funding/one-click";
import type {
  FinalizationDecision,
  FundingObservation,
} from "../funding/types";
import type {
  Campaign,
  Claim,
  FundingOrder,
  Job,
  JsonValue,
  OperationEvent,
} from "../types";
import type {
  AllocateExternalFundingInput,
  OnChainCampaign,
  SubmitContractClaimInput,
  V2ChainClient,
  WorkerLogger,
} from "./types";
import {
  enqueueCampaignLifecycle,
  enqueueCampaignRefund,
  type RefundReason,
} from "./jobs";
import {
  reconcileOneClickPayout,
  repairTerminalOneClickPayout,
} from "./one-click-payout";

const SUPPORTED_JOB_TYPES = new Set([
  "ALLOCATE_EXTERNAL_FUNDING",
  "SUBMIT_CONTRACT_CLAIM",
  "RECONCILE_FUNDING_ORDER",
  "RECONCILE_CAMPAIGN_LIFECYCLE",
  "RECONCILE_ONE_CLICK_PAYOUT",
  "REFUND_CAMPAIGN",
]);
// Jobs execute sequentially through one operator account to avoid access-key
// nonce races. Keep the lease long enough for a full NEAR transaction,
// callback, final-state verification, and earlier jobs in the same batch.
const DEFAULT_LEASE_MS = 15 * 60_000;
const DEFAULT_RETRY_BASE_MS = 5_000;
const DEFAULT_RETRY_MAX_MS = 5 * 60_000;
const DEFAULT_RECONCILE_MS = 15_000;
const DEFAULT_LIFECYCLE_POLL_MS = 5 * 60_000;
const DEFAULT_REFUND_POLL_MS = 2_000;
const DIRECT_FUNDING_FINALITY_GRACE_MS = 2 * 60_000;
const MAX_ON_CHAIN_REFUND_ATTEMPTS = 8;
const RESCHEDULE_FIELD = "__workerRescheduleAt";

export interface WorkerBatchOptions {
  limit?: number;
  now?: Date;
  leaseMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  verificationAttempts?: number;
  verificationDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  reconcileFunding?: (order: FundingOrder) => Promise<FinalizationDecision>;
  observeOneClickPayout?: (
    depositAddress: string,
    depositMemo?: string | null,
    expectedQuote?: FundingOrder["quote"],
  ) => Promise<FundingObservation>;
  logger?: WorkerLogger;
}

export interface WorkerBatchResult {
  leased: number;
  processed: number;
  succeeded: number;
  failed: number;
  ignored: number;
}

interface ProcessingContext {
  repository: Repository;
  chain: V2ChainClient;
  job: Job;
  nowMs: number;
  verificationAttempts: number;
  verificationDelayMs: number;
  sleep: (milliseconds: number) => Promise<void>;
  reconcileFunding: (order: FundingOrder) => Promise<FinalizationDecision>;
  observeOneClickPayout: (
    depositAddress: string,
    depositMemo?: string | null,
    expectedQuote?: FundingOrder["quote"],
  ) => Promise<FundingObservation>;
}

function object(value: JsonValue, label: string): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function stringField(
  value: Record<string, JsonValue>,
  field: string,
  label: string,
): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || !candidate) {
    throw new Error(`${label}.${field} must be a non-empty string`);
  }
  return candidate;
}

function safeInteger(value: string, label: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be an unsigned integer`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`${label} exceeds JavaScript's safe integer range`);
  }
  return number;
}

function isoMilliseconds(value: string | null, label: string): number {
  if (!value) throw new Error(`${label} is required`);
  const milliseconds = new Date(value).getTime();
  if (!Number.isSafeInteger(milliseconds)) {
    throw new Error(`${label} is invalid`);
  }
  return milliseconds;
}

function hexDigestToBase64(value: string): string {
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error("Campaign content hash must be a 32-byte hexadecimal digest");
  }
  return Buffer.from(value, "hex").toString("base64");
}

function exactBase64(value: string, bytes: number, label: string): string {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== bytes || decoded.toString("base64") !== value) {
    throw new Error(`${label} must be canonical base64 for exactly ${bytes} bytes`);
  }
  return value;
}

function eventEvidence(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function rescheduleResult(result: Record<string, JsonValue>, runAfterMs: number): JsonValue {
  return {
    ...result,
    [RESCHEDULE_FIELD]: new Date(runAfterMs).toISOString(),
  };
}

function rescheduleAt(result: JsonValue): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const value = result[RESCHEDULE_FIELD];
  return typeof value === "string" ? value : null;
}

function nextPoll(nowMs: number, targetMs: number, maximumDelayMs: number): number {
  return Math.max(nowMs + 250, Math.min(targetMs, nowMs + maximumDelayMs));
}

function expectedFundingReference(order: FundingOrder): string | null {
  return order.fundingReference ?? order.providerReference;
}

function campaignTargetState(
  campaign: OnChainCampaign,
): "SCHEDULED" | "ACTIVE" {
  if (campaign.status.state === "scheduled") return "SCHEDULED";
  if (campaign.status.state === "active") return "ACTIVE";
  throw new Error(
    `Allocated campaign has unexpected on-chain state ${campaign.status.state}`,
  );
}

function assertAllocationMatches(
  onChain: OnChainCampaign,
  order: FundingOrder,
  campaign: Campaign,
): void {
  const fundingReference = expectedFundingReference(order);
  const expectedFundingRail =
    order.rail === "DIRECT_NEAR" ? "direct_usdc" : "intents";
  if (
    onChain.campaignId !== campaign.id ||
    onChain.amount !== order.principalAmountAtomic ||
    !fundingReference ||
    onChain.fundingReference !== fundingReference ||
    onChain.creatorId !== campaign.creatorAccountId ||
    onChain.controllerId !== campaign.creatorAccountId ||
    onChain.sponsorId !== campaign.creatorAccountId ||
    onChain.refundAccountId !== campaign.refundAccount ||
    onChain.opensAtMs !==
      String(isoMilliseconds(campaign.openingAt, "campaign.openingAt")) ||
    onChain.expiresAtMs !==
      String(isoMilliseconds(campaign.expiresAt, "campaign.expiresAt")) ||
    onChain.contentHash !== hexDigestToBase64(campaign.contentHash ?? "") ||
    onChain.solutionPublicKey !== campaign.solutionPublicKey ||
    onChain.fundingRail !== expectedFundingRail
  ) {
    throw new Error("On-chain campaign does not match the immutable funding order");
  }
  campaignTargetState(onChain);
}

function buildAllocationInput(
  order: FundingOrder,
  campaign: Campaign,
): AllocateExternalFundingInput {
  if (campaign.reward.type !== "TOKEN_PRIZE") {
    throw new Error("Only token-prize campaigns can be allocated on-chain");
  }
  if (
    !campaign.creatorAccountId ||
    !campaign.contentHash ||
    !campaign.solutionPublicKey ||
    !campaign.openingAt ||
    !campaign.expiresAt ||
    !campaign.refundAccount
  ) {
    throw new Error("Campaign is missing immutable contract funding fields");
  }
  if (!order.fundingReference) {
    throw new Error("Settled funding order has no unique funding reference");
  }
  if (
    order.principalAmountAtomic !== campaign.reward.amountAtomic ||
    order.destinationAssetId !== campaign.reward.assetId
  ) {
    throw new Error("Funding order principal does not match the campaign reward");
  }
  if (order.rail !== "ONE_CLICK" && order.rail !== "MOCK") {
    throw new Error(`Funding rail ${order.rail} is not an external allocation rail`);
  }
  hexDigestToBase64(campaign.contentHash);
  exactBase64(
    campaign.solutionPublicKey,
    32,
    "Campaign solution public key",
  );
  isoMilliseconds(campaign.openingAt, "campaign.openingAt");
  isoMilliseconds(campaign.expiresAt, "campaign.expiresAt");

  return {
    campaignId: campaign.id,
    fundingReference: order.fundingReference,
  };
}

async function appendEventOnce(
  repository: Repository,
  input: Omit<OperationEvent, "id" | "createdAt">,
): Promise<void> {
  const events = await repository.listEvents(input.aggregateType, input.aggregateId);
  if (
    events.some(
      (event) =>
        event.eventType === input.eventType &&
        event.idempotencyKey === input.idempotencyKey,
    )
  ) {
    return;
  }
  await repository.appendEvent(input);
}

async function verifiedCampaign(
  context: ProcessingContext,
  campaignId: string,
  terminal: (campaign: OnChainCampaign | null) => boolean,
): Promise<OnChainCampaign | null> {
  let campaign: OnChainCampaign | null = null;
  for (let attempt = 0; attempt < context.verificationAttempts; attempt += 1) {
    campaign = await context.chain.getCampaign(campaignId);
    if (terminal(campaign)) return campaign;
    if (attempt + 1 < context.verificationAttempts) {
      await context.sleep(context.verificationDelayMs);
    }
  }
  return campaign;
}

async function transitionAllocationLedger(
  context: ProcessingContext,
  orderId: string,
  campaignId: string,
  onChain: OnChainCampaign,
  allocationTxHash: string | null,
): Promise<void> {
  const repository = context.repository;
  let campaign = await repository.getCampaign(campaignId);
  let order = await repository.getFundingOrder(orderId);
  if (!campaign || !order) throw new Error("Allocation ledger records disappeared");
  assertAllocationMatches(onChain, order, campaign);
  const allocationStates: FundingOrder["status"][] =
    order.rail === "DIRECT_NEAR"
      ? [
          "QUOTED",
          "AWAITING_DEPOSIT",
          "DEPOSIT_DETECTED",
          "PROCESSING",
          "SETTLED",
          "ALLOCATING",
          "INCOMPLETE",
          "EXPIRED",
        ]
      : ["SETTLED", "ALLOCATING"];
  if (
    order.status !== "ALLOCATED" &&
    !allocationStates.includes(order.status)
  ) {
    throw new Error(
      `Funding order is not reconcilable as allocated from state ${order.status}`,
    );
  }

  const target = campaignTargetState(onChain);
  if (
    campaign.status !== target ||
    campaign.chainCampaignId !== onChain.campaignId ||
    campaign.fundingReference !== onChain.fundingReference ||
    campaign.contractId !== context.chain.contractId
  ) {
    const transitioned = await repository.transitionCampaign(
      campaign.id,
      ["FUNDING", "SCHEDULED", "ACTIVE"],
      target,
      campaign.version,
      {
        fundingReference: onChain.fundingReference,
        chainCampaignId: onChain.campaignId,
        contractId: context.chain.contractId,
      },
    );
    if (!transitioned) {
      campaign = (await repository.getCampaign(campaign.id))!;
      if (
        campaign.status !== target ||
        campaign.chainCampaignId !== onChain.campaignId
      ) {
        throw new Error("Campaign allocation ledger transition conflicted");
      }
    } else {
      campaign = transitioned;
    }
  }

  order = (await repository.getFundingOrder(order.id))!;
  if (order.status !== "ALLOCATED") {
    const transitioned = await repository.transitionFundingOrder(
      order.id,
      allocationStates,
      "ALLOCATED",
      order.version,
      {
        fundingReference: onChain.fundingReference,
        evidence: {
          ...eventEvidence(order.evidence),
          allocationTxHash,
          contractCampaignId: onChain.campaignId,
          contractState: onChain.status.state,
          verifiedClaimNonce: onChain.claimNonce,
        },
      },
    );
    if (!transitioned) {
      order = (await repository.getFundingOrder(order.id))!;
      if (order.status !== "ALLOCATED") {
        throw new Error("Funding allocation ledger transition conflicted");
      }
    } else {
      order = transitioned;
    }
  }

  await appendEventOnce(repository, {
    aggregateType: "FUNDING_ORDER",
    aggregateId: order.id,
    eventType: "EXTERNAL_FUNDING_ALLOCATED_ON_CHAIN",
    actorId: null,
    fromState: "ALLOCATING",
    toState: "ALLOCATED",
    idempotencyKey: `chain-allocation:${order.id}`,
    evidence: {
      allocationTxHash,
      contractCampaignId: onChain.campaignId,
      fundingReference: onChain.fundingReference,
      contractState: onChain.status.state,
    },
  });
  await appendEventOnce(repository, {
    aggregateType: "CAMPAIGN",
    aggregateId: campaign.id,
    eventType: "CAMPAIGN_ACTIVATED_ON_CHAIN",
    actorId: null,
    fromState: "FUNDING",
    toState: target,
    idempotencyKey: `chain-activation:${campaign.id}`,
    evidence: {
      allocationTxHash,
      contractId: context.chain.contractId,
      contractCampaignId: onChain.campaignId,
    },
  });
  await enqueueCampaignLifecycle(
    repository,
    campaign.id,
    order.id,
    new Date(context.nowMs).toISOString(),
  );
}

async function processAllocation(context: ProcessingContext): Promise<JsonValue> {
  const payload = object(context.job.payload, "allocation job payload");
  const orderId = stringField(payload, "fundingOrderId", "allocation job payload");
  const campaignId = stringField(payload, "campaignId", "allocation job payload");
  const expectedAmount = stringField(
    payload,
    "expectedAmountAtomic",
    "allocation job payload",
  );
  let order = await context.repository.getFundingOrder(orderId);
  const campaign = await context.repository.getCampaign(campaignId);
  if (!order || !campaign || order.campaignId !== campaign.id) {
    throw new Error("Allocation job references missing or mismatched ledger records");
  }
  if (order.principalAmountAtomic !== expectedAmount) {
    throw new Error("Allocation job amount does not match its funding order");
  }

  if (!["SETTLED", "ALLOCATING"].includes(order.status)) {
    throw new Error(`Funding order is not allocatable from state ${order.status}`);
  }

  const existing = await context.chain.getCampaign(campaign.id);
  if (existing) {
    assertAllocationMatches(existing, order, campaign);
    await transitionAllocationLedger(
      context,
      order.id,
      campaign.id,
      existing,
      null,
    );
    return {
      outcome: "reconciled",
      campaignId: campaign.id,
      contractState: existing.status.state,
    };
  }

  if (order.status === "ALLOCATING") {
    throw new Error(
      "Allocation is in flight but has no final on-chain campaign to reconcile",
    );
  }
  const transitioned = await context.repository.transitionFundingOrder(
    order.id,
    ["SETTLED"],
    "ALLOCATING",
    order.version,
    {
      evidence: {
        ...eventEvidence(order.evidence),
        allocationStartedAt: new Date().toISOString(),
      },
    },
  );
  if (!transitioned) throw new Error("Funding order changed before allocation");
  order = transitioned;

  const input = buildAllocationInput(order, campaign);
  const transaction = await context.chain.allocateExternalFunding(input);
  const verified = await verifiedCampaign(
    context,
    campaign.id,
    (value) =>
      value !== null &&
      (value.status.state === "scheduled" || value.status.state === "active"),
  );
  if (!verified) {
    throw new Error("External funding transaction did not create the campaign");
  }
  assertAllocationMatches(verified, order, campaign);
  await transitionAllocationLedger(
    context,
    order.id,
    campaign.id,
    verified,
    transaction.txHash,
  );
  return {
    outcome: "allocated",
    campaignId: campaign.id,
    txHash: transaction.txHash,
    contractState: verified.status.state,
  };
}

async function ensureAllocationJob(
  repository: Repository,
  order: FundingOrder,
  runAfter: string,
): Promise<void> {
  if (order.status !== "SETTLED") return;
  await repository.enqueueJob({
    type: "ALLOCATE_EXTERNAL_FUNDING",
    aggregateType: "FUNDING_ORDER",
    aggregateId: order.id,
    deduplicationKey: `allocate:${order.id}`,
    payload: {
      fundingOrderId: order.id,
      campaignId: order.campaignId,
      expectedAmountAtomic: order.principalAmountAtomic,
    },
    maxAttempts: 8,
    runAfter,
    reactivateDead: true,
  });
}

async function processFundingReconciliation(
  context: ProcessingContext,
): Promise<JsonValue> {
  const payload = object(context.job.payload, "funding reconciliation payload");
  const orderId = stringField(
    payload,
    "fundingOrderId",
    "funding reconciliation payload",
  );
  const campaignId = stringField(
    payload,
    "campaignId",
    "funding reconciliation payload",
  );
  let order = await context.repository.getFundingOrder(orderId);
  const campaign = await context.repository.getCampaign(campaignId);
  if (!order || !campaign || order.campaignId !== campaign.id) {
    throw new Error("Funding reconciliation references missing ledger records");
  }

  if (order.status === "ALLOCATED") {
    const onChain = await context.chain.getCampaign(campaign.id);
    if (!onChain) {
      throw new Error("Allocated funding order has no final on-chain campaign");
    }
    assertAllocationMatches(onChain, order, campaign);
    await transitionAllocationLedger(
      context,
      order.id,
      campaign.id,
      onChain,
      null,
    );
    return { outcome: "allocated", campaignId };
  }
  if (
    ["REFUNDED", "FAILED"].includes(order.status) ||
    (order.status === "EXPIRED" && order.rail !== "DIRECT_NEAR")
  ) {
    return { outcome: "terminal", fundingOrderStatus: order.status };
  }

  const onChain = await context.chain.getCampaign(campaign.id);
  if (
    onChain &&
    (order.rail === "DIRECT_NEAR" ||
      ["SETTLED", "ALLOCATING"].includes(order.status))
  ) {
    assertAllocationMatches(onChain, order, campaign);
    await transitionAllocationLedger(
      context,
      order.id,
      campaign.id,
      onChain,
      null,
    );
    return {
      outcome: "direct_or_reconciled_allocation",
      campaignId,
      contractState: onChain.status.state,
    };
  }

  if (order.rail === "DIRECT_NEAR") {
    if (order.status === "EXPIRED") {
      return { outcome: "terminal", fundingOrderStatus: order.status };
    }
    const finalityDeadline =
      new Date(order.expiresAt).getTime() + DIRECT_FUNDING_FINALITY_GRACE_MS;
    if (context.nowMs >= finalityDeadline) {
      const expired = await context.repository.transitionFundingOrder(
        order.id,
        [
          "QUOTED",
          "AWAITING_DEPOSIT",
          "DEPOSIT_DETECTED",
          "PROCESSING",
          "INCOMPLETE",
        ],
        "EXPIRED",
        order.version,
        {
          evidence: {
            ...eventEvidence(order.evidence),
            reconciliation: "direct_funding_not_found_before_deadline",
          },
        },
      );
      if (!expired) throw new Error("Direct funding expiry transition conflicted");
      return { outcome: "expired", fundingOrderStatus: "EXPIRED" };
    }
    return rescheduleResult(
      {
        outcome: "awaiting_direct_ft_transfer_call",
        fundingOrderStatus: order.status,
      },
      nextPoll(context.nowMs, finalityDeadline, DEFAULT_RECONCILE_MS),
    );
  }

  if (order.status === "SETTLED") {
    await ensureAllocationJob(
      context.repository,
      order,
      new Date(context.nowMs).toISOString(),
    );
    return rescheduleResult(
      { outcome: "awaiting_contract_allocation", fundingOrderStatus: order.status },
      context.nowMs + DEFAULT_RECONCILE_MS,
    );
  }

  const decision = await context.reconcileFunding(order);
  const observation = decision.observation;
  if (
    observation.orderStatus !== order.status ||
    observation.depositTxHash !== order.depositTxHash ||
    observation.settlementTxHash !== order.settlementTxHash ||
    observation.fundingReference !== order.fundingReference
  ) {
    const transitioned = await context.repository.transitionFundingOrder(
      order.id,
      [
        "QUOTED",
        "AWAITING_DEPOSIT",
        "DEPOSIT_DETECTED",
        "PROCESSING",
        "ALLOCATING",
        "INCOMPLETE",
        "SETTLED",
      ],
      observation.orderStatus,
      order.version,
      {
        depositTxHash: observation.depositTxHash,
        settlementTxHash: observation.settlementTxHash,
        fundingReference: observation.fundingReference,
        evidence: {
          ...eventEvidence(order.evidence),
          ...observation.evidence,
          providerStatus: observation.providerStatus,
        },
      },
    );
    if (!transitioned) throw new Error("Funding observation transition conflicted");
    order = transitioned;
    await appendEventOnce(context.repository, {
      aggregateType: "FUNDING_ORDER",
      aggregateId: order.id,
      eventType: "FUNDING_STATUS_OBSERVED_BY_WORKER",
      actorId: null,
      fromState: null,
      toState: order.status,
      idempotencyKey: `funding-observation:${order.id}:${order.version}`,
      evidence: {
        providerStatus: observation.providerStatus,
        depositTxHash: observation.depositTxHash,
        settlementTxHash: observation.settlementTxHash,
      },
    });
  }

  if (order.status === "SETTLED") {
    await ensureAllocationJob(
      context.repository,
      order,
      new Date(context.nowMs).toISOString(),
    );
    return rescheduleResult(
      { outcome: "settled_allocation_enqueued", fundingOrderStatus: order.status },
      context.nowMs + DEFAULT_RECONCILE_MS,
    );
  }
  if (["REFUNDED", "FAILED", "EXPIRED"].includes(order.status)) {
    return { outcome: "terminal", fundingOrderStatus: order.status };
  }
  return rescheduleResult(
    { outcome: "provider_pending", fundingOrderStatus: order.status },
    nextPoll(context.nowMs, new Date(order.expiresAt).getTime(), DEFAULT_RECONCILE_MS),
  );
}

function claimReceiver(claim: Claim): string {
  const evidence = eventEvidence(claim.evidence);
  const fromEvidence = evidence.receiverId;
  const fromPayout =
    claim.payout.kind === "ONE_CLICK"
      ? claim.payoutQuote?.depositAddress
      : claim.payout.recipient;
  if (
    typeof fromEvidence !== "string" ||
    !fromEvidence ||
    !fromPayout ||
    fromEvidence !== fromPayout
  ) {
    throw new Error("Claim payout receiver does not match its immutable quote");
  }
  return fromEvidence;
}

function claimInput(claim: Claim, campaign: Campaign): SubmitContractClaimInput {
  if (!claim.solutionProof) throw new Error("Submitted claim has no solution proof");
  const receiverId = claimReceiver(claim);
  return {
    campaignId: campaign.id,
    receiverId,
    payoutDigest: exactBase64(
      claim.solutionProof.payoutDigest,
      32,
      "Claim payout digest",
    ),
    nonce: safeInteger(claim.solutionProof.nonce, "Claim nonce"),
    deadlineMs: safeInteger(claim.solutionProof.deadlineMs, "Claim deadline"),
    signature: exactBase64(claim.solutionProof.signature, 64, "Claim signature"),
  };
}

function claimedByPermit(
  onChain: OnChainCampaign,
  input: SubmitContractClaimInput,
): boolean {
  return (
    onChain.status.state === "claimed" &&
    onChain.status.receiverId === input.receiverId &&
    onChain.status.payoutDigest === input.payoutDigest &&
    onChain.status.nonce === String(input.nonce)
  );
}

async function enqueueOneClickPayoutReconciliation(
  repository: Repository,
  claim: Claim,
  campaignId: string,
  runAfter: string,
): Promise<void> {
  const depositAddress = claim.payoutQuote?.depositAddress;
  if (claim.payout.kind !== "ONE_CLICK" || !depositAddress) {
    throw new Error("Cross-chain claim has no immutable 1Click deposit address");
  }
  await repository.enqueueJob({
    type: "RECONCILE_ONE_CLICK_PAYOUT",
    aggregateType: "CLAIM",
    aggregateId: claim.id,
    deduplicationKey: `one-click-payout:${claim.id}`,
    payload: {
      claimId: claim.id,
      campaignId,
      depositAddress,
    },
    // Provider settlement and refund recovery may outlive the claim quote.
    maxAttempts: 288,
    runAfter,
  });
}

async function transitionClaimSuccess(
  context: ProcessingContext,
  claimId: string,
  campaignId: string,
  onChain: OnChainCampaign,
  input: SubmitContractClaimInput,
  contractTxHash: string | null,
  storageRegistrationTxHash: string | null,
): Promise<void> {
  if (!claimedByPermit(onChain, input)) {
    throw new Error("On-chain claimed state does not match the submitted permit");
  }
  let claim = await context.repository.getClaim(claimId);
  let campaign = await context.repository.getCampaign(campaignId);
  if (!claim || !campaign) throw new Error("Claim ledger records disappeared");

  if (claim.payout.kind === "ONE_CLICK") {
    if (claim.status === "PAID" || claim.status === "RECOVERED") return;
    if (!["SUBMITTED", "PAYING", "FAILED"].includes(claim.status)) {
      throw new Error(
        `Cross-chain claim cannot record its escrow deposit from ${claim.status}`,
      );
    }
    const previousStatus = claim.status;
    const targetStatus = claim.status === "SUBMITTED" ? "PAYING" : claim.status;
    const transitioned = await context.repository.transitionClaim(
      claim.id,
      [claim.status],
      targetStatus,
      claim.version,
      {
        contractTxHash: contractTxHash ?? claim.contractTxHash,
        evidence: {
          ...eventEvidence(claim.evidence),
          contractState: onChain.status.state,
          contractReceiverId: onChain.status.receiverId ?? null,
          contractClaimNonce: onChain.claimNonce,
          storageRegistrationTxHash,
          oneClickDepositAddress: claim.payoutQuote?.depositAddress ?? null,
          winnerRecoveryAccount: claim.payout.recoveryAccount,
          downstreamStatus: "AWAITING_PROVIDER_TERMINAL",
        },
      },
    );
    if (!transitioned) {
      claim = (await context.repository.getClaim(claim.id))!;
      if (!["PAYING", "FAILED"].includes(claim.status)) {
        throw new Error("Cross-chain claim deposit ledger transition conflicted");
      }
    } else {
      claim = transitioned;
    }
    await enqueueOneClickPayoutReconciliation(
      context.repository,
      claim,
      campaign.id,
      new Date(context.nowMs).toISOString(),
    );
    await appendEventOnce(context.repository, {
      aggregateType: "CLAIM",
      aggregateId: claim.id,
      eventType: "CONTRACT_CLAIM_DEPOSITED_TO_ONE_CLICK",
      actorId: claim.claimantId,
      fromState: previousStatus,
      toState: claim.status,
      idempotencyKey: `chain-claim:${claim.id}`,
      evidence: {
        contractTxHash,
        receiverId: input.receiverId,
        payoutDigest: input.payoutDigest,
        nonce: input.nonce,
        storageRegistrationTxHash,
        recoveryAccount: claim.payout.recoveryAccount,
      },
    });
    // The contract transfer is only the 1Click deposit leg. Keep the workflow
    // in CLAIMING/PAYING until a downstream settlement or refund receipt exists.
    return;
  }

  if (claim.status !== "PAID") {
    const transitioned = await context.repository.transitionClaim(
      claim.id,
      ["SUBMITTED", "PAYING"],
      "PAID",
      claim.version,
      {
        contractTxHash: contractTxHash ?? claim.contractTxHash,
        evidence: {
          ...eventEvidence(claim.evidence),
          contractState: onChain.status.state,
          contractReceiverId: onChain.status.receiverId ?? null,
          contractClaimNonce: onChain.claimNonce,
          storageRegistrationTxHash,
        },
      },
    );
    if (!transitioned) {
      claim = (await context.repository.getClaim(claim.id))!;
      if (claim.status !== "PAID") {
        throw new Error("Claim payment ledger transition conflicted");
      }
    } else {
      claim = transitioned;
    }
  }

  campaign = (await context.repository.getCampaign(campaign.id))!;
  if (campaign.status !== "CLAIMED") {
    const transitioned = await context.repository.transitionCampaign(
      campaign.id,
      ["CLAIMING"],
      "CLAIMED",
      campaign.version,
      {
        chainCampaignId: onChain.campaignId,
        contractId: context.chain.contractId,
      },
    );
    if (!transitioned) {
      campaign = (await context.repository.getCampaign(campaign.id))!;
      if (campaign.status !== "CLAIMED") {
        throw new Error("Campaign claim ledger transition conflicted");
      }
    } else {
      campaign = transitioned;
    }
  }

  await appendEventOnce(context.repository, {
    aggregateType: "CLAIM",
    aggregateId: claim.id,
    eventType: "CONTRACT_CLAIM_PAID",
    actorId: claim.claimantId,
    fromState: "PAYING",
    toState: "PAID",
    idempotencyKey: `chain-claim:${claim.id}`,
    evidence: {
      contractTxHash,
      receiverId: input.receiverId,
      payoutDigest: input.payoutDigest,
      nonce: input.nonce,
      storageRegistrationTxHash,
    },
  });
}

async function transitionConsumedClaimFailure(
  context: ProcessingContext,
  claimId: string,
  campaignId: string,
  onChain: OnChainCampaign,
  contractTxHash: string | null,
  reason: string,
  campaignTarget: "ACTIVE" | "CLAIMED" = "ACTIVE",
): Promise<void> {
  let claim = await context.repository.getClaim(claimId);
  let campaign = await context.repository.getCampaign(campaignId);
  if (!claim || !campaign) throw new Error("Claim ledger records disappeared");
  if (!["SUBMITTED", "PAYING", "FAILED"].includes(claim.status)) {
    throw new Error(`Claim cannot recover from ledger state ${claim.status}`);
  }
  if (claim.status !== "FAILED") {
    const transitioned = await context.repository.transitionClaim(
      claim.id,
      ["SUBMITTED", "PAYING"],
      "FAILED",
      claim.version,
      {
        contractTxHash: contractTxHash ?? claim.contractTxHash,
        evidence: {
          ...eventEvidence(claim.evidence),
          failureReason: reason,
          contractState: onChain.status.state,
          nextClaimNonce: onChain.claimNonce,
        },
      },
    );
    if (!transitioned) throw new Error("Claim failure ledger transition conflicted");
    claim = transitioned;
  }
  if (campaign.status === "CLAIMING") {
    const transitioned = await context.repository.transitionCampaign(
      campaign.id,
      ["CLAIMING"],
      campaignTarget,
      campaign.version,
    );
    if (!transitioned) throw new Error("Campaign recovery ledger transition conflicted");
    campaign = transitioned;
  }
  await appendEventOnce(context.repository, {
    aggregateType: "CLAIM",
    aggregateId: claim.id,
    eventType: "CONTRACT_CLAIM_RECOVERED",
    actorId: claim.claimantId,
    fromState: "PAYING",
    toState: "FAILED",
    idempotencyKey: `chain-claim-recovery:${claim.id}`,
    evidence: {
      contractTxHash,
      reason,
      nextClaimNonce: onChain.claimNonce,
    },
  });
}

async function processClaim(context: ProcessingContext): Promise<JsonValue> {
  const payload = object(context.job.payload, "claim job payload");
  const claimId = stringField(payload, "claimId", "claim job payload");
  const campaignId = stringField(payload, "campaignId", "claim job payload");
  const payloadReceiver = stringField(payload, "receiverId", "claim job payload");
  let claim = await context.repository.getClaim(claimId);
  const campaign = await context.repository.getCampaign(campaignId);
  if (!claim || !campaign || claim.campaignId !== campaign.id) {
    throw new Error("Claim job references missing or mismatched ledger records");
  }
  const input = claimInput(claim, campaign);
  if (input.receiverId !== payloadReceiver) {
    throw new Error("Claim job receiver does not match its signed payout");
  }

  let onChain = await context.chain.getCampaign(campaign.id);
  if (!onChain) throw new Error("Claim campaign is not present on-chain");
  if (claimedByPermit(onChain, input)) {
    await transitionClaimSuccess(
      context,
      claim.id,
      campaign.id,
      onChain,
      input,
      claim.contractTxHash,
      null,
    );
    return { outcome: "reconciled", campaignId, contractState: "claimed" };
  }
  if (onChain.status.state === "claimed") {
    await transitionConsumedClaimFailure(
      context,
      claim.id,
      campaign.id,
      onChain,
      claim.contractTxHash,
      "lost_on_chain_claim_race",
      "CLAIMED",
    );
    return { outcome: "lost_on_chain_race", campaignId };
  }
  if (onChain.status.state === "claiming") {
    onChain =
      (await verifiedCampaign(
        context,
        campaign.id,
        (value) => value !== null && value.status.state !== "claiming",
      )) ?? onChain;
    if (claimedByPermit(onChain, input)) {
      await transitionClaimSuccess(
        context,
        claim.id,
        campaign.id,
        onChain,
        input,
        claim.contractTxHash,
        null,
      );
      return { outcome: "reconciled", campaignId, contractState: "claimed" };
    }
    if (onChain.status.state === "claimed") {
      await transitionConsumedClaimFailure(
        context,
        claim.id,
        campaign.id,
        onChain,
        claim.contractTxHash,
        "lost_on_chain_claim_race",
        "CLAIMED",
      );
      return { outcome: "lost_on_chain_race", campaignId };
    }
    if (onChain.status.state === "claiming") {
      throw new Error("Contract claim callback is still pending");
    }
  }
  if (onChain.status.state !== "active") {
    throw new Error(`Campaign is not claimable on-chain (${onChain.status.state})`);
  }

  const chainNonce = BigInt(onChain.claimNonce);
  const proofNonce = BigInt(input.nonce);
  if (chainNonce > proofNonce) {
    await transitionConsumedClaimFailure(
      context,
      claim.id,
      campaign.id,
      onChain,
      claim.contractTxHash,
      "permit_consumed_after_failed_transfer",
    );
    return {
      outcome: "payout_failed_recovered",
      campaignId,
      nextNonce: onChain.claimNonce,
    };
  }
  if (chainNonce !== proofNonce) {
    throw new Error("On-chain claim nonce is behind the signed permit");
  }
  if (context.nowMs > input.deadlineMs) {
    await transitionConsumedClaimFailure(
      context,
      claim.id,
      campaign.id,
      onChain,
      claim.contractTxHash,
      "permit_expired_before_submission",
    );
    return { outcome: "expired_permit_recovered", campaignId };
  }
  if (!["SUBMITTED", "PAYING"].includes(claim.status)) {
    throw new Error(`Claim is not payable from ledger state ${claim.status}`);
  }
  if (claim.status === "SUBMITTED") {
    const transitioned = await context.repository.transitionClaim(
      claim.id,
      ["SUBMITTED"],
      "PAYING",
      claim.version,
      {
        evidence: {
          ...eventEvidence(claim.evidence),
          chainSubmissionStartedAt: new Date().toISOString(),
        },
      },
    );
    if (!transitioned) throw new Error("Claim changed before chain submission");
    claim = transitioned;
  }

  const registration = await context.chain.ensureStorageRegistration(input.receiverId);
  const transaction = await context.chain.submitContractClaim(input);
  onChain =
    (await verifiedCampaign(
      context,
      campaign.id,
      (value) => value !== null && value.status.state !== "claiming",
    )) ?? onChain;

  if (claimedByPermit(onChain, input)) {
    await transitionClaimSuccess(
      context,
      claim.id,
      campaign.id,
      onChain,
      input,
      transaction.txHash,
      registration.txHash,
    );
    return {
      outcome:
        claim.payout.kind === "ONE_CLICK"
          ? "deposited_for_downstream_routing"
          : "paid",
      campaignId,
      txHash: transaction.txHash,
      storageRegistrationTxHash: registration.txHash,
    };
  }
  if (
    onChain.status.state === "active" &&
    BigInt(onChain.claimNonce) > BigInt(input.nonce)
  ) {
    await transitionConsumedClaimFailure(
      context,
      claim.id,
      campaign.id,
      onChain,
      transaction.txHash,
      "permit_consumed_after_failed_transfer",
    );
    return {
      outcome: "payout_failed_recovered",
      campaignId,
      txHash: transaction.txHash,
      nextNonce: onChain.claimNonce,
    };
  }
  throw new Error("Contract claim did not reach a verifiable terminal state");
}

async function processOneClickPayoutReconciliation(
  context: ProcessingContext,
): Promise<JsonValue> {
  const payload = object(
    context.job.payload,
    "1Click payout reconciliation payload",
  );
  const claimId = stringField(
    payload,
    "claimId",
    "1Click payout reconciliation payload",
  );
  const campaignId = stringField(
    payload,
    "campaignId",
    "1Click payout reconciliation payload",
  );
  const depositAddress = stringField(
    payload,
    "depositAddress",
    "1Click payout reconciliation payload",
  );
  const claim = await context.repository.getClaim(claimId);
  const campaign = await context.repository.getCampaign(campaignId);
  if (!claim || !campaign || claim.campaignId !== campaign.id) {
    throw new Error(
      "1Click payout reconciliation references missing ledger records",
    );
  }
  if (
    claim.payout.kind !== "ONE_CLICK" ||
    claim.payoutQuote?.depositAddress !== depositAddress
  ) {
    throw new Error(
      "1Click payout reconciliation does not match the signed quote",
    );
  }
  if (claim.status === "PAID" || claim.status === "RECOVERED") {
    const repaired = await repairTerminalOneClickPayout(
      context.repository,
      claim,
      campaign,
    );
    return {
      outcome: repaired.outcome.toLowerCase(),
      claimStatus: repaired.claimStatus,
      settlementTxHash: repaired.settlementTxHash,
    };
  }
  if (!["PAYING", "FAILED"].includes(claim.status)) {
    throw new Error(
      `1Click payout is not reconcilable from claim state ${claim.status}`,
    );
  }

  const observation = await context.observeOneClickPayout(
    depositAddress,
    claim.payoutQuote.depositMemo,
    claim.payoutQuote,
  );
  const result = await reconcileOneClickPayout(
    context.repository,
    claim,
    campaign,
    observation,
  );
  if (result.terminal) {
    return {
      outcome: result.outcome.toLowerCase(),
      claimStatus: result.claimStatus,
      settlementTxHash: result.settlementTxHash,
    };
  }
  return rescheduleResult(
    {
      outcome: result.outcome.toLowerCase(),
      claimStatus: result.claimStatus,
      providerStatus: observation.providerStatus,
    },
    context.nowMs +
      (result.outcome === "FAILED"
        ? DEFAULT_LIFECYCLE_POLL_MS
        : DEFAULT_RECONCILE_MS),
  );
}

async function finalizeRefundLedger(
  context: ProcessingContext,
  campaignId: string,
  fundingOrderId: string,
  onChain: OnChainCampaign,
  refundTxHash: string | null,
): Promise<void> {
  if (onChain.status.state !== "refunded") {
    throw new Error("Cannot finalize a refund before the contract reports refunded");
  }
  let campaign = await context.repository.getCampaign(campaignId);
  let order = await context.repository.getFundingOrder(fundingOrderId);
  if (!campaign || !order || order.campaignId !== campaign.id) {
    throw new Error("Refund ledger records disappeared");
  }
  if (campaign.status !== "REFUNDED") {
    const transitioned = await context.repository.transitionCampaign(
      campaign.id,
      ["SCHEDULED", "ACTIVE", "REFUNDING"],
      "REFUNDED",
      campaign.version,
      {
        chainCampaignId: onChain.campaignId,
        contractId: context.chain.contractId,
      },
    );
    if (!transitioned) {
      campaign = (await context.repository.getCampaign(campaign.id))!;
      if (campaign.status !== "REFUNDED") {
        throw new Error("Campaign refund ledger transition conflicted");
      }
    } else {
      campaign = transitioned;
    }
  }
  order = (await context.repository.getFundingOrder(order.id))!;
  if (order.status !== "REFUNDED") {
    const transitioned = await context.repository.transitionFundingOrder(
      order.id,
      ["ALLOCATED"],
      "REFUNDED",
      order.version,
      {
        evidence: {
          ...eventEvidence(order.evidence),
          refundTxHash,
          contractState: "refunded",
          refundedAtMs: onChain.status.refundedAtMs ?? null,
        },
      },
    );
    if (!transitioned) {
      order = (await context.repository.getFundingOrder(order.id))!;
      if (order.status !== "REFUNDED") {
        throw new Error("Funding order refund ledger transition conflicted");
      }
    } else {
      order = transitioned;
    }
  }
  await appendEventOnce(context.repository, {
    aggregateType: "CAMPAIGN",
    aggregateId: campaign.id,
    eventType: "CAMPAIGN_REFUNDED_ON_CHAIN",
    actorId: null,
    fromState: "REFUNDING",
    toState: "REFUNDED",
    idempotencyKey: `chain-refund:${campaign.id}`,
    evidence: {
      refundTxHash,
      refundAccountId: onChain.status.refundAccountId ?? onChain.refundAccountId,
      refundedAtMs: onChain.status.refundedAtMs ?? null,
    },
  });
}

async function alignCampaignStatus(
  context: ProcessingContext,
  campaign: Campaign,
  target: "SCHEDULED" | "ACTIVE" | "CLAIMING" | "CLAIMED" | "REFUNDING",
): Promise<Campaign> {
  if (campaign.status === target) return campaign;
  const transitioned = await context.repository.transitionCampaign(
    campaign.id,
    ["FUNDING", "SCHEDULED", "ACTIVE", "CLAIMING", "REFUNDING"],
    target,
    campaign.version,
  );
  if (!transitioned) {
    const current = await context.repository.getCampaign(campaign.id);
    if (!current || current.status !== target) {
      throw new Error(`Campaign lifecycle transition to ${target} conflicted`);
    }
    return current;
  }
  return transitioned;
}

async function processCampaignLifecycle(
  context: ProcessingContext,
): Promise<JsonValue> {
  const payload = object(context.job.payload, "campaign lifecycle payload");
  const campaignId = stringField(
    payload,
    "campaignId",
    "campaign lifecycle payload",
  );
  const fundingOrderId = stringField(
    payload,
    "fundingOrderId",
    "campaign lifecycle payload",
  );
  let campaign = await context.repository.getCampaign(campaignId);
  const order = await context.repository.getFundingOrder(fundingOrderId);
  if (!campaign || !order || order.campaignId !== campaign.id) {
    throw new Error("Campaign lifecycle references missing ledger records");
  }
  const onChain = await context.chain.getCampaign(campaign.id);
  if (!onChain) throw new Error("Funded campaign is missing from the v2 contract");

  if (onChain.status.state === "refunded") {
    await finalizeRefundLedger(
      context,
      campaign.id,
      order.id,
      onChain,
      null,
    );
    return { outcome: "refunded", campaignId };
  }
  if (onChain.status.state === "claimed") {
    if (campaign.status === "CLAIMING") {
      return rescheduleResult(
        {
          outcome: "awaiting_claim_ledger_terminal",
          campaignId: campaign.id,
        },
        context.nowMs + DEFAULT_RECONCILE_MS,
      );
    }
    campaign = await alignCampaignStatus(context, campaign, "CLAIMED");
    return { outcome: "claimed", campaignId: campaign.id };
  }
  if (
    campaign.status === "REFUNDING" ||
    onChain.status.state === "refunding"
  ) {
    campaign = await alignCampaignStatus(context, campaign, "REFUNDING");
    await enqueueCampaignRefund(
      context.repository,
      campaign.id,
      order.id,
      context.nowMs >= Number(onChain.expiresAtMs) ? "EXPIRED" : "CREATOR_CANCEL",
      new Date(context.nowMs).toISOString(),
    );
    return { outcome: "refund_enqueued", campaignId };
  }
  if (onChain.status.state === "claiming") {
    await alignCampaignStatus(context, campaign, "CLAIMING");
    return rescheduleResult(
      { outcome: "claim_in_flight", campaignId },
      context.nowMs + DEFAULT_RECONCILE_MS,
    );
  }
  if (onChain.status.state === "scheduled") {
    campaign = await alignCampaignStatus(context, campaign, "SCHEDULED");
    return rescheduleResult(
      { outcome: "scheduled", campaignId },
      nextPoll(
        context.nowMs,
        Number(onChain.opensAtMs),
        DEFAULT_LIFECYCLE_POLL_MS,
      ),
    );
  }

  campaign = await alignCampaignStatus(context, campaign, "ACTIVE");
  const expiresAtMs = Number(onChain.expiresAtMs);
  if (context.nowMs < expiresAtMs) {
    return rescheduleResult(
      { outcome: "active", campaignId },
      nextPoll(context.nowMs, expiresAtMs, DEFAULT_LIFECYCLE_POLL_MS),
    );
  }

  campaign = await alignCampaignStatus(context, campaign, "REFUNDING");
  await enqueueCampaignRefund(
    context.repository,
    campaign.id,
    order.id,
    "EXPIRED",
    new Date(context.nowMs).toISOString(),
  );
  await appendEventOnce(context.repository, {
    aggregateType: "CAMPAIGN",
    aggregateId: campaign.id,
    eventType: "CAMPAIGN_EXPIRY_REFUND_ENQUEUED",
    actorId: null,
    fromState: "ACTIVE",
    toState: "REFUNDING",
    idempotencyKey: `expiry-refund:${campaign.id}`,
    evidence: { expiresAtMs: onChain.expiresAtMs },
  });
  return { outcome: "expiry_refund_enqueued", campaignId };
}

function refundReason(payload: Record<string, JsonValue>): RefundReason {
  const reason = stringField(payload, "reason", "campaign refund payload");
  if (reason !== "CREATOR_CANCEL" && reason !== "EXPIRED") {
    throw new Error("Campaign refund reason is invalid");
  }
  return reason;
}

async function recoverMissedCreatorCancellation(
  context: ProcessingContext,
  campaign: Campaign,
  order: FundingOrder,
): Promise<void> {
  const active = await alignCampaignStatus(context, campaign, "ACTIVE");
  await enqueueCampaignLifecycle(
    context.repository,
    active.id,
    order.id,
    new Date(context.nowMs).toISOString(),
  );
  await appendEventOnce(context.repository, {
    aggregateType: "CAMPAIGN",
    aggregateId: active.id,
    eventType: "CREATOR_CANCELLATION_WINDOW_MISSED",
    actorId: active.creatorId,
    fromState: "REFUNDING",
    toState: "ACTIVE",
    idempotencyKey: `cancel-window-missed:${active.id}`,
    evidence: { openingAt: active.openingAt },
  });
}

async function processCampaignRefund(
  context: ProcessingContext,
): Promise<JsonValue> {
  const payload = object(context.job.payload, "campaign refund payload");
  const campaignId = stringField(payload, "campaignId", "campaign refund payload");
  const fundingOrderId = stringField(
    payload,
    "fundingOrderId",
    "campaign refund payload",
  );
  const reason = refundReason(payload);
  let campaign = await context.repository.getCampaign(campaignId);
  const order = await context.repository.getFundingOrder(fundingOrderId);
  if (!campaign || !order || order.campaignId !== campaign.id) {
    throw new Error("Campaign refund references missing ledger records");
  }
  let onChain = await context.chain.getCampaign(campaign.id);
  if (!onChain) throw new Error("Refund campaign is missing from the v2 contract");

  if (onChain.status.state === "refunded") {
    await finalizeRefundLedger(
      context,
      campaign.id,
      order.id,
      onChain,
      null,
    );
    return { outcome: "reconciled_refund", campaignId };
  }
  if (onChain.status.state === "claimed") {
    await alignCampaignStatus(context, campaign, "CLAIMED");
    return { outcome: "claim_won_before_refund", campaignId };
  }
  if (onChain.status.state === "claiming") {
    return rescheduleResult(
      { outcome: "claim_in_flight", campaignId },
      context.nowMs + DEFAULT_REFUND_POLL_MS,
    );
  }

  let transaction: { txHash: string } | null = null;
  if (onChain.status.state === "refunding") {
    if (onChain.status.refundInFlight) {
      return rescheduleResult(
        { outcome: "refund_callback_pending", campaignId },
        context.nowMs + DEFAULT_REFUND_POLL_MS,
      );
    }
    const attempt = Number(onChain.status.refundAttempt ?? "0");
    if (!Number.isSafeInteger(attempt) || attempt >= MAX_ON_CHAIN_REFUND_ATTEMPTS - 1) {
      throw new Error("On-chain refund exhausted its bounded retry allowance");
    }
    transaction = await context.chain.retryRefund(campaign.id);
  } else {
    const opensAtMs = Number(onChain.opensAtMs);
    const expiresAtMs = Number(onChain.expiresAtMs);
    if (reason === "CREATOR_CANCEL" && context.nowMs < opensAtMs) {
      transaction = await context.chain.cancelBeforeOpen(campaign.id);
    } else if (context.nowMs >= expiresAtMs) {
      transaction = await context.chain.expireAndRefund(campaign.id);
    } else if (reason === "CREATOR_CANCEL") {
      await recoverMissedCreatorCancellation(context, campaign, order);
      return { outcome: "cancellation_window_missed", campaignId };
    } else {
      return rescheduleResult(
        { outcome: "awaiting_expiry", campaignId },
        nextPoll(context.nowMs, expiresAtMs, DEFAULT_LIFECYCLE_POLL_MS),
      );
    }
  }

  onChain =
    (await verifiedCampaign(
      context,
      campaign.id,
      (value) =>
        value !== null &&
        (value.status.state === "refunded" ||
          value.status.state === "refunding"),
    )) ?? onChain;
  if (onChain.status.state === "refunded") {
    await finalizeRefundLedger(
      context,
      campaign.id,
      order.id,
      onChain,
      transaction.txHash,
    );
    return {
      outcome: "refunded",
      campaignId,
      txHash: transaction.txHash,
    };
  }
  if (onChain.status.state === "refunding") {
    campaign = await alignCampaignStatus(context, campaign, "REFUNDING");
    return rescheduleResult(
      {
        outcome: onChain.status.refundInFlight
          ? "refund_callback_pending"
          : "refund_retry_required",
        campaignId: campaign.id,
        txHash: transaction.txHash,
        refundAttempt: onChain.status.refundAttempt ?? "0",
      },
      context.nowMs + DEFAULT_REFUND_POLL_MS,
    );
  }
  throw new Error("Refund transaction did not reach a verifiable contract state");
}

export async function processLeasedChainJob(
  context: ProcessingContext,
): Promise<JsonValue> {
  switch (context.job.type) {
    case "ALLOCATE_EXTERNAL_FUNDING":
      return processAllocation(context);
    case "SUBMIT_CONTRACT_CLAIM":
      return processClaim(context);
    case "RECONCILE_FUNDING_ORDER":
      return processFundingReconciliation(context);
    case "RECONCILE_CAMPAIGN_LIFECYCLE":
      return processCampaignLifecycle(context);
    case "RECONCILE_ONE_CLICK_PAYOUT":
      return processOneClickPayoutReconciliation(context);
    case "REFUND_CAMPAIGN":
      return processCampaignRefund(context);
    default:
      throw new Error(`Unsupported v2 chain job type ${context.job.type}`);
  }
}

export function safeWorkerError(error: unknown): string {
  let message = error instanceof Error ? error.message : "Unknown v2 chain worker error";
  for (const secret of [
    process.env.V2_OPERATOR_PRIVATE_KEY,
    process.env.NEAR_PRIVATE_KEY,
    process.env.ONE_CLICK_JWT,
    process.env.ONECLICK_JWT,
  ]) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  return message
    .replace(/(?:ed25519|secp256k1):[A-Za-z0-9+/=_-]{20,}/g, "[REDACTED_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\"(private_key|signature|authorization)\"\s*:\s*\"[^\"]+\"/gi,
      '"$1":"[REDACTED]"',
    )
    .replace(
      /signature\s*[:=]\s*[\"']?[A-Za-z0-9+/=_-]{20,}/gi,
      "signature=[REDACTED]",
    )
    .slice(0, 1_000);
}

async function markAllocationIncomplete(
  repository: Repository,
  job: Job,
  error: string,
): Promise<void> {
  if (job.type !== "ALLOCATE_EXTERNAL_FUNDING") return;
  const payload = object(job.payload, "allocation job payload");
  const orderId = stringField(payload, "fundingOrderId", "allocation job payload");
  const order = await repository.getFundingOrder(orderId);
  if (!order || order.status !== "ALLOCATING") return;
  await repository.transitionFundingOrder(
    order.id,
    ["ALLOCATING"],
    "INCOMPLETE",
    order.version,
    {
      evidence: {
        ...eventEvidence(order.evidence),
        allocationError: error,
        allocationAttempt: job.attempts,
      },
    },
  );
}

function noOpLogger(): WorkerLogger {
  return {
    info: () => undefined,
    error: () => undefined,
  };
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function defaultFundingReconciliation(
  order: FundingOrder,
): Promise<FinalizationDecision> {
  return fundingAdapter(order.rail).reconcile(order);
}

function defaultOneClickPayoutObservation(
  depositAddress: string,
  depositMemo?: string | null,
  expectedQuote?: FundingOrder["quote"],
): Promise<FundingObservation> {
  return observeOneClickTransfer(depositAddress, fetch, undefined, {
    depositMemo,
    expectedQuote,
  });
}

export async function runChainWorkerBatch(
  repository: Repository,
  chain: V2ChainClient,
  workerId: string,
  options: WorkerBatchOptions = {},
): Promise<WorkerBatchResult> {
  const now = options.now ?? new Date();
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const jobs = await repository.leaseJobs(
    workerId,
    options.limit ?? 10,
    new Date(now.getTime() + leaseMs).toISOString(),
    now.toISOString(),
  );
  const result: WorkerBatchResult = {
    leased: jobs.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    ignored: 0,
  };
  const logger = options.logger ?? noOpLogger();

  for (const job of jobs) {
    if (!SUPPORTED_JOB_TYPES.has(job.type)) {
      result.processed += 1;
      const safeError = safeWorkerError(
        new Error(`Unsupported v2 chain job type ${job.type}`),
      );
      const failed = await repository.failJob(
        job.id,
        workerId,
        safeError,
        new Date(now.getTime() + (options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS))
          .toISOString(),
      );
      if (!failed) {
        throw new Error("Unsupported job lease was lost before it could fail");
      }
      result.failed += 1;
      logger.error("v2 chain job rejected", {
        jobId: job.id,
        jobType: job.type,
        aggregateId: job.aggregateId,
        attempt: job.attempts,
        error: safeError,
      });
      continue;
    }
    result.processed += 1;
    try {
      const jobResult = await processLeasedChainJob({
        repository,
        chain,
        job,
        nowMs: now.getTime(),
        verificationAttempts: options.verificationAttempts ?? 6,
        verificationDelayMs: options.verificationDelayMs ?? 500,
        sleep: options.sleep ?? defaultSleep,
        reconcileFunding:
          options.reconcileFunding ?? defaultFundingReconciliation,
        observeOneClickPayout:
          options.observeOneClickPayout ?? defaultOneClickPayoutObservation,
      });
      const runAfter = rescheduleAt(jobResult);
      const completed = runAfter
        ? await repository.rescheduleJob(job.id, workerId, jobResult, runAfter)
        : await repository.completeJob(job.id, workerId, jobResult);
      if (!completed) {
        throw new Error(
          runAfter
            ? "Job lease was lost before rescheduling"
            : "Job lease was lost before completion",
        );
      }
      result.succeeded += 1;
      logger.info("v2 chain job completed", {
        jobId: job.id,
        jobType: job.type,
        aggregateId: job.aggregateId,
        attempt: job.attempts,
      });
    } catch (error) {
      const safeError = safeWorkerError(error);
      try {
        if (job.attempts >= job.maxAttempts) {
          await markAllocationIncomplete(repository, job, safeError);
        }
      } catch {
        // Preserve the original error and let the next lease reconcile ledger state.
      }
      const retryBase = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
      const retryMax = options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;
      const retryDelay = Math.min(
        retryBase * 2 ** Math.max(0, job.attempts - 1),
        retryMax,
      );
      await repository.failJob(
        job.id,
        workerId,
        safeError,
        new Date(now.getTime() + retryDelay).toISOString(),
      );
      result.failed += 1;
      logger.error("v2 chain job failed", {
        jobId: job.id,
        jobType: job.type,
        aggregateId: job.aggregateId,
        attempt: job.attempts,
        error: safeError,
      });
    }
  }
  return result;
}
