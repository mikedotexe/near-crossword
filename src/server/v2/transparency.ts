import { providers } from "near-api-js";
import { campaignContractId, escrowAsset, v2NearNetwork } from "./config";
import { AppError } from "./errors";
import type { Repository } from "./repository";
import type { Campaign, FundingOrder, JsonValue } from "./types";
import { getV2Campaign } from "./chain/view";
import type { OnChainCampaign } from "./chain/types";

type CampaignReader = (
  campaignId: string,
  contractId: string,
) => Promise<OnChainCampaign | null>;

type ViewCall = (
  accountId: string,
  methodName: string,
  args: Record<string, JsonValue>,
) => Promise<unknown>;

export interface TransparencyOptions {
  readCampaign?: CampaignReader;
  viewCall?: ViewCall;
  now?: () => Date;
}

function networkId(): "mainnet" | "testnet" {
  return v2NearNetwork();
}

function explorerBase(): string {
  return networkId() === "testnet"
    ? "https://testnet.nearblocks.io"
    : "https://nearblocks.io";
}

function addressUrl(accountId: string): string {
  return `${explorerBase()}/address/${encodeURIComponent(accountId)}`;
}

function transactionUrl(hash: string): string {
  return `${explorerBase()}/txns/${encodeURIComponent(hash)}`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(
      502,
      "INVALID_CHAIN_RESPONSE",
      `Invalid ${label} returned by the NEAR RPC`,
    );
  }
  return value as Record<string, unknown>;
}

function unsigned(value: unknown, label: string): string {
  const normalized =
    typeof value === "string"
      ? value
      : typeof value === "number" && Number.isSafeInteger(value)
        ? String(value)
        : "";
  if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)) {
    throw new AppError(
      502,
      "INVALID_CHAIN_RESPONSE",
      `Invalid ${label} returned by the NEAR RPC`,
    );
  }
  return normalized;
}

function evidenceString(order: FundingOrder, field: string): string | null {
  if (
    !order.evidence ||
    typeof order.evidence !== "object" ||
    Array.isArray(order.evidence)
  ) {
    return null;
  }
  const value = order.evidence[field];
  return typeof value === "string" && value ? value : null;
}

function contentHashBase64(value: string | null): string | null {
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) return null;
  return Buffer.from(value, "hex").toString("base64");
}

function timestampMilliseconds(value: string | null): string | null {
  if (!value) return null;
  const milliseconds = new Date(value).getTime();
  return Number.isSafeInteger(milliseconds) ? String(milliseconds) : null;
}

function expectedFundingReference(order: FundingOrder): string | null {
  return order.fundingReference ?? order.providerReference;
}

function expectedFundingRail(
  order: FundingOrder,
): OnChainCampaign["fundingRail"] | null {
  if (order.rail === "DIRECT_NEAR") return "direct_usdc";
  if (order.rail === "ONE_CLICK") return "intents";
  return null;
}

function lifecycleMatches(
  ledgerState: Campaign["status"],
  contractState: OnChainCampaign["status"]["state"],
): boolean {
  const compatible: Record<
    Campaign["status"],
    OnChainCampaign["status"]["state"][]
  > = {
    DRAFT: [],
    FUNDING: [],
    SCHEDULED: ["scheduled"],
    ACTIVE: ["active"],
    // The contract has already released a cross-chain payout while the
    // workflow ledger remains CLAIMING until the downstream receipt arrives.
    CLAIMING: ["claiming", "claimed"],
    CLAIMED: ["claimed"],
    REFUNDING: ["refunding", "refunded"],
    REFUNDED: ["refunded"],
    CANCELLED: ["refunded"],
  };
  return compatible[ledgerState].includes(contractState);
}

function contractMatchesLedger(
  campaign: Campaign,
  order: FundingOrder | null,
  onChain: OnChainCampaign,
): boolean {
  if (
    !order ||
    campaign.reward.type !== "TOKEN_PRIZE" ||
    !campaign.creatorAccountId ||
    !campaign.refundAccount ||
    !campaign.solutionPublicKey
  ) {
    return false;
  }
  const fundingReference = expectedFundingReference(order);
  const fundingRail = expectedFundingRail(order);
  return Boolean(
    fundingReference &&
      fundingRail &&
      onChain.campaignId === campaign.id &&
      campaign.chainCampaignId === onChain.campaignId &&
      onChain.creatorId === campaign.creatorAccountId &&
      onChain.controllerId === campaign.creatorAccountId &&
      onChain.sponsorId === campaign.creatorAccountId &&
      onChain.refundAccountId === campaign.refundAccount &&
      onChain.contentHash === contentHashBase64(campaign.contentHash) &&
      onChain.solutionPublicKey === campaign.solutionPublicKey &&
      onChain.amount === campaign.reward.amountAtomic &&
      onChain.opensAtMs === timestampMilliseconds(campaign.openingAt) &&
      onChain.expiresAtMs === timestampMilliseconds(campaign.expiresAt) &&
      onChain.fundingReference === fundingReference &&
      onChain.fundingRail === fundingRail &&
      lifecycleMatches(campaign.status, onChain.status.state),
  );
}

async function defaultCampaignReader(
  campaignId: string,
  contractId: string,
): Promise<OnChainCampaign | null> {
  return getV2Campaign(campaignId, { contractId });
}

function publicFundingEvidence(order: FundingOrder | null) {
  if (!order) return null;
  const allocationTxHash = evidenceString(order, "allocationTxHash");
  return {
    rail: order.rail,
    status: order.status,
    principal: {
      assetId: order.destinationAssetId,
      amountAtomic: order.principalAmountAtomic,
    },
    origin: {
      assetId: order.originAssetId,
      amountAtomic: order.inputAmountAtomic,
    },
    routingFeeAtomic: order.routingFeeAtomic,
    platformFeeAtomic: order.platformFeeAtomic,
    fundingReference: order.fundingReference,
    depositTxHash: order.depositTxHash,
    settlementTxHash: order.settlementTxHash,
    quoteDigest: evidenceString(order, "quoteDigest"),
    allocationTxHash,
    allocationExplorerUrl: allocationTxHash
      ? transactionUrl(allocationTxHash)
      : null,
    directDepositExplorerUrl:
      order.rail === "DIRECT_NEAR" && order.depositTxHash
        ? transactionUrl(order.depositTxHash)
        : null,
    fundedAndLocked: false,
  };
}

function assertPublicCampaign(campaign: Campaign): void {
  if (["DRAFT", "FUNDING"].includes(campaign.status)) {
    throw new AppError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  }
}

export async function getCampaignEvidence(
  repository: Repository,
  idOrSlug: string,
  options: TransparencyOptions = {},
) {
  const campaign = await repository.getCampaign(idOrSlug);
  if (!campaign) {
    throw new AppError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  }
  assertPublicCampaign(campaign);
  const order = await repository.getFundingOrderForCampaign(campaign.id);
  const contractId = campaign.contractId ?? campaignContractId();
  let onChain: OnChainCampaign | null;
  try {
    onChain = await (options.readCampaign ?? defaultCampaignReader)(
      campaign.id,
      contractId,
    );
  } catch {
    throw new AppError(
      503,
      "CONTRACT_VIEW_UNAVAILABLE",
      "Final on-chain campaign evidence is temporarily unavailable",
    );
  }
  const funding = publicFundingEvidence(order);
  const contractMatches =
    onChain !== null && contractMatchesLedger(campaign, order, onChain);
  const liabilityBearingState =
    onChain !== null &&
    ["scheduled", "active", "claiming", "refunding"].includes(
      onChain.status.state,
    );
  const publiclyPlayableEscrow =
    onChain !== null &&
    ["scheduled", "active"].includes(onChain.status.state);
  return {
    campaign: {
      id: campaign.id,
      slug: campaign.slug,
      status: campaign.status,
      contentHash: campaign.contentHash,
      aiGenerationReceipt: campaign.aiGenerationReceipt,
      reward:
        campaign.reward.type === "TOKEN_PRIZE"
          ? {
              assetId: campaign.reward.assetId,
              amountAtomic: campaign.reward.amountAtomic,
              symbol: campaign.reward.symbol,
              decimals: campaign.reward.decimals,
            }
          : null,
    },
    funding:
      funding === null
        ? null
        : {
            ...funding,
            fundedAndLocked:
              order?.status === "ALLOCATED" &&
              contractMatches &&
              publiclyPlayableEscrow,
            principalStillReserved:
              order?.status === "ALLOCATED" &&
              contractMatches &&
              liabilityBearingState,
          },
    contract: onChain
      ? {
          accountId: contractId,
          campaignId: onChain.campaignId,
          state: onChain.status.state,
          amountAtomic: onChain.amount,
          claimNonce: onChain.claimNonce,
          fundingReference: onChain.fundingReference,
          contentHash: onChain.contentHash,
          opensAtMs: onChain.opensAtMs,
          expiresAtMs: onChain.expiresAtMs,
          evidenceMatchesLedger: contractMatches,
          explorerUrl: addressUrl(contractId),
        }
      : {
          accountId: contractId,
          campaignId: campaign.id,
          state: null,
          amountAtomic: null,
          claimNonce: null,
          fundingReference: null,
          contentHash: null,
          opensAtMs: null,
          expiresAtMs: null,
          evidenceMatchesLedger: false,
          explorerUrl: addressUrl(contractId),
        },
  };
}

function rpcUrl(): string {
  if (process.env.V2_NEAR_RPC_URL) return process.env.V2_NEAR_RPC_URL;
  return networkId() === "testnet"
    ? "https://rpc.testnet.near.org"
    : "https://rpc.mainnet.near.org";
}

async function defaultViewCall(
  accountId: string,
  methodName: string,
  args: Record<string, JsonValue>,
): Promise<unknown> {
  const provider = new providers.JsonRpcProvider({ url: rpcUrl() });
  const response = (await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args), "utf8").toString("base64"),
  })) as unknown as { result: number[] };
  return JSON.parse(Buffer.from(response.result).toString("utf8")) as unknown;
}

function signedDifference(left: bigint, right: bigint): string {
  return (left - right).toString();
}

export async function reconcileSolvency(
  repository: Repository,
  options: TransparencyOptions = {},
) {
  const contractId = campaignContractId();
  const usdc = escrowAsset();
  const viewCall = options.viewCall ?? defaultViewCall;
  let accountingValue: unknown;
  let tokenBalanceValue: unknown;
  let ledger: Awaited<ReturnType<Repository["getLiveLiabilities"]>>;
  try {
    [accountingValue, tokenBalanceValue, ledger] = await Promise.all([
      viewCall(contractId, "get_accounting", {}),
      viewCall(usdc.contractId, "ft_balance_of", { account_id: contractId }),
      repository.getLiveLiabilities(),
    ]);
  } catch {
    throw new AppError(
      503,
      "SOLVENCY_VIEW_UNAVAILABLE",
      "Read-only solvency evidence is temporarily unavailable",
    );
  }
  const accounting = record(accountingValue, "contract accounting");
  const totalReserved = BigInt(
    unsigned(accounting.total_reserved, "accounting.total_reserved"),
  );
  const computedLiabilities = BigInt(
    unsigned(
      accounting.computed_liabilities,
      "accounting.computed_liabilities",
    ),
  );
  if (typeof accounting.invariant_holds !== "boolean") {
    throw new AppError(
      502,
      "INVALID_CHAIN_RESPONSE",
      "Invalid accounting.invariant_holds returned by the NEAR RPC",
    );
  }
  const tokenBalance = BigInt(
    unsigned(tokenBalanceValue, "escrow token balance"),
  );
  const ledgerLiabilities = BigInt(
    unsigned(ledger.amountAtomic, "workflow ledger liabilities"),
  );
  const checks = {
    contractInvariant:
      accounting.invariant_holds && totalReserved === computedLiabilities,
    tokenBalanceCoversReserved: tokenBalance >= totalReserved,
    ledgerMatchesContract: ledgerLiabilities === totalReserved,
  };
  return {
    observedAt: (options.now?.() ?? new Date()).toISOString(),
    network: networkId(),
    contract: {
      accountId: contractId,
      explorerUrl: addressUrl(contractId),
      totalReservedAtomic: totalReserved.toString(),
      computedLiabilitiesAtomic: computedLiabilities.toString(),
    },
    escrowToken: {
      contractId: usdc.contractId,
      symbol: usdc.symbol,
      decimals: usdc.decimals,
      contractBalanceAtomic: tokenBalance.toString(),
      explorerUrl: addressUrl(usdc.contractId),
    },
    workflowLedger: {
      escrowLiabilitiesAtomic: ledgerLiabilities.toString(),
      escrowCampaignCount: ledger.campaignCount,
      routingInFlightAmountAtomic: ledger.routingInFlightAmountAtomic,
      routingInFlightCampaignCount: ledger.routingInFlightCampaignCount,
      // Backward-compatible aliases now explicitly mean contract escrow only.
      liveLiabilitiesAtomic: ledgerLiabilities.toString(),
      liveCampaignCount: ledger.campaignCount,
    },
    deltas: {
      tokenBalanceMinusReservedAtomic: signedDifference(
        tokenBalance,
        totalReserved,
      ),
      contractMinusLedgerAtomic: signedDifference(
        totalReserved,
        ledgerLiabilities,
      ),
    },
    checks,
    healthy: Object.values(checks).every(Boolean),
    readOnly: true,
  };
}
