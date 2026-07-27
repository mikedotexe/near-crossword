import type { Campaign, FundingQuote, JsonValue } from "../types";
import { jsonValue } from "../validation";

export const EXTERNAL_FUNDING_AUTHORIZATION_INSTRUCTION_KEY =
  "creatorAuthorization" as const;
export const DEFAULT_EXTERNAL_AUTHORIZATION_STORAGE_DEPOSIT_YOCTO =
  "50000000000000000000000";
export const EXTERNAL_AUTHORIZATION_FUNCTION_CALL_GAS =
  "100000000000000";
export const EXTERNAL_FUNDING_ALLOCATION_GRACE_MS = 15 * 60 * 1_000;
export const EXTERNAL_AUTHORIZATION_STORAGE_NOTICE =
  "The attached NEAR is a maximum storage allowance. The contract refunds the unused allowance immediately. Revoking or cleaning an expired, unallocated authorization returns the released storage deposit to the creator while retaining only the permanent single-use reference record.";

const MAX_ATTACHED_STORAGE_DEPOSIT_YOCTO = 1_000_000_000_000_000_000_000_000n;
const MAX_FUNDING_REFERENCE_BYTES = 160;
const MIN_CAMPAIGN_DURATION_MS = 60 * 60 * 1_000;
const MAX_CAMPAIGN_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
const CAMPAIGN_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const NEAR_ACCOUNT =
  /^(?=.{2,64}$)(?:[a-z0-9]+[-_])*[a-z0-9]+(?:\.(?:[a-z0-9]+[-_])*[a-z0-9]+)*$/;
const ATOMIC_AMOUNT = /^(?:0|[1-9][0-9]*)$/;
const HEX_DIGEST = /^[a-fA-F0-9]{64}$/;

export interface ExternalFundingAuthorizationContractArgs {
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
          args: ExternalFundingAuthorizationContractArgs;
        };
        gas: string;
        deposit: string;
      },
    ];
  };
}

export interface ExternalFundingAuthorizationOptions {
  attachedStorageDepositYocto?: string;
  allocationGraceMs?: number;
}

function requiredText(value: string | null, label: string): string {
  const text = value?.trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function nearAccount(value: string | null, label: string): string {
  const account = requiredText(value, label);
  if (!NEAR_ACCOUNT.test(account)) {
    throw new Error(`${label} must be a valid lowercase NEAR account ID`);
  }
  return account;
}

function timestamp(value: string | null, label: string): number {
  const text = requiredText(value, label);
  const milliseconds = new Date(text).getTime();
  if (!Number.isSafeInteger(milliseconds)) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return milliseconds;
}

function canonicalBase64(value: string | null, bytes: number, label: string): string {
  const encoded = requiredText(value, label);
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== bytes || decoded.toString("base64") !== encoded) {
    throw new Error(`${label} must be canonical base64 for exactly ${bytes} bytes`);
  }
  return encoded;
}

function fundingReference(quote: FundingQuote): string {
  const reference =
    quote.providerQuoteId?.trim() || requiredText(quote.depositAddress, "depositAddress");
  if (
    Buffer.byteLength(reference, "utf8") > MAX_FUNDING_REFERENCE_BYTES ||
    [...reference].some((character) => /\p{Cc}/u.test(character))
  ) {
    throw new Error("External funding reference is invalid");
  }
  return reference;
}

function storageDeposit(options: ExternalFundingAuthorizationOptions): string {
  const value =
    options.attachedStorageDepositYocto ??
    DEFAULT_EXTERNAL_AUTHORIZATION_STORAGE_DEPOSIT_YOCTO;
  if (!ATOMIC_AMOUNT.test(value)) {
    throw new Error("attachedStorageDepositYocto must be an atomic NEAR amount");
  }
  const atomic = BigInt(value);
  if (
    atomic < BigInt(DEFAULT_EXTERNAL_AUTHORIZATION_STORAGE_DEPOSIT_YOCTO) ||
    atomic > MAX_ATTACHED_STORAGE_DEPOSIT_YOCTO
  ) {
    throw new Error(
      "attachedStorageDepositYocto must be between the 0.05 NEAR safety allowance and 1 NEAR",
    );
  }
  return value;
}

function allocationDeadline(
  quoteDeadlineMs: number,
  campaignExpiresAtMs: number,
  options: ExternalFundingAuthorizationOptions,
): number {
  const grace =
    options.allocationGraceMs ?? EXTERNAL_FUNDING_ALLOCATION_GRACE_MS;
  if (
    !Number.isSafeInteger(grace) ||
    grace < 0 ||
    grace > 60 * 60 * 1_000
  ) {
    throw new Error("allocationGraceMs must be between zero and one hour");
  }
  const deadline = quoteDeadlineMs + grace;
  if (!Number.isSafeInteger(deadline) || deadline > campaignExpiresAtMs) {
    throw new Error(
      "External funding allocation deadline cannot exceed campaign expiry",
    );
  }
  return deadline;
}

function instructionObject(value: JsonValue): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("External funding quote instructions must be an object");
  }
  return value;
}

/**
 * Builds the creator-owned call that commits every prize-critical field before
 * a pooled Intents deposit can be allocated by the operator.
 */
export function buildExternalFundingAuthorizationInstruction(
  campaign: Campaign,
  quote: FundingQuote,
  options: ExternalFundingAuthorizationOptions = {},
): ExternalFundingAuthorizationInstruction {
  if (quote.rail !== "ONE_CLICK") {
    throw new Error("Creator authorization is only valid for an external 1Click quote");
  }
  if (campaign.reward.type !== "TOKEN_PRIZE") {
    throw new Error("Creator authorization requires a token-prize campaign");
  }

  const creatorAccountId = nearAccount(
    campaign.creatorAccountId,
    "campaign.creatorAccountId",
  );
  const refundAccount = nearAccount(
    campaign.refundAccount,
    "campaign.refundAccount",
  );
  if (creatorAccountId !== refundAccount) {
    throw new Error(
      "campaign.creatorAccountId must equal campaign.refundAccount",
    );
  }
  const contractId = nearAccount(campaign.contractId, "campaign.contractId");
  if (!CAMPAIGN_ID.test(campaign.id)) {
    throw new Error("campaign.id is not valid for the v2 contract");
  }
  if (!HEX_DIGEST.test(campaign.contentHash ?? "")) {
    throw new Error("campaign.contentHash must be a 32-byte hexadecimal digest");
  }
  const contentHash = Buffer.from(campaign.contentHash!, "hex").toString(
    "base64",
  );
  const solutionPublicKey = canonicalBase64(
    campaign.solutionPublicKey,
    32,
    "campaign.solutionPublicKey",
  );
  const opensAtMs = timestamp(campaign.openingAt, "campaign.openingAt");
  const expiresAtMs = timestamp(campaign.expiresAt, "campaign.expiresAt");
  const quoteDeadlineMs = timestamp(quote.deadline, "quote.deadline");
  const fundingDeadlineMs = allocationDeadline(
    quoteDeadlineMs,
    expiresAtMs,
    options,
  );
  const duration = expiresAtMs - opensAtMs;
  if (
    expiresAtMs <= opensAtMs ||
    duration < MIN_CAMPAIGN_DURATION_MS ||
    duration > MAX_CAMPAIGN_DURATION_MS
  ) {
    throw new Error(
      "Campaign duration must be between one hour and thirty days",
    );
  }
  if (
    !ATOMIC_AMOUNT.test(campaign.reward.amountAtomic) ||
    BigInt(campaign.reward.amountAtomic) <= 0n
  ) {
    throw new Error("campaign.reward.amountAtomic must be positive");
  }
  if (
    quote.principal.assetId !== campaign.reward.assetId ||
    quote.principal.amountAtomic !== campaign.reward.amountAtomic
  ) {
    throw new Error("External quote principal does not match the locked reward");
  }

  const reference = fundingReference(quote);
  const args: ExternalFundingAuthorizationContractArgs = {
    campaign: {
      campaign_id: campaign.id,
      creator_id: creatorAccountId,
      controller_id: creatorAccountId,
      content_hash: contentHash,
      solution_public_key: solutionPublicKey,
      opens_at_ms: opensAtMs,
      expires_at_ms: expiresAtMs,
      refund_account_id: refundAccount,
    },
    amount: campaign.reward.amountAtomic,
    funding_reference: reference,
    funding_rail: "intents",
    sponsor_id: creatorAccountId,
    funding_deadline_ms: fundingDeadlineMs,
  };

  return {
    version: "crossword-external-funding-authorization:v1",
    authorizedCreatorAccountId: creatorAccountId,
    fundingReference: reference,
    storageDepositNotice: EXTERNAL_AUTHORIZATION_STORAGE_NOTICE,
    walletCall: {
      signerId: creatorAccountId,
      receiverId: contractId,
      actions: [
        {
          type: "FunctionCall",
          methodName: "authorize_external_funding",
          args: { args },
          gas: EXTERNAL_AUTHORIZATION_FUNCTION_CALL_GAS,
          deposit: storageDeposit(options),
        },
      ],
    },
  };
}

/**
 * Returns a new quote with its provider instructions preserved and the
 * creator-authorization call added under a stable, client-readable key.
 */
export function augmentExternalFundingQuoteInstructions(
  campaign: Campaign,
  quote: FundingQuote,
  options: ExternalFundingAuthorizationOptions = {},
): FundingQuote {
  const instructions = instructionObject(quote.instructions);
  const authorization = buildExternalFundingAuthorizationInstruction(
    campaign,
    quote,
    options,
  );
  return {
    ...quote,
    instructions: jsonValue({
      ...instructions,
      [EXTERNAL_FUNDING_AUTHORIZATION_INSTRUCTION_KEY]: authorization,
    }),
  };
}
