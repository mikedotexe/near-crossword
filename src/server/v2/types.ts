export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type CampaignStatus =
  | "DRAFT"
  | "FUNDING"
  | "SCHEDULED"
  | "ACTIVE"
  | "CLAIMING"
  | "CLAIMED"
  | "REFUNDING"
  | "REFUNDED"
  | "CANCELLED";

export type FundingRail = "DIRECT_NEAR" | "ONE_CLICK" | "MOCK";

export type FundingOrderStatus =
  | "QUOTED"
  | "AWAITING_DEPOSIT"
  | "DEPOSIT_DETECTED"
  | "PROCESSING"
  | "SETTLED"
  | "ALLOCATING"
  | "ALLOCATED"
  | "INCOMPLETE"
  | "REFUNDED"
  | "FAILED"
  | "EXPIRED";

export type ClaimStatus =
  | "QUOTED"
  | "AWAITING_PROOF"
  | "SUBMITTED"
  | "PAYING"
  | "PAID"
  | "RECOVERED"
  | "FAILED"
  | "EXPIRED";

export type JobStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "DEAD";

export interface TokenPrize {
  type: "TOKEN_PRIZE";
  assetId: string;
  amountAtomic: string;
  decimals: number;
  symbol: string;
}

export interface PrepaidX402Entitlement {
  type: "PREPAID_X402_ENTITLEMENT";
  catalogItemId: string;
  offerDigest: string;
  receiptDigest: string;
  encryptedArtifact: string;
}

export type RewardSpec = TokenPrize | PrepaidX402Entitlement;

export interface AiGenerationReceiptHandle {
  version: "x402-ai-generation-receipt:v1";
  paymentIdentifier: string;
}

/**
 * Public, sanitized provenance for an x402-paid AI draft. This deliberately
 * excludes the payment authorization, payer, request, prompt, and generated
 * answers.
 */
export interface AiGenerationReceiptEvidence {
  paymentIdentifier: string;
  receiptDigest: string;
  network: string;
  settlementReference: string;
}

export interface PuzzleCell {
  row: number;
  column: number;
  value?: never;
}

export interface PuzzleClue {
  number: number;
  clue: string;
  row: number;
  column: number;
  direction: "across" | "down";
  length: number;
}

/**
 * Public puzzle data. Deliberately has no answer or seed/key fields.
 */
export interface PublicPuzzle {
  width: number;
  height: number;
  clues: PuzzleClue[];
  blockedCells?: PuzzleCell[];
}

export interface Campaign {
  id: string;
  slug: string;
  creatorId: string;
  creatorAccountId: string | null;
  title: string;
  description: string | null;
  sponsorName: string | null;
  sponsorUrl: string | null;
  visibility: "PUBLIC" | "UNLISTED";
  status: CampaignStatus;
  puzzle: PublicPuzzle;
  contentHash: string | null;
  solutionPublicKey: string | null;
  reward: RewardSpec;
  contractId: string | null;
  openingAt: string | null;
  expiresAt: string | null;
  refundAccount: string | null;
  fundingReference: string | null;
  chainCampaignId: string | null;
  aiGenerationReceipt: AiGenerationReceiptEvidence | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteMoney {
  assetId: string;
  amountAtomic: string;
}

export interface FundingQuote {
  rail: FundingRail;
  origin: QuoteMoney;
  principal: QuoteMoney;
  estimatedDelivery?: QuoteMoney;
  routingFee: QuoteMoney;
  platformFee: QuoteMoney;
  depositAddress: string;
  depositMemo: string | null;
  deadline: string;
  providerQuoteId: string | null;
  providerStatus: string;
  rawDigest: string;
  instructions: JsonValue;
}

export interface FundingOrder {
  id: string;
  campaignId: string;
  creatorId: string;
  rail: FundingRail;
  status: FundingOrderStatus;
  idempotencyKey: string;
  originAssetId: string;
  destinationAssetId: string;
  principalAmountAtomic: string;
  inputAmountAtomic: string;
  routingFeeAtomic: string;
  platformFeeAtomic: string;
  refundTo: string;
  quote: FundingQuote;
  providerReference: string | null;
  depositAddress: string;
  depositTxHash: string | null;
  settlementTxHash: string | null;
  fundingReference: string | null;
  evidence: JsonValue;
  expiresAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DirectNearPayout {
  kind: "DIRECT_NEAR";
  destinationAsset: string;
  recipient: string;
  recoveryAccount: string;
}

export interface OneClickPayout {
  kind: "ONE_CLICK";
  destinationAsset: string;
  recipient: string;
  recoveryAccount: string;
}

export type Payout = DirectNearPayout | OneClickPayout;

export interface SolutionProof {
  signature: string;
  nonce: string;
  deadlineMs: string;
  payoutDigest: string;
}

export interface Claim {
  id: string;
  campaignId: string;
  claimantId: string | null;
  status: ClaimStatus;
  idempotencyKey: string;
  payout: Payout;
  payoutQuote: FundingQuote | null;
  solutionProofDigest: string | null;
  solutionProof: SolutionProof | null;
  contractTxHash: string | null;
  settlementTxHash: string | null;
  evidence: JsonValue;
  expiresAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OperationEvent {
  id: string;
  aggregateType: "CAMPAIGN" | "FUNDING_ORDER" | "CLAIM" | "JOB" | "AI_REQUEST";
  aggregateId: string;
  eventType: string;
  actorId: string | null;
  fromState: string | null;
  toState: string | null;
  idempotencyKey: string | null;
  evidence: JsonValue;
  createdAt: string;
}

export interface Job {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  deduplicationKey: string;
  status: JobStatus;
  payload: JsonValue;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
  result: JsonValue;
  createdAt: string;
  updatedAt: string;
}

export interface IdempotencyRecord {
  scope: string;
  actorId: string;
  key: string;
  requestHash: string;
  state: "PROCESSING" | "COMPLETED" | "FAILED";
  responseStatus: number | null;
  responseBody: JsonValue;
  paymentReference: string | null;
  authorizationDigest: string | null;
  processingStage:
    | "AUTHORIZED"
    | "GENERATED"
    | "SETTLING"
    | "SETTLED"
    | "SETTLEMENT_UNKNOWN"
    | null;
  processingOwner: string | null;
  processingLeaseExpiresAt: string | null;
  processingVersion: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TokenCatalogItem {
  assetId: string;
  symbol: string;
  decimals: number;
  blockchain: string;
  contractAddress: string | null;
  price: number | null;
  priceUpdatedAt: string | null;
}

export interface Actor {
  id: string;
  email: string | null;
  demo: boolean;
}
