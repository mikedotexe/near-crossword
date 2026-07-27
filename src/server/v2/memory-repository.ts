import { randomUUID } from "node:crypto";
import {
  AI_GENERATION_IDEMPOTENCY_ACTOR,
  AI_GENERATION_IDEMPOTENCY_SCOPE,
  verifyAiGenerationReceipt,
} from "./ai-receipt";
import { AppError } from "./errors";
import type {
  CampaignCreateData,
  CampaignDraftPatch,
  ClaimCreateData,
  EventCreateData,
  FinalizeOneClickPayoutData,
  FundingOrderCreateData,
  JobCreateData,
  IdempotencyProcessingReservation,
  ListCampaignsQuery,
  Repository,
} from "./repository";
import type {
  AiGenerationReceiptHandle,
  Campaign,
  CampaignStatus,
  Claim,
  ClaimStatus,
  FundingOrder,
  FundingOrderStatus,
  IdempotencyRecord,
  Job,
  JsonValue,
  OperationEvent,
} from "./types";

interface MemoryState {
  campaigns: Map<string, Campaign>;
  fundingOrders: Map<string, FundingOrder>;
  fundingIdempotency: Map<string, string>;
  claims: Map<string, Claim>;
  claimIdempotency: Map<string, string>;
  events: OperationEvent[];
  idempotency: Map<string, IdempotencyRecord>;
  jobs: Map<string, Job>;
  jobDeduplication: Map<string, string>;
}

const stateKey = Symbol.for("near-crossword.v2.memory-repository");

function state(): MemoryState {
  const holder = globalThis as typeof globalThis & { [stateKey]?: MemoryState };
  if (!holder[stateKey]) {
    holder[stateKey] = {
      campaigns: new Map(),
      fundingOrders: new Map(),
      fundingIdempotency: new Map(),
      claims: new Map(),
      claimIdempotency: new Map(),
      events: [],
      idempotency: new Map(),
      jobs: new Map(),
      jobDeduplication: new Map(),
    };
  }
  return holder[stateKey]!;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function now(): string {
  return new Date().toISOString();
}

export class MemoryRepository implements Repository {
  readonly kind = "memory" as const;

  async createCampaign(
    input: CampaignCreateData,
    aiReceiptHandle: AiGenerationReceiptHandle | null = null,
  ): Promise<Campaign> {
    const database = state();
    if (
      [...database.campaigns.values()].some(
        (campaign) => campaign.slug.toLowerCase() === input.slug.toLowerCase(),
      )
    ) {
      throw new AppError(409, "SLUG_TAKEN", "Campaign slug is already in use");
    }
    let aiGenerationReceipt = null;
    if (aiReceiptHandle) {
      const stored = database.idempotency.get(
        `${AI_GENERATION_IDEMPOTENCY_SCOPE}:${AI_GENERATION_IDEMPOTENCY_ACTOR}:${aiReceiptHandle.paymentIdentifier}`,
      );
      if (!stored) {
        throw new AppError(
          409,
          "AI_RECEIPT_UNVERIFIED",
          "The paid AI generation receipt could not be verified",
        );
      }
      if (
        [...database.campaigns.values()].some(
          (campaign) =>
            campaign.aiGenerationReceipt?.paymentIdentifier ===
            aiReceiptHandle.paymentIdentifier,
        )
      ) {
        throw new AppError(
          409,
          "AI_RECEIPT_ALREADY_USED",
          "This paid AI generation receipt is already linked to a campaign",
        );
      }
      aiGenerationReceipt = verifyAiGenerationReceipt(
        aiReceiptHandle,
        stored,
      );
    }
    const timestamp = now();
    const campaign: Campaign = {
      ...clone(input),
      id: input.id ?? randomUUID(),
      aiGenerationReceipt,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    database.campaigns.set(campaign.id, campaign);
    return clone(campaign);
  }

  async getCampaign(idOrSlug: string): Promise<Campaign | null> {
    const database = state();
    const direct = database.campaigns.get(idOrSlug);
    const campaign =
      direct ??
      [...database.campaigns.values()].find(
        (candidate) => candidate.slug.toLowerCase() === idOrSlug.toLowerCase(),
      );
    return campaign ? clone(campaign) : null;
  }

  async listCampaigns(
    query: ListCampaignsQuery,
  ): Promise<{ campaigns: Campaign[]; total: number }> {
    let campaigns = [...state().campaigns.values()].filter(
      (campaign) =>
        (!query.status || campaign.status === query.status) &&
        (!query.statuses || query.statuses.includes(campaign.status)) &&
        (!query.creatorId || campaign.creatorId === query.creatorId) &&
        (!query.visibility || campaign.visibility === query.visibility),
    );
    campaigns = campaigns.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      total: campaigns.length,
      campaigns: clone(campaigns.slice(query.offset, query.offset + query.limit)),
    };
  }

  async updateCampaignDraft(
    id: string,
    creatorId: string,
    expectedVersion: number,
    patch: CampaignDraftPatch,
  ): Promise<Campaign | null> {
    const database = state();
    const campaign = database.campaigns.get(id);
    if (
      !campaign ||
      campaign.creatorId !== creatorId ||
      campaign.status !== "DRAFT" ||
      campaign.version !== expectedVersion
    ) {
      return null;
    }
    if (
      patch.slug &&
      [...database.campaigns.values()].some(
        (item) => item.id !== id && item.slug.toLowerCase() === patch.slug!.toLowerCase(),
      )
    ) {
      throw new AppError(409, "SLUG_TAKEN", "Campaign slug is already in use");
    }
    const updated: Campaign = {
      ...campaign,
      ...clone(patch),
      version: campaign.version + 1,
      updatedAt: now(),
    };
    database.campaigns.set(id, updated);
    return clone(updated);
  }

  async transitionCampaign(
    id: string,
    from: CampaignStatus[],
    to: CampaignStatus,
    expectedVersion: number,
    patch: Partial<
      Pick<
        Campaign,
        "fundingReference" | "chainCampaignId" | "contractId" | "openingAt" | "expiresAt"
      >
    > = {},
  ): Promise<Campaign | null> {
    const database = state();
    const campaign = database.campaigns.get(id);
    if (!campaign || !from.includes(campaign.status) || campaign.version !== expectedVersion) {
      return null;
    }
    const updated: Campaign = {
      ...campaign,
      ...clone(patch),
      status: to,
      version: campaign.version + 1,
      updatedAt: now(),
    };
    database.campaigns.set(id, updated);
    return clone(updated);
  }

  async createFundingOrderIdempotent(
    input: FundingOrderCreateData,
  ): Promise<{ fundingOrder: FundingOrder; created: boolean }> {
    const database = state();
    const key = `${input.creatorId}:${input.idempotencyKey}`;
    const existingId = database.fundingIdempotency.get(key);
    if (existingId) {
      return { fundingOrder: clone(database.fundingOrders.get(existingId)!), created: false };
    }
    const existingOpen = [...database.fundingOrders.values()].find(
      (order) =>
        order.campaignId === input.campaignId &&
        !["FAILED", "REFUNDED", "EXPIRED"].includes(order.status),
    );
    if (existingOpen) {
      throw new AppError(
        409,
        "FUNDING_ORDER_EXISTS",
        "Campaign already has an open funding order",
        { fundingOrderId: existingOpen.id },
      );
    }
    const timestamp = now();
    const fundingOrder: FundingOrder = {
      ...clone(input),
      id: input.id ?? randomUUID(),
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    database.fundingOrders.set(fundingOrder.id, fundingOrder);
    database.fundingIdempotency.set(key, fundingOrder.id);
    return { fundingOrder: clone(fundingOrder), created: true };
  }

  async createFundingOrderAndFreezeCampaign(
    input: FundingOrderCreateData,
    campaignExpectedVersion: number,
  ): Promise<
    { fundingOrder: FundingOrder; campaign: Campaign; created: boolean } | null
  > {
    const database = state();
    const key = `${input.creatorId}:${input.idempotencyKey}`;
    const existingId = database.fundingIdempotency.get(key);
    if (existingId) {
      const existingOrder = database.fundingOrders.get(existingId);
      const existingCampaign = existingOrder
        ? database.campaigns.get(existingOrder.campaignId)
        : null;
      return existingOrder && existingCampaign
        ? {
            fundingOrder: clone(existingOrder),
            campaign: clone(existingCampaign),
            created: false,
          }
        : null;
    }
    const campaign = database.campaigns.get(input.campaignId);
    if (
      !campaign ||
      campaign.creatorId !== input.creatorId ||
      campaign.status !== "DRAFT" ||
      campaign.version !== campaignExpectedVersion
    ) {
      return null;
    }
    const existingOpen = [...database.fundingOrders.values()].find(
      (order) =>
        order.campaignId === input.campaignId &&
        !["FAILED", "REFUNDED", "EXPIRED"].includes(order.status),
    );
    if (existingOpen) {
      throw new AppError(
        409,
        "FUNDING_ORDER_EXISTS",
        "Campaign already has an open funding order",
        { fundingOrderId: existingOpen.id },
      );
    }
    const timestamp = now();
    const fundingOrder: FundingOrder = {
      ...clone(input),
      id: input.id ?? randomUUID(),
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const frozenCampaign: Campaign = {
      ...campaign,
      status: "FUNDING",
      version: campaign.version + 1,
      updatedAt: timestamp,
    };
    database.fundingOrders.set(fundingOrder.id, fundingOrder);
    database.fundingIdempotency.set(key, fundingOrder.id);
    database.campaigns.set(campaign.id, frozenCampaign);
    return {
      fundingOrder: clone(fundingOrder),
      campaign: clone(frozenCampaign),
      created: true,
    };
  }

  async getFundingOrder(id: string): Promise<FundingOrder | null> {
    const order = state().fundingOrders.get(id);
    return order ? clone(order) : null;
  }

  async getFundingOrderForCampaign(campaignId: string): Promise<FundingOrder | null> {
    const order = [...state().fundingOrders.values()]
      .filter((candidate) => candidate.campaignId === campaignId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    return order ? clone(order) : null;
  }

  async getFundingOrderByIdempotency(
    creatorId: string,
    key: string,
  ): Promise<FundingOrder | null> {
    const database = state();
    const id = database.fundingIdempotency.get(`${creatorId}:${key}`);
    const order = id ? database.fundingOrders.get(id) : null;
    return order ? clone(order) : null;
  }

  async transitionFundingOrder(
    id: string,
    from: FundingOrderStatus[],
    to: FundingOrderStatus,
    expectedVersion: number,
    patch: Partial<
      Pick<
        FundingOrder,
        | "providerReference"
        | "depositTxHash"
        | "settlementTxHash"
        | "fundingReference"
        | "evidence"
      >
    > = {},
  ): Promise<FundingOrder | null> {
    const database = state();
    const order = database.fundingOrders.get(id);
    if (!order || !from.includes(order.status) || order.version !== expectedVersion) return null;
    const updated: FundingOrder = {
      ...order,
      ...clone(patch),
      status: to,
      version: order.version + 1,
      updatedAt: now(),
    };
    database.fundingOrders.set(id, updated);
    return clone(updated);
  }

  async createClaimIdempotent(
    input: ClaimCreateData,
  ): Promise<{ claim: Claim; created: boolean }> {
    const database = state();
    const actor = input.claimantId ?? "anonymous";
    const key = `${actor}:${input.idempotencyKey}`;
    const existingId = database.claimIdempotency.get(key);
    if (existingId) {
      return { claim: clone(database.claims.get(existingId)!), created: false };
    }
    const timestamp = now();
    const claim: Claim = {
      ...clone(input),
      id: input.id ?? randomUUID(),
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    database.claims.set(claim.id, claim);
    database.claimIdempotency.set(key, claim.id);
    return { claim: clone(claim), created: true };
  }

  async getClaim(id: string): Promise<Claim | null> {
    const claim = state().claims.get(id);
    return claim ? clone(claim) : null;
  }

  async getClaimByIdempotency(
    claimantId: string,
    key: string,
  ): Promise<Claim | null> {
    const database = state();
    const id = database.claimIdempotency.get(`${claimantId}:${key}`);
    const claim = id ? database.claims.get(id) : null;
    return claim ? clone(claim) : null;
  }

  async submitClaimAtomically(
    claimId: string,
    claimExpectedVersion: number,
    campaignExpectedVersion: number,
    solutionProofDigest: string,
    solutionProof: Claim["solutionProof"],
  ): Promise<{ claim: Claim; campaign: Campaign } | null> {
    const database = state();
    const claim = database.claims.get(claimId);
    if (
      !claim ||
      !["QUOTED", "AWAITING_PROOF"].includes(claim.status) ||
      claim.version !== claimExpectedVersion
    ) {
      return null;
    }
    const campaign = database.campaigns.get(claim.campaignId);
    if (
      !campaign ||
      campaign.status !== "ACTIVE" ||
      campaign.version !== campaignExpectedVersion
    ) {
      return null;
    }
    const timestamp = now();
    const updatedCampaign: Campaign = {
      ...campaign,
      status: "CLAIMING",
      version: campaign.version + 1,
      updatedAt: timestamp,
    };
    const updatedClaim: Claim = {
      ...claim,
      status: "SUBMITTED",
      solutionProofDigest,
      solutionProof: clone(solutionProof),
      version: claim.version + 1,
      updatedAt: timestamp,
    };
    database.campaigns.set(campaign.id, updatedCampaign);
    database.claims.set(claim.id, updatedClaim);
    return { campaign: clone(updatedCampaign), claim: clone(updatedClaim) };
  }

  async transitionClaim(
    id: string,
    from: ClaimStatus[],
    to: ClaimStatus,
    expectedVersion: number,
    patch: Partial<
      Pick<
        Claim,
        | "solutionProofDigest"
        | "solutionProof"
        | "contractTxHash"
        | "settlementTxHash"
        | "evidence"
      >
    > = {},
  ): Promise<Claim | null> {
    const database = state();
    const claim = database.claims.get(id);
    if (!claim || !from.includes(claim.status) || claim.version !== expectedVersion) return null;
    const updated: Claim = {
      ...claim,
      ...clone(patch),
      status: to,
      version: claim.version + 1,
      updatedAt: now(),
    };
    database.claims.set(id, updated);
    return clone(updated);
  }

  async finalizeOneClickPayoutAtomically(
    input: FinalizeOneClickPayoutData,
  ): Promise<{ claim: Claim; campaign: Campaign } | null> {
    const database = state();
    const claim = database.claims.get(input.claimId);
    const campaign = database.campaigns.get(input.campaignId);
    if (
      !claim ||
      !campaign ||
      claim.campaignId !== campaign.id ||
      claim.payout.kind !== "ONE_CLICK" ||
      !["PAYING", "FAILED", input.target].includes(claim.status) ||
      !["CLAIMING", "CLAIMED"].includes(campaign.status)
    ) {
      return null;
    }
    const terminalReceipt =
      claim.status === input.target
        ? claim.settlementTxHash
        : input.claimPatch?.settlementTxHash ?? claim.settlementTxHash;
    if (!terminalReceipt?.trim()) return null;

    const timestamp = now();
    const updatedClaim: Claim =
      claim.status === input.target
        ? claim
        : {
            ...claim,
            ...clone(input.claimPatch ?? {}),
            status: input.target,
            version: claim.version + 1,
            updatedAt: timestamp,
          };
    const updatedCampaign: Campaign =
      campaign.status === "CLAIMED"
        ? campaign
        : {
            ...campaign,
            status: "CLAIMED",
            version: campaign.version + 1,
            updatedAt: timestamp,
          };

    // There are no awaits between validation and these writes, so observers of
    // the in-memory test ledger cannot see a split terminal state.
    database.claims.set(claim.id, updatedClaim);
    database.campaigns.set(campaign.id, updatedCampaign);
    return {
      claim: clone(updatedClaim),
      campaign: clone(updatedCampaign),
    };
  }

  async appendEvent(input: EventCreateData): Promise<OperationEvent> {
    if (input.idempotencyKey) {
      const existing = state().events.find(
        (event) =>
          event.aggregateType === input.aggregateType &&
          event.aggregateId === input.aggregateId &&
          event.eventType === input.eventType &&
          event.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return clone(existing);
    }
    const event: OperationEvent = {
      ...clone(input),
      id: input.id ?? randomUUID(),
      createdAt: now(),
    };
    state().events.push(event);
    return clone(event);
  }

  async listEvents(aggregateType: string, aggregateId: string): Promise<OperationEvent[]> {
    return clone(
      state().events.filter(
        (event) =>
          event.aggregateType === aggregateType && event.aggregateId === aggregateId,
      ),
    );
  }

  async getLiveLiabilities(): Promise<{
    amountAtomic: string;
    campaignCount: number;
    routingInFlightAmountAtomic: string;
    routingInFlightCampaignCount: number;
  }> {
    const database = state();
    const campaigns = [...database.campaigns.values()].filter(
      (campaign) =>
        campaign.reward.type === "TOKEN_PRIZE" &&
        ["SCHEDULED", "ACTIVE", "CLAIMING", "REFUNDING"].includes(
          campaign.status,
        ),
    );
    const releasedCampaignIds = new Set<string>();
    const routingCampaigns = campaigns.filter((campaign) => {
      if (campaign.status !== "CLAIMING") return false;
      let routing = false;
      for (const claim of database.claims.values()) {
        const evidence =
          claim.evidence &&
          typeof claim.evidence === "object" &&
          !Array.isArray(claim.evidence)
            ? claim.evidence
            : {};
        const terminal =
          ["PAID", "RECOVERED"].includes(claim.status) &&
          Boolean(claim.settlementTxHash);
        const deposited =
          ["PAYING", "FAILED"].includes(claim.status) &&
          evidence.contractState === "claimed";
        if (
          claim.campaignId === campaign.id &&
          claim.payout.kind === "ONE_CLICK" &&
          (terminal || deposited)
        ) {
          releasedCampaignIds.add(campaign.id);
          routing ||= deposited;
        }
      }
      return routing;
    });
    const escrowCampaigns = campaigns.filter(
      (campaign) => !releasedCampaignIds.has(campaign.id),
    );
    const amount = escrowCampaigns.reduce(
      (sum, campaign) =>
        sum +
        BigInt(
          campaign.reward.type === "TOKEN_PRIZE"
            ? campaign.reward.amountAtomic
            : "0",
      ),
      0n,
    );
    const routingAmount = routingCampaigns.reduce(
      (sum, campaign) =>
        sum +
        BigInt(
          campaign.reward.type === "TOKEN_PRIZE"
            ? campaign.reward.amountAtomic
            : "0",
        ),
      0n,
    );
    return {
      amountAtomic: amount.toString(),
      campaignCount: escrowCampaigns.length,
      routingInFlightAmountAtomic: routingAmount.toString(),
      routingInFlightCampaignCount: routingCampaigns.length,
    };
  }

  async reserveIdempotency(
    scope: string,
    actorId: string,
    key: string,
    requestHash: string,
    expiresAt: string,
    processing?: IdempotencyProcessingReservation,
  ): Promise<{ record: IdempotencyRecord; created: boolean }> {
    const database = state();
    const compound = `${scope}:${actorId}:${key}`;
    const existing = database.idempotency.get(compound);
    if (
      existing &&
      (existing.scope === "AI_GENERATE_X402_V2" ||
        (existing.state === "PROCESSING" &&
          existing.authorizationDigest !== null) ||
        new Date(existing.expiresAt).getTime() > Date.now())
    ) {
      return { record: clone(existing), created: false };
    }
    if (existing) database.idempotency.delete(compound);
    const timestamp = now();
    const record: IdempotencyRecord = {
      scope,
      actorId,
      key,
      requestHash,
      state: "PROCESSING",
      responseStatus: null,
      responseBody: clone(processing?.responseBody ?? null),
      paymentReference: null,
      authorizationDigest: processing?.authorizationDigest ?? null,
      processingStage: processing?.stage ?? null,
      processingOwner: null,
      processingLeaseExpiresAt: null,
      processingVersion: 0,
      expiresAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    database.idempotency.set(compound, record);
    return { record: clone(record), created: true };
  }

  async getIdempotency(
    scope: string,
    actorId: string,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const record = state().idempotency.get(`${scope}:${actorId}:${key}`);
    if (
      !record ||
      (record.scope !== "AI_GENERATE_X402_V2" &&
        !(
          record.state === "PROCESSING" &&
          record.authorizationDigest !== null
        ) &&
        new Date(record.expiresAt).getTime() <= Date.now())
    ) {
      return null;
    }
    return clone(record);
  }

  async acquireIdempotencyProcessingLease(
    scope: string,
    actorId: string,
    key: string,
    requestHash: string,
    authorizationDigest: string,
    ownerId: string,
    acquiredAt: string,
    leaseExpiresAt: string,
  ): Promise<{ record: IdempotencyRecord; acquired: boolean }> {
    const database = state();
    const compound = `${scope}:${actorId}:${key}`;
    const record = database.idempotency.get(compound);
    if (
      !record ||
      record.state !== "PROCESSING" ||
      record.requestHash !== requestHash ||
      record.authorizationDigest !== authorizationDigest ||
      (record.processingOwner !== null &&
        (record.processingLeaseExpiresAt === null ||
          record.processingLeaseExpiresAt > acquiredAt))
    ) {
      if (!record) {
        throw new AppError(
          404,
          "IDEMPOTENCY_NOT_FOUND",
          "Request was not reserved",
        );
      }
      return { record: clone(record), acquired: false };
    }
    const updated: IdempotencyRecord = {
      ...record,
      processingOwner: ownerId,
      processingLeaseExpiresAt: leaseExpiresAt,
      processingVersion: record.processingVersion + 1,
      updatedAt: acquiredAt,
    };
    database.idempotency.set(compound, updated);
    return { record: clone(updated), acquired: true };
  }

  async advanceIdempotencyProcessing(
    scope: string,
    actorId: string,
    key: string,
    requestHash: string,
    authorizationDigest: string,
    ownerId: string,
    expectedVersion: number,
    fromStage:
      | "AUTHORIZED"
      | "GENERATED"
      | "SETTLING"
      | "SETTLED"
      | "SETTLEMENT_UNKNOWN",
    toStage:
      | "AUTHORIZED"
      | "GENERATED"
      | "SETTLING"
      | "SETTLED"
      | "SETTLEMENT_UNKNOWN",
    responseBody: JsonValue,
    leaseExpiresAt: string | null,
  ): Promise<IdempotencyRecord | null> {
    const database = state();
    const compound = `${scope}:${actorId}:${key}`;
    const record = database.idempotency.get(compound);
    const allowedTransition =
      (fromStage === "AUTHORIZED" && toStage === "GENERATED") ||
      (fromStage === "GENERATED" && toStage === "SETTLING") ||
      (fromStage === "SETTLING" && toStage === "SETTLED") ||
      (fromStage === "SETTLING" && toStage === "SETTLEMENT_UNKNOWN") ||
      (fromStage === "SETTLEMENT_UNKNOWN" && toStage === "SETTLING");
    const releaseLease = toStage === "SETTLEMENT_UNKNOWN";
    if (
      !record ||
      record.state !== "PROCESSING" ||
      record.requestHash !== requestHash ||
      !allowedTransition ||
      record.authorizationDigest !== authorizationDigest ||
      record.processingOwner !== ownerId ||
      record.processingVersion !== expectedVersion ||
      record.processingStage !== fromStage ||
      (releaseLease ? leaseExpiresAt !== null : leaseExpiresAt === null)
    ) {
      return null;
    }
    const updated: IdempotencyRecord = {
      ...record,
      authorizationDigest,
      processingStage: toStage,
      responseBody: clone(responseBody),
      processingOwner: releaseLease ? null : ownerId,
      processingLeaseExpiresAt: leaseExpiresAt,
      processingVersion: record.processingVersion + 1,
      updatedAt: now(),
    };
    database.idempotency.set(compound, updated);
    return clone(updated);
  }

  async finishOwnedIdempotency(
    scope: string,
    actorId: string,
    key: string,
    ownerId: string,
    expectedVersion: number,
    expectedStage:
      | "AUTHORIZED"
      | "GENERATED"
      | "SETTLING"
      | "SETTLED"
      | "SETTLEMENT_UNKNOWN",
    result: "COMPLETED" | "FAILED",
    responseStatus: number,
    responseBody: JsonValue,
    paymentReference: string | null = null,
  ): Promise<IdempotencyRecord | null> {
    const database = state();
    const compound = `${scope}:${actorId}:${key}`;
    const record = database.idempotency.get(compound);
    if (
      !record ||
      record.state !== "PROCESSING" ||
      record.processingOwner !== ownerId ||
      record.processingVersion !== expectedVersion ||
      record.processingStage !== expectedStage
    ) {
      return null;
    }
    const updated: IdempotencyRecord = {
      ...record,
      state: result,
      responseStatus,
      responseBody: clone(responseBody),
      paymentReference,
      processingStage: null,
      processingOwner: null,
      processingLeaseExpiresAt: null,
      processingVersion: record.processingVersion + 1,
      updatedAt: now(),
    };
    database.idempotency.set(compound, updated);
    return clone(updated);
  }

  async completeIdempotency(
    scope: string,
    actorId: string,
    key: string,
    responseStatus: number,
    responseBody: JsonValue,
    paymentReference: string | null = null,
  ): Promise<IdempotencyRecord> {
    return this.finishIdempotency(
      scope,
      actorId,
      key,
      "COMPLETED",
      responseStatus,
      responseBody,
      paymentReference,
    );
  }

  async failIdempotency(
    scope: string,
    actorId: string,
    key: string,
    responseStatus: number,
    responseBody: JsonValue,
  ): Promise<IdempotencyRecord> {
    return this.finishIdempotency(
      scope,
      actorId,
      key,
      "FAILED",
      responseStatus,
      responseBody,
      null,
    );
  }

  private async finishIdempotency(
    scope: string,
    actorId: string,
    key: string,
    result: "COMPLETED" | "FAILED",
    responseStatus: number,
    responseBody: JsonValue,
    paymentReference: string | null,
  ): Promise<IdempotencyRecord> {
    const database = state();
    const compound = `${scope}:${actorId}:${key}`;
    const record = database.idempotency.get(compound);
    if (!record) throw new AppError(404, "IDEMPOTENCY_NOT_FOUND", "Request was not reserved");
    if (record.state !== "PROCESSING" || record.processingOwner !== null) {
      throw new AppError(
        409,
        "IDEMPOTENCY_STATE_CONFLICT",
        "Request is not available for unowned completion",
      );
    }
    const updated: IdempotencyRecord = {
      ...record,
      state: result,
      responseStatus,
      responseBody: clone(responseBody),
      paymentReference,
      processingStage: null,
      processingOwner: null,
      processingLeaseExpiresAt: null,
      processingVersion: record.processingVersion + 1,
      updatedAt: now(),
    };
    database.idempotency.set(compound, updated);
    return clone(updated);
  }

  async enqueueJob(input: JobCreateData): Promise<{ job: Job; created: boolean }> {
    const database = state();
    const existingId = database.jobDeduplication.get(input.deduplicationKey);
    if (existingId) {
      const existing = database.jobs.get(existingId)!;
      if (existing.status === "DEAD" && input.reactivateDead) {
        const revived: Job = {
          ...existing,
          status: "PENDING",
          payload: clone(input.payload),
          attempts: 0,
          maxAttempts: input.maxAttempts,
          runAfter: input.runAfter,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: null,
          result: null,
          updatedAt: now(),
        };
        database.jobs.set(existingId, revived);
        return { job: clone(revived), created: false };
      }
      return { job: clone(existing), created: false };
    }
    const timestamp = now();
    const jobInput = clone(input);
    delete jobInput.reactivateDead;
    const job: Job = {
      ...jobInput,
      id: input.id ?? randomUUID(),
      status: "PENDING",
      attempts: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
      result: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    database.jobs.set(job.id, job);
    database.jobDeduplication.set(job.deduplicationKey, job.id);
    return { job: clone(job), created: true };
  }

  async leaseJobs(
    workerId: string,
    limit: number,
    leaseUntil: string,
    current = now(),
  ): Promise<Job[]> {
    const database = state();
    const candidates = [...database.jobs.values()]
      .filter(
        (job) =>
          (job.status === "PENDING" ||
            (job.status === "RUNNING" &&
              job.leaseExpiresAt !== null &&
              job.leaseExpiresAt <= current)) &&
          job.runAfter <= current &&
          job.attempts < job.maxAttempts,
      )
      .sort((a, b) => a.runAfter.localeCompare(b.runAfter))
      .slice(0, limit);
    return candidates.map((job) => {
      const updated: Job = {
        ...job,
        status: "RUNNING",
        attempts: job.attempts + 1,
        leaseOwner: workerId,
        leaseExpiresAt: leaseUntil,
        updatedAt: current,
      };
      database.jobs.set(job.id, updated);
      return clone(updated);
    });
  }

  async completeJob(id: string, workerId: string, result: JsonValue): Promise<Job | null> {
    const database = state();
    const job = database.jobs.get(id);
    if (!job || job.status !== "RUNNING" || job.leaseOwner !== workerId) return null;
    const updated: Job = {
      ...job,
      status: "SUCCEEDED",
      result: clone(result),
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now(),
    };
    database.jobs.set(id, updated);
    return clone(updated);
  }

  async rescheduleJob(
    id: string,
    workerId: string,
    result: JsonValue,
    runAfter: string,
  ): Promise<Job | null> {
    const database = state();
    const job = database.jobs.get(id);
    if (!job || job.status !== "RUNNING" || job.leaseOwner !== workerId) return null;
    const updated: Job = {
      ...job,
      status: "PENDING",
      attempts: 0,
      runAfter,
      result: clone(result),
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now(),
    };
    database.jobs.set(id, updated);
    return clone(updated);
  }

  async failJob(
    id: string,
    workerId: string,
    error: string,
    retryAt: string,
  ): Promise<Job | null> {
    const database = state();
    const job = database.jobs.get(id);
    if (!job || job.status !== "RUNNING" || job.leaseOwner !== workerId) return null;
    const terminal = job.attempts >= job.maxAttempts;
    const updated: Job = {
      ...job,
      status: terminal ? "DEAD" : "PENDING",
      runAfter: retryAt,
      lastError: error.slice(0, 2_000),
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now(),
    };
    database.jobs.set(id, updated);
    return clone(updated);
  }
}

export function resetMemoryRepositoryForTests(): void {
  const holder = globalThis as typeof globalThis & { [stateKey]?: MemoryState };
  delete holder[stateKey];
}
