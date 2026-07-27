import { digestJson } from "../validation";
import { campaignContractId, escrowAsset } from "../config";
import type { FundingQuote } from "../types";
import type {
  AdapterQuoteRequest,
  FinalizationDecision,
  FundingAdapter,
  FundingObservation,
} from "./types";
import { AppError } from "../errors";

export class DirectNearFundingAdapter implements FundingAdapter {
  readonly rail = "DIRECT_NEAR" as const;

  async quote(request: AdapterQuoteRequest): Promise<FundingQuote> {
    if (request.kind !== "FUND_CAMPAIGN") {
      throw new AppError(
        400,
        "INVALID_RAIL",
        "Direct NEAR payout does not require a routing quote",
      );
    }
    const escrow = escrowAsset();
    if (request.originAssetId !== escrow.assetId) {
      throw new AppError(
        400,
        "INVALID_DIRECT_ASSET",
        "Direct funding must use the pinned escrow USDC asset",
      );
    }
    if (request.campaign.reward.type !== "TOKEN_PRIZE") {
      throw new AppError(400, "UNSUPPORTED_REWARD", "Reward is not a token prize");
    }
    if (
      !request.campaign.creatorAccountId ||
      !request.campaign.refundAccount ||
      !request.campaign.contentHash ||
      !request.campaign.solutionPublicKey ||
      !request.campaign.expiresAt
    ) {
      throw new AppError(409, "CAMPAIGN_INCOMPLETE", "Campaign is not contract-ready");
    }
    const opensAtMs = request.campaign.openingAt
      ? new Date(request.campaign.openingAt).getTime()
      : Date.now();
    const expiresAtMs = new Date(request.campaign.expiresAt).getTime();
    const message = {
      action: "create_campaign",
      campaign: {
        campaign_id: request.campaign.id,
        creator_id: request.campaign.creatorAccountId,
        controller_id: request.campaign.creatorAccountId,
        content_hash: Buffer.from(request.campaign.contentHash, "hex").toString("base64"),
        solution_public_key: request.campaign.solutionPublicKey,
        opens_at_ms: opensAtMs,
        expires_at_ms: expiresAtMs,
        refund_account_id: request.campaign.refundAccount,
      },
      funding_reference: request.fundingReference,
      funding_deadline_ms: new Date(request.deadline).getTime(),
    };
    return {
      rail: "DIRECT_NEAR",
      origin: {
        assetId: escrow.assetId,
        amountAtomic: request.campaign.reward.amountAtomic,
      },
      principal: {
        assetId: escrow.assetId,
        amountAtomic: request.campaign.reward.amountAtomic,
      },
      routingFee: { assetId: escrow.assetId, amountAtomic: "0" },
      platformFee: { assetId: escrow.assetId, amountAtomic: "0" },
      depositAddress: campaignContractId(),
      depositMemo: JSON.stringify(message),
      deadline: request.deadline,
      providerQuoteId: request.fundingReference,
      providerStatus: "AWAITING_FT_TRANSFER_CALL",
      rawDigest: digestJson(message),
      instructions: {
        method: "ft_transfer_call",
        signerId: request.campaign.creatorAccountId,
        tokenContract: escrow.contractId,
        receiverId: campaignContractId(),
        amount: request.campaign.reward.amountAtomic,
        msg: JSON.stringify(message),
        attachedDeposit: "1",
      },
    };
  }

  async observe(): Promise<FundingObservation> {
    return {
      providerStatus: "AWAITING_CHAIN_INDEXER",
      orderStatus: "AWAITING_DEPOSIT",
      depositTxHash: null,
      settlementTxHash: null,
      fundingReference: null,
      evidence: { requiresChainReconciler: true },
    };
  }

  async finalize(): Promise<FinalizationDecision> {
    const observation = await this.observe();
    return { readyForAllocation: false, terminal: false, observation };
  }

  async reconcile(): Promise<FinalizationDecision> {
    return this.finalize();
  }
}
