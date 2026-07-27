import type {
  Campaign,
  FundingOrder,
  FundingOrderStatus,
  FundingQuote,
  FundingRail,
  Payout,
} from "../types";

export interface FundingQuoteRequest {
  kind: "FUND_CAMPAIGN";
  campaign: Campaign;
  originAssetId: string;
  refundTo: string;
  fundingReference: string;
  deadline: string;
}

export interface PayoutQuoteRequest {
  kind: "PAYOUT_WINNER";
  campaign: Campaign;
  payout: Payout;
  deadline: string;
}

export type AdapterQuoteRequest = FundingQuoteRequest | PayoutQuoteRequest;

export interface FundingObservation {
  providerStatus: string;
  orderStatus: FundingOrderStatus;
  depositTxHash: string | null;
  settlementTxHash: string | null;
  fundingReference: string | null;
  evidence: Record<string, string | number | boolean | null>;
}

export interface FinalizationDecision {
  readyForAllocation: boolean;
  terminal: boolean;
  observation: FundingObservation;
}

export interface FundingAdapter {
  readonly rail: FundingRail;
  quote(request: AdapterQuoteRequest): Promise<FundingQuote>;
  observe(order: FundingOrder): Promise<FundingObservation>;
  finalize(order: FundingOrder): Promise<FinalizationDecision>;
  reconcile(order: FundingOrder): Promise<FinalizationDecision>;
}
