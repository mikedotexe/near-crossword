import { providers } from "near-api-js";
import { campaignContractId, v2NearNetwork } from "../config";
import type {
  OnChainCampaign,
  OnChainExternalFundingAuthorization,
  OnChainCampaignState,
  OnChainCampaignStatus,
} from "./types";

interface ContractViewProvider {
  query(params: Record<string, unknown>): Promise<{
    result: number[];
  }>;
}

export interface CampaignViewOptions {
  contractId?: string;
  rpcUrl?: string;
  provider?: ContractViewProvider;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label} returned by the v2 contract`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Invalid ${label} returned by the v2 contract`);
  }
  return value;
}

function unsigned(value: unknown, label: string): string {
  const normalized =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : "";
  if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)) {
    throw new Error(`Invalid ${label} returned by the v2 contract`);
  }
  return normalized;
}

function optionalUnsigned(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : unsigned(value, label);
}

function normalizeStatus(value: unknown): OnChainCampaignStatus {
  const source =
    typeof value === "string" ? { state: value } : record(value, "campaign status");
  const state = text(source.state, "campaign status.state").toLowerCase();
  const states: OnChainCampaignState[] = [
    "scheduled",
    "active",
    "claiming",
    "claimed",
    "refunding",
    "refunded",
  ];
  if (!states.includes(state as OnChainCampaignState)) {
    throw new Error("Unknown campaign state returned by the v2 contract");
  }

  const normalized: OnChainCampaignStatus = {
    state: state as OnChainCampaignState,
  };
  if (source.receiver_id !== undefined) {
    normalized.receiverId = text(source.receiver_id, "campaign status.receiver_id");
  }
  if (source.payout_digest !== undefined) {
    normalized.payoutDigest = text(
      source.payout_digest,
      "campaign status.payout_digest",
    );
  }
  normalized.nonce = optionalUnsigned(source.nonce, "campaign status.nonce");
  normalized.deadlineMs = optionalUnsigned(
    source.deadline_ms,
    "campaign status.deadline_ms",
  );
  normalized.claimedAtMs = optionalUnsigned(
    source.claimed_at_ms,
    "campaign status.claimed_at_ms",
  );
  if (source.refund_account_id !== undefined) {
    normalized.refundAccountId = text(
      source.refund_account_id,
      "campaign status.refund_account_id",
    );
  }
  normalized.refundAttempt = optionalUnsigned(
    source.attempt,
    "campaign status.attempt",
  );
  if (source.in_flight !== undefined) {
    if (typeof source.in_flight !== "boolean") {
      throw new Error("Invalid campaign status.in_flight returned by the v2 contract");
    }
    normalized.refundInFlight = source.in_flight;
  }
  normalized.refundedAtMs = optionalUnsigned(
    source.refunded_at_ms,
    "campaign status.refunded_at_ms",
  );
  return normalized;
}

function normalizeCampaign(value: unknown): OnChainCampaign | null {
  if (value === null) return null;
  const campaign = record(value, "campaign");
  const fundingRail = text(campaign.funding_rail, "campaign.funding_rail");
  if (!["direct_usdc", "intents", "x402"].includes(fundingRail)) {
    throw new Error("Invalid campaign.funding_rail returned by the v2 contract");
  }
  return {
    campaignId: text(campaign.campaign_id, "campaign.campaign_id"),
    creatorId: text(campaign.creator_id, "campaign.creator_id"),
    controllerId: text(campaign.controller_id, "campaign.controller_id"),
    sponsorId: text(campaign.sponsor_id, "campaign.sponsor_id"),
    contentHash: text(campaign.content_hash, "campaign.content_hash"),
    solutionPublicKey: text(
      campaign.solution_public_key,
      "campaign.solution_public_key",
    ),
    amount: unsigned(campaign.amount, "campaign.amount"),
    opensAtMs: unsigned(campaign.opens_at_ms, "campaign.opens_at_ms"),
    expiresAtMs: unsigned(campaign.expires_at_ms, "campaign.expires_at_ms"),
    refundAccountId: text(
      campaign.refund_account_id,
      "campaign.refund_account_id",
    ),
    claimNonce: unsigned(campaign.claim_nonce, "campaign.claim_nonce"),
    fundingReference: text(
      campaign.funding_reference,
      "campaign.funding_reference",
    ),
    fundingRail: fundingRail as OnChainCampaign["fundingRail"],
    status: normalizeStatus(campaign.status),
  };
}

function normalizeExternalFundingAuthorization(
  value: unknown,
): OnChainExternalFundingAuthorization | null {
  if (value === null) return null;
  const authorization = record(value, "external funding authorization");
  const fundingRail = text(
    authorization.funding_rail,
    "external funding authorization.funding_rail",
  );
  if (!["intents", "x402"].includes(fundingRail)) {
    throw new Error(
      "Invalid external funding authorization.funding_rail returned by the v2 contract",
    );
  }
  if (typeof authorization.pending !== "boolean") {
    throw new Error(
      "Invalid external funding authorization.pending returned by the v2 contract",
    );
  }
  if (typeof authorization.expired !== "boolean") {
    throw new Error(
      "Invalid external funding authorization.expired returned by the v2 contract",
    );
  }
  return {
    campaignId: text(
      authorization.campaign_id,
      "external funding authorization.campaign_id",
    ),
    creatorId: text(
      authorization.creator_id,
      "external funding authorization.creator_id",
    ),
    controllerId: text(
      authorization.controller_id,
      "external funding authorization.controller_id",
    ),
    sponsorId: text(
      authorization.sponsor_id,
      "external funding authorization.sponsor_id",
    ),
    contentHash: text(
      authorization.content_hash,
      "external funding authorization.content_hash",
    ),
    solutionPublicKey: text(
      authorization.solution_public_key,
      "external funding authorization.solution_public_key",
    ),
    amount: unsigned(
      authorization.amount,
      "external funding authorization.amount",
    ),
    opensAtMs: unsigned(
      authorization.opens_at_ms,
      "external funding authorization.opens_at_ms",
    ),
    expiresAtMs: unsigned(
      authorization.expires_at_ms,
      "external funding authorization.expires_at_ms",
    ),
    refundAccountId: text(
      authorization.refund_account_id,
      "external funding authorization.refund_account_id",
    ),
    fundingReference: text(
      authorization.funding_reference,
      "external funding authorization.funding_reference",
    ),
    fundingRail: fundingRail as OnChainExternalFundingAuthorization["fundingRail"],
    fundingDeadlineMs: unsigned(
      authorization.funding_deadline_ms,
      "external funding authorization.funding_deadline_ms",
    ),
    expired: authorization.expired,
    pending: authorization.pending,
    storageDeposit: unsigned(
      authorization.storage_deposit,
      "external funding authorization.storage_deposit",
    ),
  };
}

function defaultRpcUrl(): string {
  if (process.env.V2_NEAR_RPC_URL) return process.env.V2_NEAR_RPC_URL;
  const network = v2NearNetwork();
  return network === "testnet"
    ? "https://rpc.testnet.near.org"
    : "https://rpc.mainnet.near.org";
}

function defaultProvider(rpcUrl: string): ContractViewProvider {
  const provider = new providers.JsonRpcProvider({ url: rpcUrl });
  return {
    query: async (params) =>
      (await provider.query(params)) as unknown as { result: number[] },
  };
}

export async function getV2Campaign(
  campaignId: string,
  options: CampaignViewOptions = {},
): Promise<OnChainCampaign | null> {
  const contractId = options.contractId ?? campaignContractId();
  const provider = options.provider ?? defaultProvider(options.rpcUrl ?? defaultRpcUrl());
  const response = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: "get_campaign",
    args_base64: Buffer.from(
      JSON.stringify({ campaign_id: campaignId }),
      "utf8",
    ).toString("base64"),
  });
  const parsed = JSON.parse(Buffer.from(response.result).toString("utf8")) as unknown;
  return normalizeCampaign(parsed);
}

export async function getV2ExternalFundingAuthorization(
  fundingReference: string,
  options: CampaignViewOptions = {},
): Promise<OnChainExternalFundingAuthorization | null> {
  const contractId = options.contractId ?? campaignContractId();
  const provider = options.provider ?? defaultProvider(options.rpcUrl ?? defaultRpcUrl());
  const response = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: "get_external_funding_authorization",
    args_base64: Buffer.from(
      JSON.stringify({ funding_reference: fundingReference }),
      "utf8",
    ).toString("base64"),
  });
  const parsed = JSON.parse(Buffer.from(response.result).toString("utf8")) as unknown;
  return normalizeExternalFundingAuthorization(parsed);
}

export async function getV2CampaignClaimNonce(
  campaignId: string,
  options: CampaignViewOptions = {},
): Promise<string> {
  const campaign = await getV2Campaign(campaignId, options);
  if (!campaign) throw new Error("Campaign is not present on the v2 contract");
  if (campaign.status.state !== "active") {
    throw new Error(`Campaign is not claimable on-chain (${campaign.status.state})`);
  }
  return campaign.claimNonce;
}
