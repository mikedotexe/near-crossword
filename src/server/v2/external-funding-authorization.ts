import { AppError } from "./errors";
import { EXTERNAL_FUNDING_ALLOCATION_GRACE_MS } from "./funding/external-authorization";
import type { Repository } from "./repository";
import type {
  Actor,
  FundingOrder,
  FundingOrderStatus,
  FundingQuote,
  JsonValue,
} from "./types";
import { getV2ExternalFundingAuthorization } from "./chain/view";
import type { OnChainExternalFundingAuthorization } from "./chain/types";

const LIVE_ONE_CLICK_STATUSES: FundingOrderStatus[] = [
  "QUOTED",
  "AWAITING_DEPOSIT",
  "DEPOSIT_DETECTED",
  "PROCESSING",
  "SETTLED",
  "ALLOCATING",
  "INCOMPLETE",
];

export type ExternalFundingAuthorizationReader = (
  fundingReference: string,
  contractId: string,
) => Promise<OnChainExternalFundingAuthorization | null>;

export interface VerifyExternalFundingAuthorizationOptions {
  readAuthorization?: ExternalFundingAuthorizationReader;
  now?: () => Date;
}

export interface AuthorizedFundingDepositResponse {
  fundingOrder: {
    id: string;
    campaignId: string;
    status: FundingOrderStatus;
    version: number;
  };
  authorization: {
    contractId: string;
    campaignId: string;
    fundingReference: string;
    fundingDeadlineMs: string;
    verifiedAt: string;
  };
  deposit: {
    depositAddress: string;
    depositMemo: string | null;
    originAssetId: string;
    inputAmountAtomic: string;
    deadline: string;
    providerQuoteId: string | null;
    instructions: JsonValue;
  };
}

export interface MaskedOneClickFundingOrder
  extends Omit<FundingOrder, "inputAmountAtomic" | "depositAddress" | "quote"> {
  inputAmountAtomic: null;
  depositAddress: null;
  quote: Omit<
    FundingQuote,
    "origin" | "depositAddress" | "depositMemo" | "instructions"
  > & {
    origin: {
      assetId: string;
      amountAtomic: null;
    };
    depositAddress: null;
    depositMemo: null;
    instructions: Record<string, JsonValue>;
  };
}

function evidenceRecord(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function authorizationInstructions(value: JsonValue): Record<string, JsonValue> {
  const instructions = evidenceRecord(value);
  return instructions.creatorAuthorization === undefined
    ? {}
    : { creatorAuthorization: instructions.creatorAuthorization };
}

/**
 * A 1Click quote is useful to construct the immutable creator authorization,
 * but its deposit target must not be released until that authorization is
 * independently observed at finality.
 */
export function maskFundingOrderUntilAuthorization(
  order: FundingOrder,
): MaskedOneClickFundingOrder {
  return {
    ...order,
    inputAmountAtomic: null,
    depositAddress: null,
    quote: {
      ...order.quote,
      origin: {
        assetId: order.quote.origin.assetId,
        amountAtomic: null,
      },
      depositAddress: null,
      depositMemo: null,
      instructions: authorizationInstructions(order.quote.instructions),
    },
  };
}

function expectedFundingReference(order: FundingOrder): string {
  if (
    order.providerReference &&
    order.quote.providerQuoteId &&
    order.providerReference !== order.quote.providerQuoteId
  ) {
    throw new AppError(
      409,
      "FUNDING_ORDER_INCONSISTENT",
      "Funding order provider references do not match",
    );
  }
  const reference = order.providerReference ?? order.quote.providerQuoteId;
  if (!reference) {
    throw new AppError(
      409,
      "FUNDING_REFERENCE_MISSING",
      "Funding order has no immutable provider reference to authorize",
    );
  }
  if (order.fundingReference && order.fundingReference !== reference) {
    throw new AppError(
      409,
      "FUNDING_ORDER_INCONSISTENT",
      "Settled funding reference does not match the authorized provider reference",
    );
  }
  return reference;
}

function isoMilliseconds(value: string | null, label: string): string {
  if (!value) {
    throw new AppError(
      409,
      "CAMPAIGN_INCOMPLETE",
      `${label} is required for external funding authorization`,
    );
  }
  const milliseconds = new Date(value).getTime();
  if (!Number.isSafeInteger(milliseconds)) {
    throw new AppError(
      409,
      "CAMPAIGN_INCOMPLETE",
      `${label} is not a valid timestamp`,
    );
  }
  return String(milliseconds);
}

function allocationDeadlineMilliseconds(value: string): string {
  const quoteDeadlineMs = Number(isoMilliseconds(value, "funding order deadline"));
  const allocationDeadlineMs =
    quoteDeadlineMs + EXTERNAL_FUNDING_ALLOCATION_GRACE_MS;
  if (!Number.isSafeInteger(allocationDeadlineMs)) {
    throw new AppError(
      409,
      "FUNDING_ORDER_INCONSISTENT",
      "Funding order allocation deadline is invalid",
    );
  }
  return String(allocationDeadlineMs);
}

function hexDigestToBase64(value: string | null): string {
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new AppError(
      409,
      "CAMPAIGN_INCOMPLETE",
      "Campaign content hash is not a 32-byte hexadecimal digest",
    );
  }
  return Buffer.from(value, "hex").toString("base64");
}

function canonicalBase64(value: string | null, bytes: number, label: string): string {
  if (!value) {
    throw new AppError(409, "CAMPAIGN_INCOMPLETE", `${label} is required`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== bytes || decoded.toString("base64") !== value) {
    throw new AppError(
      409,
      "CAMPAIGN_INCOMPLETE",
      `${label} must be canonical base64 for exactly ${bytes} bytes`,
    );
  }
  return value;
}

function assertAuthorizationMatches(
  authorization: OnChainExternalFundingAuthorization,
  expected: {
    campaignId: string;
    creatorAccountId: string;
    refundAccountId: string;
    contentHash: string;
    solutionPublicKey: string;
    amount: string;
    opensAtMs: string;
    expiresAtMs: string;
    fundingReference: string;
    fundingDeadlineMs: string;
  },
): void {
  const mismatches: string[] = [];
  const compare = (label: string, actual: string, wanted: string) => {
    if (actual !== wanted) mismatches.push(label);
  };
  compare("campaignId", authorization.campaignId, expected.campaignId);
  compare("creatorId", authorization.creatorId, expected.creatorAccountId);
  compare("controllerId", authorization.controllerId, expected.creatorAccountId);
  compare("sponsorId", authorization.sponsorId, expected.creatorAccountId);
  compare("refundAccountId", authorization.refundAccountId, expected.refundAccountId);
  compare("contentHash", authorization.contentHash, expected.contentHash);
  compare(
    "solutionPublicKey",
    authorization.solutionPublicKey,
    expected.solutionPublicKey,
  );
  compare("amount", authorization.amount, expected.amount);
  compare("opensAtMs", authorization.opensAtMs, expected.opensAtMs);
  compare("expiresAtMs", authorization.expiresAtMs, expected.expiresAtMs);
  compare(
    "fundingReference",
    authorization.fundingReference,
    expected.fundingReference,
  );
  compare(
    "fundingDeadlineMs",
    authorization.fundingDeadlineMs,
    expected.fundingDeadlineMs,
  );
  if (authorization.fundingRail !== "intents") mismatches.push("fundingRail");
  if (mismatches.length) {
    throw new AppError(
      409,
      "CREATOR_AUTHORIZATION_MISMATCH",
      "Final on-chain authorization does not match the immutable campaign funding order",
      { mismatches },
    );
  }
}

function verificationMetadata(
  order: FundingOrder,
): {
  verifiedAt: string | null;
  fundingReference: string | null;
  contractId: string | null;
} {
  const evidence = evidenceRecord(order.evidence);
  return {
    verifiedAt:
      typeof evidence.authorizationVerifiedAt === "string"
        ? evidence.authorizationVerifiedAt
        : null,
    fundingReference:
      typeof evidence.authorizationFundingReference === "string"
        ? evidence.authorizationFundingReference
        : null,
    contractId:
      typeof evidence.authorizationContractId === "string"
        ? evidence.authorizationContractId
        : null,
  };
}

export function hasVerifiedExternalFundingAuthorization(
  order: FundingOrder,
  contractId: string,
): boolean {
  if (order.rail !== "ONE_CLICK") return true;
  const metadata = verificationMetadata(order);
  const fundingReference =
    order.providerReference ?? order.quote.providerQuoteId;
  return Boolean(
    metadata.verifiedAt &&
      Number.isFinite(new Date(metadata.verifiedAt).getTime()) &&
      fundingReference &&
      metadata.fundingReference === fundingReference &&
      metadata.contractId === contractId,
  );
}

export function canRevealExternalFundingDeposit(
  order: FundingOrder,
  contractId: string,
  nowMs = Date.now(),
): boolean {
  const deadlineMs = new Date(order.expiresAt).getTime();
  return (
    Number.isSafeInteger(deadlineMs) &&
    deadlineMs > nowMs &&
    hasVerifiedExternalFundingAuthorization(order, contractId)
  );
}

async function persistVerification(
  repository: Repository,
  initialOrder: FundingOrder,
  fundingReference: string,
  contractId: string,
  verifiedAt: string,
): Promise<{ order: FundingOrder; verifiedAt: string }> {
  let order = initialOrder;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = verificationMetadata(order);
    if (existing.verifiedAt) {
      if (
        !Number.isFinite(new Date(existing.verifiedAt).getTime()) ||
        existing.fundingReference !== fundingReference ||
        existing.contractId !== contractId
      ) {
        throw new AppError(
          409,
          "AUTHORIZATION_EVIDENCE_CONFLICT",
          "Stored authorization evidence belongs to different immutable terms",
        );
      }
      return { order, verifiedAt: existing.verifiedAt };
    }
    if (
      order.rail !== "ONE_CLICK" ||
      !LIVE_ONE_CLICK_STATUSES.includes(order.status)
    ) {
      throw new AppError(
        409,
        "FUNDING_ORDER_NOT_LIVE",
        "Only a live 1Click funding order can reveal deposit instructions",
      );
    }
    const updated = await repository.transitionFundingOrder(
      order.id,
      [order.status],
      order.status,
      order.version,
      {
        evidence: {
          ...evidenceRecord(order.evidence),
          authorizationVerifiedAt: verifiedAt,
          authorizationFundingReference: fundingReference,
          authorizationContractId: contractId,
        },
      },
    );
    if (updated) return { order: updated, verifiedAt };
    const latest = await repository.getFundingOrder(order.id);
    if (!latest) {
      throw new AppError(
        404,
        "FUNDING_ORDER_NOT_FOUND",
        "Funding order not found",
      );
    }
    order = latest;
  }
  throw new AppError(
    409,
    "FUNDING_ORDER_VERSION_CONFLICT",
    "Funding order changed while authorization was being verified; retry safely",
  );
}

export async function verifyExternalFundingAuthorization(
  repository: Repository,
  actor: Actor,
  fundingOrderId: string,
  options: VerifyExternalFundingAuthorizationOptions = {},
): Promise<AuthorizedFundingDepositResponse> {
  const now = (options.now ?? (() => new Date()))();
  const order = await repository.getFundingOrder(fundingOrderId);
  if (!order) {
    throw new AppError(404, "FUNDING_ORDER_NOT_FOUND", "Funding order not found");
  }
  if (order.creatorId !== actor.id) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the creator can verify this funding authorization",
    );
  }
  if (
    order.rail !== "ONE_CLICK" ||
    !LIVE_ONE_CLICK_STATUSES.includes(order.status)
  ) {
    throw new AppError(
      409,
      "FUNDING_ORDER_NOT_LIVE",
      "Only a live 1Click funding order can reveal deposit instructions",
    );
  }
  const quoteDeadlineMs = new Date(order.expiresAt).getTime();
  if (
    !Number.isSafeInteger(quoteDeadlineMs) ||
    quoteDeadlineMs <= now.getTime()
  ) {
    throw new AppError(
      409,
      "FUNDING_ORDER_NOT_LIVE",
      "The 1Click funding quote has expired and its deposit instructions cannot be used",
    );
  }
  const campaign = await repository.getCampaign(order.campaignId);
  if (!campaign) {
    throw new AppError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  }
  if (campaign.creatorId !== actor.id) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the campaign creator can verify this funding authorization",
    );
  }
  if (
    !campaign.creatorAccountId ||
    !campaign.refundAccount ||
    !campaign.contractId ||
    campaign.reward.type !== "TOKEN_PRIZE" ||
    campaign.reward.amountAtomic !== order.principalAmountAtomic ||
    campaign.reward.assetId !== order.destinationAssetId
  ) {
    throw new AppError(
      409,
      "CAMPAIGN_INCOMPLETE",
      "Campaign does not match the immutable funding principal and recovery terms",
    );
  }

  const fundingReference = expectedFundingReference(order);
  const readAuthorization =
    options.readAuthorization ??
    ((reference: string, contractId: string) =>
      getV2ExternalFundingAuthorization(reference, { contractId }));
  const authorization = await readAuthorization(
    fundingReference,
    campaign.contractId,
  );
  if (!authorization) {
    throw new AppError(
      409,
      "CREATOR_AUTHORIZATION_NOT_FINAL",
      "Creator authorization is not finalized on the v2 contract yet",
    );
  }
  if (authorization.expired) {
    throw new AppError(
      409,
      "CREATOR_AUTHORIZATION_EXPIRED",
      "Creator authorization expired before its provider deposit was released",
    );
  }

  assertAuthorizationMatches(authorization, {
    campaignId: campaign.id,
    creatorAccountId: campaign.creatorAccountId,
    refundAccountId: campaign.refundAccount,
    contentHash: hexDigestToBase64(campaign.contentHash),
    solutionPublicKey: canonicalBase64(
      campaign.solutionPublicKey,
      32,
      "Campaign solution public key",
    ),
    amount: order.principalAmountAtomic,
    opensAtMs: isoMilliseconds(campaign.openingAt, "campaign.openingAt"),
    expiresAtMs: isoMilliseconds(campaign.expiresAt, "campaign.expiresAt"),
    fundingReference,
    fundingDeadlineMs: allocationDeadlineMilliseconds(order.expiresAt),
  });

  const persisted = await persistVerification(
    repository,
    order,
    fundingReference,
    campaign.contractId,
    now.toISOString(),
  );
  return {
    fundingOrder: {
      id: persisted.order.id,
      campaignId: persisted.order.campaignId,
      status: persisted.order.status,
      version: persisted.order.version,
    },
    authorization: {
      contractId: campaign.contractId,
      campaignId: campaign.id,
      fundingReference,
      fundingDeadlineMs: authorization.fundingDeadlineMs,
      verifiedAt: persisted.verifiedAt,
    },
    deposit: {
      depositAddress: persisted.order.depositAddress,
      depositMemo: persisted.order.quote.depositMemo,
      originAssetId: persisted.order.originAssetId,
      inputAmountAtomic: persisted.order.inputAmountAtomic,
      deadline: persisted.order.expiresAt,
      providerQuoteId: persisted.order.quote.providerQuoteId,
      instructions: persisted.order.quote.instructions,
    },
  };
}
