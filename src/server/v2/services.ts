import { createHash } from "node:crypto";
import { parseAiGenerationReceiptHandle } from "./ai-receipt";
import { AppError, asAppError } from "./errors";
import { campaignContractId, escrowAsset } from "./config";
import {
  augmentExternalFundingQuoteInstructions,
  EXTERNAL_FUNDING_ALLOCATION_GRACE_MS,
  fundingAdapter,
} from "./funding";
import type { FundingAdapter } from "./funding";
import type { Repository } from "./repository";
import type {
  Actor,
  Campaign,
  CampaignStatus,
  Claim,
  FundingOrder,
  FundingRail,
  IdempotencyRecord,
  JsonValue,
  Payout,
} from "./types";
import {
  assetIdValue,
  contentHashValue,
  digestJson,
  expectedVersion,
  idempotencyKey,
  jsonValue,
  nearAccountValue,
  nullableString,
  objectValue,
  optionalIsoDate,
  payoutValue,
  publicKeyValue,
  publicPuzzle,
  rewardSpec,
  slugValue,
  solutionProofValue,
  stringValue,
  uuidValue,
  validateCampaignWindow,
} from "./validation";
import { getTokenCatalog } from "./token-catalog";
import { verifyClaimProof } from "./claim-proof";
import { getV2Campaign, getV2CampaignClaimNonce } from "./chain/view";
import {
  enqueueCampaignRefund,
  enqueueFundingReconciliation,
  type RefundReason,
} from "./chain/jobs";
import type { OnChainCampaign } from "./chain/types";

const FUNDING_QUOTE_SCOPE = "FUNDING_QUOTE_V2";
const CLAIM_QUOTE_SCOPE = "CLAIM_QUOTE_V2";
const QUOTE_WINDOW_MS = 5 * 60 * 1000;
const IDEMPOTENCY_GRACE_MS = 60 * 1000;
const DIRECT_FUNDING_FINALITY_GRACE_MS = 2 * 60 * 1000;

interface QuoteServiceOptions {
  adapterForRail?: (rail: FundingRail) => FundingAdapter;
  getClaimNonce?: (campaignId: string) => Promise<string>;
  getSupportedTokens?: typeof getTokenCatalog;
  now?: () => number;
}

function quoteAdapter(
  rail: FundingRail,
  options: QuoteServiceOptions,
): FundingAdapter {
  return options.adapterForRail?.(rail) ?? fundingAdapter(rail);
}

function idempotencyResponseId(
  body: JsonValue | null,
  field: "fundingOrderId" | "claimId",
): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body[field];
  return typeof value === "string" ? value : null;
}

function throwStoredIdempotencyFailure(
  responseStatus: number | null,
  responseBody: JsonValue | null,
): never {
  const body =
    responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)
      ? responseBody
      : {};
  const error =
    body.error && typeof body.error === "object" && !Array.isArray(body.error)
      ? body.error
      : {};
  throw new AppError(
    responseStatus && responseStatus >= 400 ? responseStatus : 409,
    typeof error.code === "string" ? error.code : "QUOTE_REQUEST_FAILED",
    typeof error.message === "string"
      ? error.message
      : "The earlier quote request failed; use a new idempotency key",
  );
}

async function completeQuoteIdempotency(
  repository: Repository,
  scope: string,
  actorId: string,
  key: string,
  responseBody: JsonValue,
): Promise<void> {
  try {
    await repository.completeIdempotency(
      scope,
      actorId,
      key,
      201,
      responseBody,
    );
  } catch (error) {
    if (
      !(error instanceof AppError) ||
      error.code !== "IDEMPOTENCY_STATE_CONFLICT"
    ) {
      throw error;
    }
    const current = await repository.getIdempotency(scope, actorId, key);
    if (!current || current.state !== "COMPLETED") throw error;
  }
}

async function failQuoteIdempotency(
  repository: Repository,
  scope: string,
  actorId: string,
  key: string,
  error: unknown,
): Promise<void> {
  const appError = asAppError(error);
  try {
    await repository.failIdempotency(
      scope,
      actorId,
      key,
      appError.status,
      {
        error: {
          code: appError.code,
          message:
            appError.status >= 500
              ? "Quote provider was unavailable"
              : appError.message,
        },
      },
    );
  } catch (finishError) {
    if (
      !(finishError instanceof AppError) ||
      finishError.code !== "IDEMPOTENCY_STATE_CONFLICT"
    ) {
      throw finishError;
    }
  }
}

function campaignQuoteIdentity(campaign: Campaign): JsonValue {
  return {
    id: campaign.id,
    creatorId: campaign.creatorId,
    creatorAccountId: campaign.creatorAccountId,
    contentHash: campaign.contentHash,
    solutionPublicKey: campaign.solutionPublicKey,
    reward: jsonValue(campaign.reward),
    contractId: campaign.contractId,
    openingAt: campaign.openingAt,
    expiresAt: campaign.expiresAt,
    refundAccount: campaign.refundAccount,
  };
}

function fundingQuoteRequestHash(
  campaign: Campaign,
  rail: FundingRail,
  originAssetId: string,
  refundTo: string,
): string {
  return digestJson({
    version: "crossword-funding-quote:v2",
    campaign: campaignQuoteIdentity(campaign),
    rail,
    originAssetId,
    refundTo,
    principal: jsonValue(campaign.reward),
  });
}

function claimQuoteRequestHash(campaign: Campaign, payout: Payout): string {
  return digestJson({
    version: "crossword-claim-quote:v2",
    campaign: campaignQuoteIdentity(campaign),
    payout,
  });
}

function assertQuoteDeadline(
  providerDeadline: string,
  requestedDeadline: string,
): void {
  const providerMs = new Date(providerDeadline).getTime();
  const requestedMs = new Date(requestedDeadline).getTime();
  if (!Number.isFinite(providerMs) || providerMs > requestedMs) {
    throw new AppError(
      502,
      "INVALID_PROVIDER_QUOTE",
      "Quote deadline exceeds the idempotency reservation window",
    );
  }
}

function slugify(title: string, id: string): string {
  const prefix = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
  return `${prefix || "campaign"}-${id.slice(0, 8)}`;
}

function visibility(value: unknown): "PUBLIC" | "UNLISTED" {
  const normalized = String(value ?? "PUBLIC").toUpperCase();
  if (normalized !== "PUBLIC" && normalized !== "UNLISTED") {
    throw new AppError(400, "INVALID_VISIBILITY", "visibility must be public or unlisted");
  }
  return normalized;
}

function sponsorUrl(value: unknown): string | null {
  const raw = nullableString(value, "sponsorUrl", 500);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, "INVALID_URL", "sponsorUrl is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new AppError(400, "INVALID_URL", "sponsorUrl must be a public HTTPS URL");
  }
  return url.toString();
}

function durationWindow(
  body: Record<string, unknown>,
): { openingAt: string | null; expiresAt: string } {
  const now = Date.now();
  const openingAt =
    optionalIsoDate(body.openingAt ?? body.opensAt, "openingAt") ??
    new Date(now).toISOString();
  let expiresAt = optionalIsoDate(body.expiresAt, "expiresAt");
  if (!expiresAt) {
    const rawHours = body.durationHours ?? 168;
    if (
      typeof rawHours !== "number" ||
      !Number.isInteger(rawHours) ||
      rawHours < 1 ||
      rawHours > 720
    ) {
      throw new AppError(400, "INVALID_DURATION", "durationHours must be 1-720");
    }
    const start = new Date(openingAt).getTime();
    expiresAt = new Date(start + rawHours * 60 * 60 * 1000).toISOString();
  }
  validateCampaignWindow(openingAt, expiresAt, now);
  return { openingAt, expiresAt };
}

function enforcePinnedReward(reward: Campaign["reward"]): void {
  if (reward.type !== "TOKEN_PRIZE") {
    throw new AppError(400, "UNSUPPORTED_REWARD", "Only token prizes are enabled");
  }
  const pinned = escrowAsset();
  if (
    reward.assetId !== pinned.assetId ||
    reward.symbol !== pinned.symbol ||
    reward.decimals !== pinned.decimals
  ) {
    throw new AppError(
      400,
      "INVALID_ESCROW_ASSET",
      "Reward must use this deployment's pinned USDC escrow asset",
      { escrowAsset: pinned },
    );
  }
  const betaCap = 100n * 10n ** BigInt(pinned.decimals);
  if (BigInt(reward.amountAtomic) > betaCap) {
    throw new AppError(
      400,
      "BETA_REWARD_CAP",
      "Unaudited beta campaigns are capped at 100 USDC",
    );
  }
}

export async function createCampaign(
  repository: Repository,
  actor: Actor,
  raw: unknown,
): Promise<Campaign> {
  const body = objectValue(raw);
  const id = uuidValue(body.id);
  const title = stringValue(body.title, "title", { min: 3, max: 160 })!;
  const puzzle = publicPuzzle(body.puzzle);
  const reward = rewardSpec(body.reward);
  enforcePinnedReward(reward);
  const window = durationWindow(body);
  const solutionPublicKey = publicKeyValue(body.solutionPublicKey);
  const aiReceiptHandle =
    body.aiReceiptHandle === undefined || body.aiReceiptHandle === null
      ? null
      : parseAiGenerationReceiptHandle(body.aiReceiptHandle);
  const slug = body.slug ? slugValue(body.slug) : slugify(title, id);
  const hash = digestJson({
    version: "crossword-campaign-content:v1",
    id,
    title,
    puzzle,
    solutionPublicKey,
  });
  if (
    body.contentHash !== undefined &&
    contentHashValue(body.contentHash) !== hash
  ) {
    throw new AppError(
      400,
      "CONTENT_HASH_MISMATCH",
      "contentHash does not match the canonical campaign content",
    );
  }
  const campaign = await repository.createCampaign(
    {
      id,
      slug,
      creatorId: actor.id,
      creatorAccountId:
        body.creatorAccountId === undefined
          ? null
          : nearAccountValue(body.creatorAccountId, "creatorAccountId"),
      title,
      description:
        nullableString(body.description, "description", 2_000) ?? null,
      sponsorName:
        nullableString(body.sponsorName, "sponsorName", 120) ?? null,
      sponsorUrl: sponsorUrl(body.sponsorUrl),
      visibility: visibility(body.visibility),
      status: "DRAFT",
      puzzle,
      contentHash: hash,
      solutionPublicKey,
      reward,
      contractId: campaignContractId(),
      openingAt: window.openingAt,
      expiresAt: window.expiresAt,
      refundAccount:
        body.refundAccount === undefined
          ? null
          : nearAccountValue(body.refundAccount, "refundAccount"),
      fundingReference: null,
      chainCampaignId: null,
    },
    aiReceiptHandle,
  );
  await repository.appendEvent({
    aggregateType: "CAMPAIGN",
    aggregateId: campaign.id,
    eventType: "CAMPAIGN_CREATED",
    actorId: actor.id,
    fromState: null,
    toState: "DRAFT",
    idempotencyKey: null,
    evidence: {
      contentHash: campaign.contentHash,
      aiGenerationReceipt: campaign.aiGenerationReceipt
        ? jsonValue(campaign.aiGenerationReceipt)
        : null,
    },
  });
  return campaign;
}

export async function patchCampaign(
  repository: Repository,
  actor: Actor,
  id: string,
  raw: unknown,
): Promise<Campaign> {
  const body = objectValue(raw);
  const version = expectedVersion(body.expectedVersion);
  const existing = await requireCampaign(repository, id);
  if (existing.creatorId !== actor.id) {
    throw new AppError(403, "FORBIDDEN", "Only the creator can edit this campaign");
  }
  if (existing.status !== "DRAFT") {
    throw new AppError(409, "CAMPAIGN_FROZEN", "Funded campaigns are immutable");
  }
  const patch: Parameters<Repository["updateCampaignDraft"]>[3] = {};
  if (body.slug !== undefined) patch.slug = slugValue(body.slug);
  if (body.creatorAccountId !== undefined) {
    patch.creatorAccountId = nearAccountValue(
      body.creatorAccountId,
      "creatorAccountId",
    );
  }
  if (body.title !== undefined) {
    patch.title = stringValue(body.title, "title", { min: 3, max: 160 })!;
  }
  if (body.description !== undefined) {
    patch.description = nullableString(body.description, "description", 2_000) ?? null;
  }
  if (body.sponsorName !== undefined) {
    patch.sponsorName = nullableString(body.sponsorName, "sponsorName", 120) ?? null;
  }
  if (body.sponsorUrl !== undefined) patch.sponsorUrl = sponsorUrl(body.sponsorUrl);
  if (body.visibility !== undefined) patch.visibility = visibility(body.visibility);
  if (body.reward !== undefined) {
    patch.reward = rewardSpec(body.reward);
    enforcePinnedReward(patch.reward);
  }
  if (body.puzzle !== undefined) {
    if (body.solutionPublicKey === undefined) {
      throw new AppError(
        400,
        "SOLUTION_KEY_REQUIRED",
        "Changing the puzzle requires a matching solutionPublicKey",
      );
    }
    patch.puzzle = publicPuzzle(body.puzzle);
    patch.solutionPublicKey = publicKeyValue(body.solutionPublicKey);
  } else if (body.solutionPublicKey !== undefined) {
    patch.solutionPublicKey = publicKeyValue(body.solutionPublicKey);
  }
  if (
    body.openingAt !== undefined ||
    body.opensAt !== undefined ||
    body.expiresAt !== undefined ||
    body.durationHours !== undefined
  ) {
    const window = durationWindow({
      openingAt: body.openingAt ?? body.opensAt ?? existing.openingAt,
      expiresAt: body.expiresAt,
      durationHours: body.durationHours,
    });
    patch.openingAt = window.openingAt;
    patch.expiresAt = window.expiresAt;
  }
  if (body.refundAccount !== undefined) {
    patch.refundAccount = nearAccountValue(body.refundAccount, "refundAccount");
  }
  if (
    patch.puzzle ||
    patch.solutionPublicKey ||
    patch.title ||
    body.contentHash !== undefined
  ) {
    const canonicalHash = digestJson({
      version: "crossword-campaign-content:v1",
      id: existing.id,
      title: patch.title ?? existing.title,
      puzzle: patch.puzzle ?? existing.puzzle,
      solutionPublicKey:
        patch.solutionPublicKey ?? existing.solutionPublicKey,
    });
    if (
      body.contentHash !== undefined &&
      contentHashValue(body.contentHash) !== canonicalHash
    ) {
      throw new AppError(
        400,
        "CONTENT_HASH_MISMATCH",
        "contentHash does not match the canonical campaign content",
      );
    }
    patch.contentHash = canonicalHash;
  }
  const updated = await repository.updateCampaignDraft(
    existing.id,
    actor.id,
    version,
    patch,
  );
  if (!updated) {
    throw new AppError(
      409,
      "CAMPAIGN_VERSION_CONFLICT",
      "Campaign changed or is no longer editable",
    );
  }
  await repository.appendEvent({
    aggregateType: "CAMPAIGN",
    aggregateId: updated.id,
    eventType: "CAMPAIGN_UPDATED",
    actorId: actor.id,
    fromState: "DRAFT",
    toState: "DRAFT",
    idempotencyKey: null,
    evidence: { version: updated.version },
  });
  return updated;
}

export async function requireCampaign(
  repository: Repository,
  idOrSlug: string,
): Promise<Campaign> {
  const campaign = await repository.getCampaign(idOrSlug);
  if (!campaign) throw new AppError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  return campaign;
}

function railValue(value: unknown): FundingRail {
  const normalized = String(value ?? "ONE_CLICK").toUpperCase();
  if (normalized === "DIRECT" || normalized === "DIRECT_NEAR") return "DIRECT_NEAR";
  if (normalized === "INTENTS" || normalized === "ONE_CLICK") return "ONE_CLICK";
  if (normalized === "MOCK") return "MOCK";
  throw new AppError(400, "INVALID_RAIL", "rail must be direct or intents");
}

function evidenceRequestHash(evidence: JsonValue): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return null;
  }
  return typeof evidence.requestHash === "string" ? evidence.requestHash : null;
}

async function appendFundingQuoteEvent(
  repository: Repository,
  order: FundingOrder,
  actorId: string,
): Promise<void> {
  await repository.appendEvent({
    aggregateType: "FUNDING_ORDER",
    aggregateId: order.id,
    eventType: "FUNDING_QUOTED",
    actorId,
    fromState: null,
    toState: "AWAITING_DEPOSIT",
    idempotencyKey: order.idempotencyKey,
    evidence: {
      campaignId: order.campaignId,
      principalAmountAtomic: order.principalAmountAtomic,
      inputAmountAtomic: order.inputAmountAtomic,
      routingFeeAtomic: order.routingFeeAtomic,
      platformFeeAtomic: order.platformFeeAtomic,
    },
  });
}

async function reviveFundingReconciliationAfterReplay(
  repository: Repository,
  order: FundingOrder,
): Promise<void> {
  const job = await enqueueFundingReconciliation(repository, order);
  if (job.status !== "DEAD") return;
  await repository.enqueueJob({
    type: job.type,
    aggregateType: job.aggregateType,
    aggregateId: job.aggregateId,
    deduplicationKey: job.deduplicationKey,
    payload: job.payload,
    maxAttempts: job.maxAttempts,
    runAfter: new Date().toISOString(),
    reactivateDead: true,
  });
}

async function recoverFundingQuote(
  repository: Repository,
  campaign: Campaign,
  actorId: string,
  key: string,
  requestHash: string,
  requestedRail: FundingRail,
  originAssetId: string,
  refundTo: string,
  reservation: IdempotencyRecord,
  reservationCreated: boolean,
): Promise<FundingOrder | null> {
  if (reservation.requestHash !== requestHash) {
    throw new AppError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency key was already used for a different funding request",
    );
  }
  let order = await repository.getFundingOrderByIdempotency(actorId, key);
  if (!order && reservation.state === "COMPLETED") {
    const orderId = idempotencyResponseId(
      reservation.responseBody,
      "fundingOrderId",
    );
    order = orderId ? await repository.getFundingOrder(orderId) : null;
  }
  if (order) {
    const storedHash = evidenceRequestHash(order.evidence);
    const legacyMatches =
      order.campaignId === campaign.id &&
      order.originAssetId === originAssetId &&
      order.refundTo === refundTo &&
      (order.rail === requestedRail || order.rail === "MOCK");
    if ((storedHash && storedHash !== requestHash) || (!storedHash && !legacyMatches)) {
      throw new AppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency key was already used for a different funding request",
      );
    }
    if (
      campaign.status === "DRAFT" &&
      !["FAILED", "REFUNDED", "EXPIRED"].includes(order.status)
    ) {
      const frozen = await repository.transitionCampaign(
        campaign.id,
        ["DRAFT"],
        "FUNDING",
        campaign.version,
      );
      if (!frozen) {
        const latest = await repository.getCampaign(campaign.id);
        if (!latest || latest.status !== "FUNDING") {
          throw new AppError(
            409,
            "CAMPAIGN_VERSION_CONFLICT",
            "Campaign changed while its funding quote was recovered",
          );
        }
      }
    }
    if (reservation.state === "FAILED") {
      throwStoredIdempotencyFailure(
        reservation.responseStatus,
        reservation.responseBody,
      );
    }
    if (reservation.state === "PROCESSING") {
      await completeQuoteIdempotency(
        repository,
        FUNDING_QUOTE_SCOPE,
        actorId,
        key,
        { fundingOrderId: order.id },
      );
    }
    await appendFundingQuoteEvent(repository, order, actorId);
    await reviveFundingReconciliationAfterReplay(repository, order);
    return order;
  }
  if (reservation.state === "FAILED") {
    throwStoredIdempotencyFailure(
      reservation.responseStatus,
      reservation.responseBody,
    );
  }
  if (reservation.state === "COMPLETED") {
    throw new AppError(
      503,
      "IDEMPOTENCY_RESULT_UNAVAILABLE",
      "The durable funding quote result could not be loaded",
    );
  }
  if (!reservationCreated) {
    throw new AppError(
      409,
      "QUOTE_IN_PROGRESS",
      "This funding quote is already being created",
      { retryAfter: reservation.expiresAt },
    );
  }
  return null;
}

export async function createFundingQuote(
  repository: Repository,
  actor: Actor,
  campaignId: string,
  raw: unknown,
  options: QuoteServiceOptions = {},
): Promise<FundingOrder> {
  const body = objectValue(raw);
  const campaign = await requireCampaign(repository, campaignId);
  if (campaign.creatorId !== actor.id) {
    throw new AppError(403, "FORBIDDEN", "Only the creator can fund this campaign");
  }
  if (!campaign.contentHash || !campaign.solutionPublicKey || !campaign.expiresAt) {
    throw new AppError(409, "CAMPAIGN_INCOMPLETE", "Campaign must be complete before funding");
  }
  if (!campaign.creatorAccountId || !campaign.refundAccount) {
    throw new AppError(
      409,
      "RECOVERY_ACCOUNTS_REQUIRED",
      "A creatorAccountId and refundAccount are required before funding",
    );
  }
  const rail = railValue(body.rail);
  const originAssetId = assetIdValue(
    body.originAssetId ?? body.originAsset,
    "originAssetId",
  );
  const refundTo = stringValue(body.refundTo, "refundTo", { min: 2, max: 256 })!;
  if (
    rail === "DIRECT_NEAR" &&
    nearAccountValue(refundTo, "refundTo") !== campaign.refundAccount
  ) {
    throw new AppError(
      400,
      "REFUND_ACCOUNT_MISMATCH",
      "Direct funding must use the campaign's locked refund account",
    );
  }
  if (
    rail === "ONE_CLICK" &&
    campaign.creatorAccountId !== campaign.refundAccount
  ) {
    throw new AppError(
      409,
      "EXTERNAL_AUTHORIZATION_ACCOUNT_MISMATCH",
      "Cross-chain funding requires the creator and NEAR recovery account to be the same wallet-controlled account",
    );
  }
  const key = idempotencyKey(
    body.idempotencyKey ?? body.paymentIdentifier ?? body.requestId,
  );
  const requestHash = fundingQuoteRequestHash(
    campaign,
    rail,
    originAssetId,
    refundTo,
  );
  const nowMs = options.now?.() ?? Date.now();
  const deadline = new Date(nowMs + QUOTE_WINDOW_MS).toISOString();
  const campaignExpiryMs = new Date(campaign.expiresAt).getTime();
  const postQuoteBuffer =
    rail === "DIRECT_NEAR"
      ? DIRECT_FUNDING_FINALITY_GRACE_MS
      : EXTERNAL_FUNDING_ALLOCATION_GRACE_MS;
  if (campaignExpiryMs <= new Date(deadline).getTime() + postQuoteBuffer) {
    throw new AppError(
      409,
      "CAMPAIGN_TOO_CLOSE_TO_EXPIRY",
      "Start a new campaign window before requesting this funding route; the current campaign is too close to expiry",
    );
  }
  const reservationExpiresAt = new Date(
    nowMs + QUOTE_WINDOW_MS + IDEMPOTENCY_GRACE_MS,
  ).toISOString();

  const priorReservation = await repository.getIdempotency(
    FUNDING_QUOTE_SCOPE,
    actor.id,
    key,
  );
  if (priorReservation) {
    return (await recoverFundingQuote(
      repository,
      campaign,
      actor.id,
      key,
      requestHash,
      rail,
      originAssetId,
      refundTo,
      priorReservation,
      false,
    ))!;
  }
  const priorOrder = await repository.getFundingOrderByIdempotency(actor.id, key);
  if (priorOrder) {
    const recoveredReservation = await repository.reserveIdempotency(
      FUNDING_QUOTE_SCOPE,
      actor.id,
      key,
      requestHash,
      reservationExpiresAt,
    );
    return (await recoverFundingQuote(
      repository,
      campaign,
      actor.id,
      key,
      requestHash,
      rail,
      originAssetId,
      refundTo,
      recoveredReservation.record,
      recoveredReservation.created,
    ))!;
  }
  if (!["DRAFT", "FUNDING"].includes(campaign.status)) {
    throw new AppError(409, "CAMPAIGN_NOT_FUNDABLE", "Campaign is not awaiting funding");
  }
  if (campaign.status === "FUNDING") {
    const open = await repository.getFundingOrderForCampaign(campaign.id);
    if (open && !["FAILED", "REFUNDED", "EXPIRED"].includes(open.status)) {
      throw new AppError(
        409,
        "FUNDING_ORDER_EXISTS",
        "Campaign already has an open funding order",
        { fundingOrderId: open.id },
      );
    }
  }
  const reservation = await repository.reserveIdempotency(
    FUNDING_QUOTE_SCOPE,
    actor.id,
    key,
    requestHash,
    reservationExpiresAt,
  );
  const replay = await recoverFundingQuote(
    repository,
    campaign,
    actor.id,
    key,
    requestHash,
    rail,
    originAssetId,
    refundTo,
    reservation.record,
    reservation.created,
  );
  if (replay) return replay;

  try {
    let quote = await quoteAdapter(rail, options).quote({
      kind: "FUND_CAMPAIGN",
      campaign,
      originAssetId,
      refundTo,
      fundingReference: `campaign:${campaign.id}:${key}`,
      deadline,
    });
    assertQuoteDeadline(quote.deadline, deadline);
    if (
      campaign.reward.type !== "TOKEN_PRIZE" ||
      quote.origin.assetId !== originAssetId ||
      quote.principal.assetId !== campaign.reward.assetId ||
      quote.principal.amountAtomic !== campaign.reward.amountAtomic
    ) {
      throw new AppError(
        502,
        "INVALID_PROVIDER_QUOTE",
        "Funding quote does not deliver the complete escrow principal",
      );
    }
    if (quote.rail === "ONE_CLICK") {
      quote = augmentExternalFundingQuoteInstructions(campaign, quote);
    }
    const input = {
      campaignId: campaign.id,
      creatorId: actor.id,
      rail: quote.rail,
      status: "AWAITING_DEPOSIT" as const,
      idempotencyKey: key,
      originAssetId: quote.origin.assetId,
      destinationAssetId: quote.principal.assetId,
      principalAmountAtomic: quote.principal.amountAtomic,
      inputAmountAtomic: quote.origin.amountAtomic,
      routingFeeAtomic: quote.routingFee.amountAtomic,
      platformFeeAtomic: quote.platformFee.amountAtomic,
      refundTo,
      quote,
      providerReference: quote.providerQuoteId,
      depositAddress: quote.depositAddress,
      depositTxHash: null,
      settlementTxHash: null,
      fundingReference: null,
      evidence: { quoteDigest: quote.rawDigest, requestHash },
      expiresAt: quote.deadline,
    };
    const result =
      campaign.status === "DRAFT"
        ? await repository.createFundingOrderAndFreezeCampaign(
            input,
            campaign.version,
          )
        : {
            ...(await repository.createFundingOrderIdempotent(input)),
            campaign,
          };
    if (!result) {
      throw new AppError(
        409,
        "CAMPAIGN_VERSION_CONFLICT",
        "Campaign changed while its funding quote was created",
      );
    }
    const storedHash = evidenceRequestHash(result.fundingOrder.evidence);
    if (
      result.fundingOrder.campaignId !== campaign.id ||
      (storedHash !== null && storedHash !== requestHash)
    ) {
      throw new AppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency key was already used for a different funding request",
      );
    }
    await appendFundingQuoteEvent(repository, result.fundingOrder, actor.id);
    await enqueueFundingReconciliation(repository, result.fundingOrder);
    await completeQuoteIdempotency(
      repository,
      FUNDING_QUOTE_SCOPE,
      actor.id,
      key,
      { fundingOrderId: result.fundingOrder.id },
    );
    return result.fundingOrder;
  } catch (error) {
    const durableOrder = await repository.getFundingOrderByIdempotency(
      actor.id,
      key,
    );
    if (!durableOrder) {
      await failQuoteIdempotency(
        repository,
        FUNDING_QUOTE_SCOPE,
        actor.id,
        key,
        error,
      );
    }
    throw error;
  }
}

async function ensureAllocationJob(
  repository: Repository,
  order: FundingOrder,
): Promise<void> {
  if (order.status !== "SETTLED") return;
  await repository.enqueueJob({
    type: "ALLOCATE_EXTERNAL_FUNDING",
    aggregateType: "FUNDING_ORDER",
    aggregateId: order.id,
    deduplicationKey: `allocate:${order.id}`,
    payload: {
      fundingOrderId: order.id,
      campaignId: order.campaignId,
      expectedAmountAtomic: order.principalAmountAtomic,
    },
    maxAttempts: 8,
    runAfter: new Date().toISOString(),
    reactivateDead: true,
  });
}

export async function refreshFundingOrder(
  repository: Repository,
  actor: Actor,
  id: string,
): Promise<FundingOrder> {
  const order = await repository.getFundingOrder(id);
  if (!order) throw new AppError(404, "FUNDING_ORDER_NOT_FOUND", "Funding order not found");
  if (order.creatorId !== actor.id) {
    throw new AppError(403, "FORBIDDEN", "Only the creator can inspect this funding order");
  }
  if (order.status === "SETTLED") {
    await ensureAllocationJob(repository, order);
    return order;
  }
  if (
    order.status === "EXPIRED" &&
    order.rail === "DIRECT_NEAR"
  ) {
    await enqueueFundingReconciliation(repository, order, new Date().toISOString(), {
      reactivateDead: true,
    });
    return order;
  }
  if (["ALLOCATED", "REFUNDED", "FAILED", "EXPIRED"].includes(order.status)) return order;
  const decision = await fundingAdapter(order.rail).reconcile(order);
  if (
    order.rail !== "ONE_CLICK" &&
    new Date(order.expiresAt).getTime() +
      DIRECT_FUNDING_FINALITY_GRACE_MS <=
      Date.now() &&
    order.status === "AWAITING_DEPOSIT" &&
    decision.observation.orderStatus === "AWAITING_DEPOSIT"
  ) {
    return (
      (await repository.transitionFundingOrder(
        order.id,
        ["AWAITING_DEPOSIT"],
        "EXPIRED",
        order.version,
      )) ?? order
    );
  }
  if (decision.observation.orderStatus === order.status) {
    await ensureAllocationJob(repository, order);
    return order;
  }
  const updated = await repository.transitionFundingOrder(
    order.id,
    [
      "AWAITING_DEPOSIT",
      "DEPOSIT_DETECTED",
      "PROCESSING",
      "ALLOCATING",
      "INCOMPLETE",
      "SETTLED",
    ],
    decision.observation.orderStatus,
    order.version,
    {
      depositTxHash: decision.observation.depositTxHash,
      settlementTxHash: decision.observation.settlementTxHash,
      fundingReference: decision.observation.fundingReference,
      evidence: jsonValue(decision.observation.evidence),
    },
  );
  if (!updated) {
    throw new AppError(409, "FUNDING_STATE_CONFLICT", "Funding order changed");
  }
  await repository.appendEvent({
    aggregateType: "FUNDING_ORDER",
    aggregateId: updated.id,
    eventType: "FUNDING_STATUS_OBSERVED",
    actorId: actor.id,
    fromState: order.status,
    toState: updated.status,
    idempotencyKey: order.idempotencyKey,
    evidence: jsonValue(decision.observation.evidence),
  });
  await ensureAllocationJob(repository, updated);
  return updated;
}

function payoutDigest(payout: Payout, quoteDigest: string | null): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        version: "crossword-campaign-payout:v1",
        kind: payout.kind,
        destinationAsset: payout.destinationAsset,
        recipient: payout.recipient,
        recoveryAccount: payout.recoveryAccount,
        quoteDigest,
      }),
    )
    .digest();
  return digest.toString("base64");
}

function normalizePayout(raw: unknown): Payout {
  const candidate = objectValue(raw, "payout");
  const kind = String(candidate.kind ?? "").toUpperCase();
  const pinned = escrowAsset();
  if (kind === "DIRECT_NEAR") {
    const payout = payoutValue({
      ...candidate,
      kind: "DIRECT_NEAR",
      destinationAsset: pinned.assetId,
    });
    return {
      ...payout,
      recipient: nearAccountValue(payout.recipient, "payout.recipient"),
    };
  }
  if (kind === "ONE_CLICK") return payoutValue({ ...candidate, kind: "ONE_CLICK" });
  throw new AppError(400, "INVALID_PAYOUT", "payout.kind is unsupported");
}

export interface ClaimQuoteView {
  claim: Claim;
  payoutDigest: string;
  nonce: string;
  deadlineMs: string;
  receiverId: string;
  escrowPrincipalAmount: string;
  estimatedDeliveryAmount: string;
  estimatedDeliveryAsset: string;
}

function claimQuoteView(claim: Claim, campaign: Campaign): ClaimQuoteView {
  const evidence = objectValue(claim.evidence, "claim.evidence");
  if (campaign.reward.type !== "TOKEN_PRIZE") {
    throw new AppError(409, "UNSUPPORTED_REWARD", "Campaign reward is not claimable");
  }
  return {
    claim,
    payoutDigest: String(evidence.payoutDigest),
    receiverId: String(evidence.receiverId),
    nonce: String(evidence.nonce),
    deadlineMs: String(evidence.deadlineMs),
    escrowPrincipalAmount: campaign.reward.amountAtomic,
    estimatedDeliveryAmount:
      claim.payoutQuote?.estimatedDelivery?.amountAtomic ??
      campaign.reward.amountAtomic,
    estimatedDeliveryAsset:
      claim.payoutQuote?.estimatedDelivery?.assetId ??
      campaign.reward.assetId,
  };
}

async function appendClaimQuoteEvent(
  repository: Repository,
  claim: Claim,
): Promise<void> {
  await repository.appendEvent({
    aggregateType: "CLAIM",
    aggregateId: claim.id,
    eventType: "CLAIM_QUOTED",
    actorId: claim.claimantId,
    fromState: null,
    toState: "AWAITING_PROOF",
    idempotencyKey: claim.idempotencyKey,
    evidence: { campaignId: claim.campaignId, payoutKind: claim.payout.kind },
  });
}

async function recoverClaimQuote(
  repository: Repository,
  campaign: Campaign,
  claimantId: string,
  key: string,
  requestHash: string,
  payout: Payout,
  reservation: IdempotencyRecord,
  reservationCreated: boolean,
): Promise<ClaimQuoteView | null> {
  if (reservation.requestHash !== requestHash) {
    throw new AppError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency key was already used for a different claim quote",
    );
  }
  let claim = await repository.getClaimByIdempotency(claimantId, key);
  if (!claim && reservation.state === "COMPLETED") {
    const claimId = idempotencyResponseId(reservation.responseBody, "claimId");
    claim = claimId ? await repository.getClaim(claimId) : null;
  }
  if (claim) {
    const storedHash = evidenceRequestHash(claim.evidence);
    const legacyMatches =
      claim.campaignId === campaign.id &&
      digestJson(claim.payout) === digestJson(payout);
    if ((storedHash && storedHash !== requestHash) || (!storedHash && !legacyMatches)) {
      throw new AppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency key was already used for a different claim quote",
      );
    }
    if (reservation.state === "FAILED") {
      throwStoredIdempotencyFailure(
        reservation.responseStatus,
        reservation.responseBody,
      );
    }
    if (reservation.state === "PROCESSING") {
      await completeQuoteIdempotency(
        repository,
        CLAIM_QUOTE_SCOPE,
        claimantId,
        key,
        { claimId: claim.id },
      );
    }
    await appendClaimQuoteEvent(repository, claim);
    return claimQuoteView(claim, campaign);
  }
  if (reservation.state === "FAILED") {
    throwStoredIdempotencyFailure(
      reservation.responseStatus,
      reservation.responseBody,
    );
  }
  if (reservation.state === "COMPLETED") {
    throw new AppError(
      503,
      "IDEMPOTENCY_RESULT_UNAVAILABLE",
      "The durable claim quote result could not be loaded",
    );
  }
  if (!reservationCreated) {
    throw new AppError(
      409,
      "QUOTE_IN_PROGRESS",
      "This claim quote is already being created",
      { retryAfter: reservation.expiresAt },
    );
  }
  return null;
}

export async function createClaimQuote(
  repository: Repository,
  claimantId: string,
  campaignId: string,
  raw: unknown,
  options: QuoteServiceOptions = {},
): Promise<ClaimQuoteView> {
  const body = objectValue(raw);
  const campaign = await requireCampaign(repository, campaignId);
  if (campaign.reward.type !== "TOKEN_PRIZE") {
    throw new AppError(409, "UNSUPPORTED_REWARD", "Campaign reward is not claimable");
  }
  const payout = normalizePayout(body.payout);
  const key = idempotencyKey(body.idempotencyKey);
  const requestHash = claimQuoteRequestHash(campaign, payout);
  const nowMs = options.now?.() ?? Date.now();
  const campaignExpiryMs = campaign.expiresAt
    ? new Date(campaign.expiresAt).getTime()
    : nowMs;
  const deadlineMs = Math.min(campaignExpiryMs, nowMs + QUOTE_WINDOW_MS);
  const deadline = new Date(
    deadlineMs,
  ).toISOString();
  const reservationExpiresAt = new Date(
    Math.max(nowMs + IDEMPOTENCY_GRACE_MS, deadlineMs + IDEMPOTENCY_GRACE_MS),
  ).toISOString();

  const priorReservation = await repository.getIdempotency(
    CLAIM_QUOTE_SCOPE,
    claimantId,
    key,
  );
  if (priorReservation) {
    return (await recoverClaimQuote(
      repository,
      campaign,
      claimantId,
      key,
      requestHash,
      payout,
      priorReservation,
      false,
    ))!;
  }
  const priorClaim = await repository.getClaimByIdempotency(claimantId, key);
  if (priorClaim) {
    const recoveredReservation = await repository.reserveIdempotency(
      CLAIM_QUOTE_SCOPE,
      claimantId,
      key,
      requestHash,
      reservationExpiresAt,
    );
    return (await recoverClaimQuote(
      repository,
      campaign,
      claimantId,
      key,
      requestHash,
      payout,
      recoveredReservation.record,
      recoveredReservation.created,
    ))!;
  }
  if (campaign.status !== "ACTIVE") {
    throw new AppError(409, "CAMPAIGN_NOT_ACTIVE", "Campaign is not accepting claims");
  }
  if (!campaign.expiresAt || campaignExpiryMs <= nowMs) {
    throw new AppError(409, "CAMPAIGN_EXPIRED", "Campaign has expired");
  }
  const reservation = await repository.reserveIdempotency(
    CLAIM_QUOTE_SCOPE,
    claimantId,
    key,
    requestHash,
    reservationExpiresAt,
  );
  const replay = await recoverClaimQuote(
    repository,
    campaign,
    claimantId,
    key,
    requestHash,
    payout,
    reservation.record,
    reservation.created,
  );
  if (replay) return replay;

  try {
    let quote = null;
    let permitDeadline = deadline;
    if (payout.kind === "ONE_CLICK") {
      const tokens = await (options.getSupportedTokens ?? getTokenCatalog)();
      if (!tokens.some((token) => token.assetId === payout.destinationAsset)) {
        throw new AppError(
          400,
          "UNSUPPORTED_PAYOUT_ASSET",
          "Payout asset is not supported",
        );
      }
      quote = await quoteAdapter("ONE_CLICK", options).quote({
        kind: "PAYOUT_WINNER",
        campaign,
        payout,
        deadline,
      });
      assertQuoteDeadline(quote.deadline, deadline);
      permitDeadline = quote.deadline;
      if (
        quote.principal.assetId !== campaign.reward.assetId ||
        quote.principal.amountAtomic !== campaign.reward.amountAtomic ||
        quote.origin.assetId !== campaign.reward.assetId ||
        quote.origin.amountAtomic !== campaign.reward.amountAtomic ||
        quote.estimatedDelivery?.assetId !== payout.destinationAsset ||
        !quote.estimatedDelivery.amountAtomic
      ) {
        throw new AppError(
          502,
          "INVALID_PROVIDER_QUOTE",
          "Payout quote does not route the complete escrow principal",
        );
      }
    }
    const digest = payoutDigest(payout, quote?.rawDigest ?? null);
    const receiverId = nearAccountValue(
      quote?.depositAddress ?? payout.recipient,
      "receiverId",
    );
    const nonce = await (
      options.getClaimNonce ?? getV2CampaignClaimNonce
    )(campaign.id);
    const created = await repository.createClaimIdempotent({
      campaignId: campaign.id,
      claimantId,
      status: "AWAITING_PROOF",
      idempotencyKey: key,
      payout,
      payoutQuote: quote,
      solutionProofDigest: null,
      solutionProof: null,
      contractTxHash: null,
      settlementTxHash: null,
      evidence: {
        payoutDigest: digest,
        receiverId,
        nonce,
        deadlineMs: String(new Date(permitDeadline).getTime()),
        requestHash,
      },
      expiresAt: permitDeadline,
    });
    const storedHash = evidenceRequestHash(created.claim.evidence);
    if (
      created.claim.campaignId !== campaign.id ||
      (storedHash !== null && storedHash !== requestHash)
    ) {
      throw new AppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency key was already used for a different claim quote",
      );
    }
    await appendClaimQuoteEvent(repository, created.claim);
    await completeQuoteIdempotency(
      repository,
      CLAIM_QUOTE_SCOPE,
      claimantId,
      key,
      { claimId: created.claim.id },
    );
    return claimQuoteView(created.claim, campaign);
  } catch (error) {
    const durableClaim = await repository.getClaimByIdempotency(claimantId, key);
    if (!durableClaim) {
      await failQuoteIdempotency(
        repository,
        CLAIM_QUOTE_SCOPE,
        claimantId,
        key,
        error,
      );
    }
    throw error;
  }
}

async function appendClaimSubmissionEvent(
  repository: Repository,
  claim: Claim,
  campaignVersion: number,
): Promise<void> {
  await repository.appendEvent({
    aggregateType: "CLAIM",
    aggregateId: claim.id,
    eventType: "SOLUTION_PROOF_SUBMITTED",
    actorId: claim.claimantId,
    fromState: "AWAITING_PROOF",
    toState: "SUBMITTED",
    idempotencyKey: claim.idempotencyKey,
    evidence: {
      proofDigest: claim.solutionProofDigest,
      campaignVersion,
    },
  });
}

async function ensureClaimSubmissionJob(
  repository: Repository,
  claim: Claim,
  campaignId: string,
  receiverId: JsonValue,
): Promise<void> {
  if (!["SUBMITTED", "PAYING"].includes(claim.status)) return;
  await repository.enqueueJob({
    type: "SUBMIT_CONTRACT_CLAIM",
    aggregateType: "CLAIM",
    aggregateId: claim.id,
    deduplicationKey: `claim:${claim.id}`,
    payload: {
      claimId: claim.id,
      campaignId,
      receiverId,
    },
    maxAttempts: 8,
    runAfter: new Date().toISOString(),
    reactivateDead: true,
  });
}

export async function submitClaim(
  repository: Repository,
  campaignId: string,
  raw: unknown,
): Promise<Claim> {
  const body = objectValue(raw);
  const claimId = uuidValue(body.claimId, "claimId");
  const claim = await repository.getClaim(claimId);
  if (!claim || claim.campaignId !== campaignId) {
    throw new AppError(404, "CLAIM_NOT_FOUND", "Claim quote not found");
  }
  const proofInput = objectValue(body.proof, "proof");
  const proof = solutionProofValue({
    ...proofInput,
    deadlineMs: proofInput.deadlineMs ?? proofInput.deadline,
  });
  const evidence = objectValue(claim.evidence, "claim.evidence");
  if (
    proof.payoutDigest !== evidence.payoutDigest ||
    proof.nonce !== evidence.nonce ||
    proof.deadlineMs !== evidence.deadlineMs
  ) {
    throw new AppError(
      400,
      "CLAIM_BINDING_MISMATCH",
      "Solution proof is not bound to this payout quote",
    );
  }
  const campaign = await requireCampaign(repository, campaignId);
  if (
    !campaign.solutionPublicKey ||
    !campaign.contractId ||
    !verifyClaimProof({
      solutionPublicKey: campaign.solutionPublicKey,
      contractId: campaign.contractId,
      campaignId,
      receiverId: String(evidence.receiverId),
      proof,
    })
  ) {
    throw new AppError(
      400,
      "INVALID_SOLUTION_PROOF",
      "Solution proof signature does not match this campaign",
    );
  }
  const proofDigest = digestJson(proof);
  if (["SUBMITTED", "PAYING", "PAID"].includes(claim.status)) {
    if (claim.solutionProofDigest !== proofDigest) {
      throw new AppError(
        409,
        "CLAIM_ALREADY_SUBMITTED",
        "This claim was already submitted with a different solution proof",
      );
    }
    await appendClaimSubmissionEvent(repository, claim, campaign.version);
    await ensureClaimSubmissionJob(
      repository,
      claim,
      campaignId,
      evidence.receiverId as JsonValue,
    );
    return claim;
  }
  if (new Date(claim.expiresAt).getTime() <= Date.now()) {
    throw new AppError(409, "CLAIM_QUOTE_EXPIRED", "Claim quote has expired");
  }
  const submitted = await repository.submitClaimAtomically(
    claim.id,
    claim.version,
    campaign.version,
    proofDigest,
    proof,
  );
  if (!submitted) {
    throw new AppError(
      409,
      "CLAIM_RACE_LOST",
      "Campaign changed or another solver submitted the winning claim",
    );
  }
  await appendClaimSubmissionEvent(
    repository,
    submitted.claim,
    submitted.campaign.version,
  );
  await ensureClaimSubmissionJob(
    repository,
    submitted.claim,
    campaignId,
    evidence.receiverId as JsonValue,
  );
  return submitted.claim;
}

export function campaignStatus(value: string | null): CampaignStatus | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase() as CampaignStatus;
  const allowed: CampaignStatus[] = [
    "DRAFT",
    "FUNDING",
    "SCHEDULED",
    "ACTIVE",
    "CLAIMING",
    "CLAIMED",
    "REFUNDING",
    "REFUNDED",
    "CANCELLED",
  ];
  if (!allowed.includes(upper)) {
    throw new AppError(400, "INVALID_STATUS", "Unknown campaign status");
  }
  return upper;
}

export interface CampaignLifecycleStatusView {
  campaign: Campaign;
  fundingOrder: FundingOrder | null;
  onChain: OnChainCampaign | null;
  chainUnavailable: boolean;
}

type CampaignReader = (campaignId: string) => Promise<OnChainCampaign | null>;

export async function getCampaignLifecycleStatus(
  repository: Repository,
  actor: Actor,
  campaignId: string,
  chainReader: CampaignReader = getV2Campaign,
): Promise<CampaignLifecycleStatusView> {
  const campaign = await requireCampaign(repository, campaignId);
  if (campaign.creatorId !== actor.id) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the creator can inspect campaign lifecycle status",
    );
  }
  const fundingOrder = await repository.getFundingOrderForCampaign(campaign.id);
  let onChain: OnChainCampaign | null = null;
  let chainUnavailable = false;
  if (
    campaign.contractId &&
    !["DRAFT"].includes(campaign.status)
  ) {
    try {
      onChain = await chainReader(campaign.id);
    } catch {
      // The creator's workflow ledger remains useful during an RPC outage:
      // showing its durable order cannot publish a campaign or prove escrow.
      // All funding finalization and public trust labels still fail closed on
      // independently verified final chain state.
      chainUnavailable = true;
    }
  }
  return { campaign, fundingOrder, onChain, chainUnavailable };
}

async function requestCampaignRefund(
  repository: Repository,
  actor: Actor,
  campaignId: string,
  raw: unknown,
  reason: RefundReason,
  nowMs: number,
): Promise<Campaign> {
  const body = objectValue(raw);
  const unexpectedFields = Object.keys(body).filter(
    (field) => field !== "expectedVersion",
  );
  if (unexpectedFields.length) {
    throw new AppError(
      400,
      "INVALID_REFUND_REQUEST",
      "Refund requests accept only expectedVersion; payout and refund destinations are immutable",
    );
  }
  const version = expectedVersion(body.expectedVersion);
  let campaign = await requireCampaign(repository, campaignId);
  if (reason === "CREATOR_CANCEL" && campaign.creatorId !== actor.id) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the creator can request this campaign refund",
    );
  }
  const order = await repository.getFundingOrderForCampaign(campaign.id);
  if (!order || order.status !== "ALLOCATED") {
    throw new AppError(
      409,
      "CAMPAIGN_NOT_FUNDED",
      "Campaign has no allocated prize to refund",
    );
  }
  const expiresAtMs = campaign.expiresAt
    ? new Date(campaign.expiresAt).getTime()
    : Number.NaN;
  if (
    reason === "EXPIRED" &&
    (!Number.isFinite(expiresAtMs) || nowMs < expiresAtMs)
  ) {
    throw new AppError(
      409,
      "CAMPAIGN_NOT_EXPIRED",
      "Campaign prize is not eligible for expiry refund",
    );
  }

  if (campaign.status === "REFUNDING") {
    if (
      version !== campaign.version &&
      version !== campaign.version - 1
    ) {
      throw new AppError(
        409,
        "CAMPAIGN_VERSION_CONFLICT",
        "Campaign changed before the refund request was recorded",
      );
    }
    const transitionVersion =
      version === campaign.version ? Math.max(1, version - 1) : version;
    await appendCampaignRefundEvent(
      repository,
      campaign,
      order.id,
      actor.id,
      reason,
      transitionVersion,
    );
    await enqueueCampaignRefund(
      repository,
      campaign.id,
      order.id,
      reason,
      new Date(nowMs).toISOString(),
      { reactivateDead: true },
    );
    return campaign;
  }
  if (reason === "CREATOR_CANCEL") {
    const opensAtMs = campaign.openingAt
      ? new Date(campaign.openingAt).getTime()
      : Number.NaN;
    if (campaign.status !== "SCHEDULED" || !Number.isFinite(opensAtMs)) {
      throw new AppError(
        409,
        "CAMPAIGN_NOT_CANCELLABLE",
        "Only a scheduled campaign can be cancelled",
      );
    }
    if (nowMs >= opensAtMs) {
      throw new AppError(
        409,
        "CANCELLATION_WINDOW_CLOSED",
        "Campaign has already opened",
      );
    }
  } else {
    if (
      !["SCHEDULED", "ACTIVE"].includes(campaign.status) ||
      !Number.isFinite(expiresAtMs)
    ) {
      throw new AppError(
        409,
        "CAMPAIGN_NOT_EXPIRED",
        "Campaign prize is not eligible for expiry refund",
      );
    }
  }

  const transitioned = await repository.transitionCampaign(
    campaign.id,
    [campaign.status],
    "REFUNDING",
    version,
  );
  if (!transitioned) {
    const latest = await requireCampaign(repository, campaign.id);
    if (
      latest.status !== "REFUNDING" ||
      latest.version !== version + 1
    ) {
      throw new AppError(
        409,
        "CAMPAIGN_VERSION_CONFLICT",
        "Campaign changed before the refund request was recorded",
      );
    }
    campaign = latest;
  } else {
    campaign = transitioned;
  }
  await appendCampaignRefundEvent(
    repository,
    campaign,
    order.id,
    actor.id,
    reason,
    version,
  );
  await enqueueCampaignRefund(
    repository,
    campaign.id,
    order.id,
    reason,
    new Date(nowMs).toISOString(),
  );
  return campaign;
}

async function appendCampaignRefundEvent(
  repository: Repository,
  campaign: Campaign,
  fundingOrderId: string,
  actorId: string,
  reason: RefundReason,
  transitionVersion: number,
): Promise<void> {
  await repository.appendEvent({
    aggregateType: "CAMPAIGN",
    aggregateId: campaign.id,
    eventType:
      reason === "CREATOR_CANCEL"
        ? "CREATOR_CANCELLATION_REQUESTED"
        : "EXPIRY_REFUND_REQUESTED",
    actorId,
    fromState: reason === "CREATOR_CANCEL" ? "SCHEDULED" : null,
    toState: "REFUNDING",
    idempotencyKey: `${reason.toLowerCase()}:${campaign.id}:${transitionVersion}`,
    evidence: {
      fundingOrderId,
      relay: reason === "EXPIRED" ? "permissionless" : "creator",
    },
  });
}

export function requestCampaignCancellation(
  repository: Repository,
  actor: Actor,
  campaignId: string,
  raw: unknown,
  nowMs = Date.now(),
): Promise<Campaign> {
  return requestCampaignRefund(
    repository,
    actor,
    campaignId,
    raw,
    "CREATOR_CANCEL",
    nowMs,
  );
}

export function requestExpiredCampaignRefund(
  repository: Repository,
  actor: Actor,
  campaignId: string,
  raw: unknown,
  nowMs = Date.now(),
): Promise<Campaign> {
  return requestCampaignRefund(
    repository,
    actor,
    campaignId,
    raw,
    "EXPIRED",
    nowMs,
  );
}
