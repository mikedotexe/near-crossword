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

export interface ListCampaignsQuery {
  status?: CampaignStatus;
  statuses?: CampaignStatus[];
  creatorId?: string;
  visibility?: "PUBLIC" | "UNLISTED";
  limit: number;
  offset: number;
}

export interface CampaignCreateData
  extends Omit<
    Campaign,
    "id" | "aiGenerationReceipt" | "version" | "createdAt" | "updatedAt"
  > {
  id?: string;
}

export type CampaignDraftPatch = Partial<
  Pick<
    Campaign,
    | "slug"
    | "creatorAccountId"
    | "title"
    | "description"
    | "sponsorName"
    | "sponsorUrl"
    | "visibility"
    | "puzzle"
    | "contentHash"
    | "solutionPublicKey"
    | "reward"
    | "openingAt"
    | "expiresAt"
    | "refundAccount"
  >
>;

export interface FundingOrderCreateData
  extends Omit<FundingOrder, "id" | "version" | "createdAt" | "updatedAt"> {
  id?: string;
}

export interface ClaimCreateData
  extends Omit<Claim, "id" | "version" | "createdAt" | "updatedAt"> {
  id?: string;
}

export interface EventCreateData extends Omit<OperationEvent, "id" | "createdAt"> {
  id?: string;
}

export interface JobCreateData
  extends Omit<
    Job,
    "id" | "status" | "attempts" | "leaseOwner" | "leaseExpiresAt" | "lastError" | "result" | "createdAt" | "updatedAt"
  > {
  id?: string;
  /**
   * An explicit recovery action may revive a terminal job. Routine recurring
   * enqueue calls leave DEAD jobs terminal so bounded retries stay bounded.
   */
  reactivateDead?: boolean;
}

export interface IdempotencyReservation {
  record: IdempotencyRecord;
  created: boolean;
}

export interface IdempotencyProcessingLease {
  record: IdempotencyRecord;
  acquired: boolean;
}

export interface IdempotencyProcessingReservation {
  authorizationDigest: string;
  stage:
    | "AUTHORIZED"
    | "GENERATED"
    | "SETTLING"
    | "SETTLED"
    | "SETTLEMENT_UNKNOWN";
  responseBody?: JsonValue;
}

export interface FinalizeOneClickPayoutData {
  claimId: string;
  campaignId: string;
  target: Extract<ClaimStatus, "PAID" | "RECOVERED">;
  claimPatch?: Partial<
    Pick<Claim, "settlementTxHash" | "evidence">
  >;
}

export interface Repository {
  readonly kind: "memory" | "postgres";

  createCampaign(
    input: CampaignCreateData,
    aiReceiptHandle?: AiGenerationReceiptHandle | null,
  ): Promise<Campaign>;
  getCampaign(idOrSlug: string): Promise<Campaign | null>;
  listCampaigns(query: ListCampaignsQuery): Promise<{ campaigns: Campaign[]; total: number }>;
  updateCampaignDraft(
    id: string,
    creatorId: string,
    expectedVersion: number,
    patch: CampaignDraftPatch,
  ): Promise<Campaign | null>;
  transitionCampaign(
    id: string,
    from: CampaignStatus[],
    to: CampaignStatus,
    expectedVersion: number,
    patch?: Partial<
      Pick<
        Campaign,
        "fundingReference" | "chainCampaignId" | "contractId" | "openingAt" | "expiresAt"
      >
    >,
  ): Promise<Campaign | null>;

  createFundingOrderIdempotent(
    input: FundingOrderCreateData,
  ): Promise<{ fundingOrder: FundingOrder; created: boolean }>;
  createFundingOrderAndFreezeCampaign(
    input: FundingOrderCreateData,
    campaignExpectedVersion: number,
  ): Promise<{ fundingOrder: FundingOrder; campaign: Campaign; created: boolean } | null>;
  getFundingOrder(id: string): Promise<FundingOrder | null>;
  getFundingOrderForCampaign(campaignId: string): Promise<FundingOrder | null>;
  getFundingOrderByIdempotency(
    creatorId: string,
    key: string,
  ): Promise<FundingOrder | null>;
  transitionFundingOrder(
    id: string,
    from: FundingOrderStatus[],
    to: FundingOrderStatus,
    expectedVersion: number,
    patch?: Partial<
      Pick<
        FundingOrder,
        | "providerReference"
        | "depositTxHash"
        | "settlementTxHash"
        | "fundingReference"
        | "evidence"
      >
    >,
  ): Promise<FundingOrder | null>;

  createClaimIdempotent(
    input: ClaimCreateData,
  ): Promise<{ claim: Claim; created: boolean }>;
  getClaim(id: string): Promise<Claim | null>;
  getClaimByIdempotency(
    claimantId: string,
    key: string,
  ): Promise<Claim | null>;
  submitClaimAtomically(
    claimId: string,
    claimExpectedVersion: number,
    campaignExpectedVersion: number,
    solutionProofDigest: string,
    solutionProof: Claim["solutionProof"],
  ): Promise<{ claim: Claim; campaign: Campaign } | null>;
  transitionClaim(
    id: string,
    from: ClaimStatus[],
    to: ClaimStatus,
    expectedVersion: number,
    patch?: Partial<
      Pick<
        Claim,
        | "solutionProofDigest"
        | "solutionProof"
        | "contractTxHash"
        | "settlementTxHash"
        | "evidence"
      >
    >,
  ): Promise<Claim | null>;
  /**
   * Commits the downstream terminal claim state and releases the campaign
   * liability as one ledger transaction. Calling this again repairs a legacy
   * terminal-claim/CLAIMING split state without rewriting terminal evidence.
   */
  finalizeOneClickPayoutAtomically(
    input: FinalizeOneClickPayoutData,
  ): Promise<{ claim: Claim; campaign: Campaign } | null>;

  appendEvent(input: EventCreateData): Promise<OperationEvent>;
  listEvents(aggregateType: string, aggregateId: string): Promise<OperationEvent[]>;
  getLiveLiabilities(): Promise<{
    /** Principal still reserved by the escrow contract. */
    amountAtomic: string;
    campaignCount: number;
    /** Principal already deposited to 1Click but awaiting settlement/refund. */
    routingInFlightAmountAtomic: string;
    routingInFlightCampaignCount: number;
  }>;

  reserveIdempotency(
    scope: string,
    actorId: string,
    key: string,
    requestHash: string,
    expiresAt: string,
    processing?: IdempotencyProcessingReservation,
  ): Promise<IdempotencyReservation>;
  getIdempotency(
    scope: string,
    actorId: string,
    key: string,
  ): Promise<IdempotencyRecord | null>;
  completeIdempotency(
    scope: string,
    actorId: string,
    key: string,
    responseStatus: number,
    responseBody: JsonValue,
    paymentReference?: string | null,
  ): Promise<IdempotencyRecord>;
  failIdempotency(
    scope: string,
    actorId: string,
    key: string,
    responseStatus: number,
    responseBody: JsonValue,
  ): Promise<IdempotencyRecord>;
  acquireIdempotencyProcessingLease(
    scope: string,
    actorId: string,
    key: string,
    requestHash: string,
    authorizationDigest: string,
    ownerId: string,
    acquiredAt: string,
    leaseExpiresAt: string,
  ): Promise<IdempotencyProcessingLease>;
  advanceIdempotencyProcessing(
    scope: string,
    actorId: string,
    key: string,
    requestHash: string,
    authorizationDigest: string,
    ownerId: string,
    expectedVersion: number,
    fromStage: IdempotencyProcessingReservation["stage"],
    toStage: IdempotencyProcessingReservation["stage"],
    responseBody: JsonValue,
    leaseExpiresAt: string | null,
  ): Promise<IdempotencyRecord | null>;
  finishOwnedIdempotency(
    scope: string,
    actorId: string,
    key: string,
    ownerId: string,
    expectedVersion: number,
    expectedStage: IdempotencyProcessingReservation["stage"],
    state: "COMPLETED" | "FAILED",
    responseStatus: number,
    responseBody: JsonValue,
    paymentReference?: string | null,
  ): Promise<IdempotencyRecord | null>;

  enqueueJob(input: JobCreateData): Promise<{ job: Job; created: boolean }>;
  leaseJobs(
    workerId: string,
    limit: number,
    leaseUntil: string,
    now?: string,
  ): Promise<Job[]>;
  completeJob(id: string, workerId: string, result: JsonValue): Promise<Job | null>;
  rescheduleJob(
    id: string,
    workerId: string,
    result: JsonValue,
    runAfter: string,
  ): Promise<Job | null>;
  failJob(
    id: string,
    workerId: string,
    error: string,
    retryAt: string,
  ): Promise<Job | null>;
}
