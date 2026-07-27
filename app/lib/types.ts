export type CampaignState =
  | "draft"
  | "awaiting_funding"
  | "scheduled"
  | "active"
  | "claiming"
  | "claimed"
  | "refunding"
  | "refunded"
  | "expired";

export type Visibility = "public" | "unlisted";

export type PuzzleDirection = "across" | "down";

export interface PuzzleEntry {
  number: number;
  row: number;
  column: number;
  length: number;
  direction: PuzzleDirection;
  clue: string;
}

export interface PuzzleDefinition {
  rows: number;
  columns: number;
  entries: PuzzleEntry[];
}

export interface CampaignEvidence {
  label: string;
  value: string;
  href?: string;
}

export interface CampaignVerification {
  status: "preview" | "unavailable" | "verified";
  fundedAndLocked: boolean;
  contractMatchesLedger: boolean;
  contractState: string | null;
  contractExplorerUrl: string | null;
  fundingTransactionExplorerUrl: string | null;
}

export interface TokenPrize {
  type: "token";
  amount: string;
  symbol: "USDC";
  decimals: 6;
  escrowAccount: string;
  fundingRail: "direct" | "intents" | "mpp";
  originLabel: string;
}

export interface PrepaidX402Entitlement {
  type: "x402_entitlement";
  title: string;
  provider: string;
  receiptDigest: string;
}

export type CampaignReward = TokenPrize | PrepaidX402Entitlement;

export interface Campaign {
  id: string;
  slug: string;
  title: string;
  description: string;
  sponsorName: string;
  sponsorMark: string;
  theme: string;
  state: CampaignState;
  visibility: Visibility;
  opensAt: string;
  expiresAt: string;
  createdAt: string;
  reward: CampaignReward;
  puzzle: PuzzleDefinition;
  rules: string[];
  solverCount: number;
  evidence: CampaignEvidence[];
  verification: CampaignVerification;
  contentHash: string;
  contractId: string;
  isDemo?: boolean;
  winner?: {
    destination: string;
    claimedAt: string;
  };
}

export interface CampaignDraft {
  id: string;
  creatorAccountId: string;
  refundAccount: string;
  title: string;
  description: string;
  sponsorName: string;
  visibility: Visibility;
  durationHours: number;
  solutionPublicKey: string;
  puzzle: PuzzleDefinition;
  reward: {
    type: "TOKEN_PRIZE";
    assetId: string;
    amountAtomic: string;
    decimals: 6;
    symbol: "USDC";
  };
  aiReceiptHandle?: AiGenerationReceiptHandle | null;
  fundingPreference: {
    rail: "direct" | "intents";
    originAsset: string;
  };
}

export interface AiGenerationReceiptHandle {
  version: "x402-ai-generation-receipt:v1";
  paymentIdentifier: string;
}

export interface FundingQuote {
  id: string;
  campaignId: string;
  rail: "direct" | "intents";
  originAsset: string;
  originAmount: string;
  targetAmount: string;
  targetAsset: "USDC";
  networkFee: string;
  platformFee: string;
  expiresAt: string;
  depositAddress?: string;
}

export interface CampaignFundingOrder {
  id: string;
  campaignId: string;
  rail: "DIRECT_NEAR" | "ONE_CLICK" | "MOCK";
  status: string;
  version: number;
  originAssetId: string;
  principalAmountAtomic: string;
  inputAmountAtomic: string | null;
  routingFeeAtomic: string;
  platformFeeAtomic: string;
  refundTo: string;
  depositAddress: string | null;
  depositTxHash: string | null;
  settlementTxHash: string | null;
  fundingReference: string | null;
  expiresAt: string;
  quote: {
    depositMemo: string | null;
    instructions: Record<string, unknown>;
  };
}

export interface CampaignFundingQuoteResult {
  fundingOrder: CampaignFundingOrder;
  authorizationRequired: boolean;
}

export interface AuthorizedFundingDeposit {
  depositAddress: string;
  depositMemo: string | null;
  originAssetId: string;
  inputAmountAtomic: string;
  deadline: string;
  providerQuoteId: string | null;
}

export interface FundingAuthorizationConfirmation {
  fundingOrder: {
    id: string;
    campaignId: string;
    status: string;
    version: number;
  };
  authorization: {
    contractId: string;
    campaignId: string;
    fundingReference: string;
    fundingDeadlineMs: string;
    verifiedAt: string;
  };
  deposit: AuthorizedFundingDeposit;
}

export interface CampaignLifecycleStatus {
  campaign: {
    id: string;
    slug: string;
    status: string;
    version: number;
  };
  fundingOrder: CampaignFundingOrder | null;
  onChain: {
    status?: {
      state?: string;
    };
  } | null;
  chainUnavailable: boolean;
  authorizationRequired: boolean;
  quoteExpired: boolean;
}

export interface ExternalFundingAuthorizationInstruction {
  version: "crossword-external-funding-authorization:v1";
  authorizedCreatorAccountId: string;
  fundingReference: string;
  storageDepositNotice: string;
  walletCall: {
    signerId: string;
    receiverId: string;
    actions: [
      {
        type: "FunctionCall";
        methodName: "authorize_external_funding";
        args: {
          args: {
            campaign: {
              campaign_id: string;
              creator_id: string;
              controller_id: string;
              content_hash: string;
              solution_public_key: string;
              opens_at_ms: number;
              expires_at_ms: number;
              refund_account_id: string;
            };
            amount: string;
            funding_reference: string;
            funding_rail: "intents";
            sponsor_id: string;
            funding_deadline_ms: number;
          };
        };
        gas: string;
        deposit: string;
      },
    ];
  };
}

export type ClaimLifecycleStatus =
  | "QUOTED"
  | "AWAITING_PROOF"
  | "SUBMITTED"
  | "PAYING"
  | "PAID"
  | "RECOVERED"
  | "FAILED"
  | "EXPIRED";

export interface CampaignClaim {
  id: string;
  campaignId: string;
  status: ClaimLifecycleStatus;
  contractTxHash: string | null;
  settlementTxHash: string | null;
  evidence: Record<string, unknown>;
}

export interface EscrowAsset {
  assetId: string;
  symbol: "USDC";
  decimals: 6;
  contractId: string;
}

export interface SupportedToken {
  assetId: string;
  symbol: string;
  decimals: number;
  network: string;
  label?: string;
}
