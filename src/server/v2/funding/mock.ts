import { createHash } from "node:crypto";
import { escrowAsset } from "../config";
import type { FundingQuote } from "../types";
import type {
  AdapterQuoteRequest,
  FinalizationDecision,
  FundingAdapter,
  FundingObservation,
} from "./types";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class DeterministicMockFundingAdapter implements FundingAdapter {
  readonly rail = "MOCK" as const;

  constructor(
    private readonly forcedObservation: FundingObservation | null = null,
  ) {}

  async quote(request: AdapterQuoteRequest): Promise<FundingQuote> {
    const escrow = escrowAsset();
    const id = digest(JSON.stringify(request));
    const principal =
      request.campaign.reward.type === "TOKEN_PRIZE"
        ? request.campaign.reward.amountAtomic
        : "1";
    const origin =
      request.kind === "FUND_CAMPAIGN"
        ? request.originAssetId
        : escrow.assetId;
    return {
      rail: "MOCK",
      origin: { assetId: origin, amountAtomic: principal },
      principal: { assetId: escrow.assetId, amountAtomic: principal },
      estimatedDelivery: {
        assetId:
          request.kind === "FUND_CAMPAIGN"
            ? escrow.assetId
            : request.payout.destinationAsset,
        amountAtomic: principal,
      },
      routingFee: { assetId: origin, amountAtomic: "0" },
      platformFee: { assetId: origin, amountAtomic: "0" },
      depositAddress: `mock-deposit-${id.slice(0, 32)}`,
      depositMemo: null,
      deadline: request.deadline,
      providerQuoteId: `mock-${id.slice(0, 24)}`,
      providerStatus: "PENDING_DEPOSIT",
      rawDigest: id,
      instructions: {
        demo: true,
        warning: "No funds move in mock mode",
        action:
          request.kind === "FUND_CAMPAIGN"
            ? "Simulate an exact-output campaign deposit"
            : "Simulate an exact-input winner payout",
      },
    };
  }

  async observe(): Promise<FundingObservation> {
    return (
      this.forcedObservation ?? {
        providerStatus: "PENDING_DEPOSIT",
        orderStatus: "AWAITING_DEPOSIT",
        depositTxHash: null,
        settlementTxHash: null,
        fundingReference: null,
        evidence: { demo: true },
      }
    );
  }

  async finalize(): Promise<FinalizationDecision> {
    const observation = await this.observe();
    return {
      readyForAllocation: observation.orderStatus === "SETTLED",
      terminal: ["SETTLED", "REFUNDED", "FAILED", "EXPIRED"].includes(
        observation.orderStatus,
      ),
      observation,
    };
  }

  async reconcile(): Promise<FinalizationDecision> {
    return this.finalize();
  }
}
