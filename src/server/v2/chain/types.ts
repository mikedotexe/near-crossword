import type { JsonValue } from "../types";

export type OnChainCampaignState =
  | "scheduled"
  | "active"
  | "claiming"
  | "claimed"
  | "refunding"
  | "refunded";

export interface OnChainCampaignStatus {
  state: OnChainCampaignState;
  receiverId?: string;
  payoutDigest?: string;
  nonce?: string;
  deadlineMs?: string;
  claimedAtMs?: string;
  refundAccountId?: string;
  refundAttempt?: string;
  refundInFlight?: boolean;
  refundedAtMs?: string;
}

export interface OnChainCampaign {
  campaignId: string;
  creatorId: string;
  controllerId: string;
  sponsorId: string;
  contentHash: string;
  solutionPublicKey: string;
  amount: string;
  opensAtMs: string;
  expiresAtMs: string;
  refundAccountId: string;
  claimNonce: string;
  fundingReference: string;
  fundingRail: "direct_usdc" | "intents" | "x402";
  status: OnChainCampaignStatus;
}

export interface OnChainExternalFundingAuthorization {
  campaignId: string;
  creatorId: string;
  controllerId: string;
  sponsorId: string;
  contentHash: string;
  solutionPublicKey: string;
  amount: string;
  opensAtMs: string;
  expiresAtMs: string;
  refundAccountId: string;
  fundingReference: string;
  fundingRail: "intents" | "x402";
  fundingDeadlineMs: string;
  expired: boolean;
  pending: boolean;
  storageDeposit: string;
}

export interface ContractCampaignSpec {
  campaign_id: string;
  creator_id: string;
  controller_id: string;
  content_hash: string;
  solution_public_key: string;
  opens_at_ms: number;
  expires_at_ms: number;
  refund_account_id: string;
}

export interface AuthorizeExternalFundingInput {
  campaign: ContractCampaignSpec;
  amount: string;
  fundingReference: string;
  fundingRail: "intents" | "x402";
  sponsorId: string;
  fundingDeadlineMs: number;
}

export interface AllocateExternalFundingInput {
  campaignId: string;
  fundingReference: string;
}

export interface SubmitContractClaimInput {
  campaignId: string;
  receiverId: string;
  payoutDigest: string;
  nonce: number;
  deadlineMs: number;
  signature: string;
}

export interface ChainTransaction {
  txHash: string;
}

export interface StorageRegistrationResult {
  alreadyRegistered: boolean;
  txHash: string | null;
}

export interface V2ChainClient {
  readonly contractId: string;
  readonly usdcContractId: string;

  getCampaign(campaignId: string): Promise<OnChainCampaign | null>;
  allocateExternalFunding(
    input: AllocateExternalFundingInput,
  ): Promise<ChainTransaction>;
  ensureStorageRegistration(accountId: string): Promise<StorageRegistrationResult>;
  submitContractClaim(input: SubmitContractClaimInput): Promise<ChainTransaction>;
  cancelBeforeOpen(campaignId: string): Promise<ChainTransaction>;
  expireAndRefund(campaignId: string): Promise<ChainTransaction>;
  retryRefund(campaignId: string): Promise<ChainTransaction>;
}

export interface WorkerLogger {
  info(message: string, metadata?: Record<string, JsonValue>): void;
  error(message: string, metadata?: Record<string, JsonValue>): void;
}
