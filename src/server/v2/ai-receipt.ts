import { AppError } from "./errors";
import type {
  AiGenerationReceiptEvidence,
  AiGenerationReceiptHandle,
  IdempotencyRecord,
  JsonValue,
} from "./types";
import { digestJson } from "./validation";

export const AI_GENERATION_IDEMPOTENCY_SCOPE = "AI_GENERATE_X402_V2";
export const AI_GENERATION_IDEMPOTENCY_ACTOR = "x402:ai-generate";
export const AI_GENERATION_RECEIPT_VERSION =
  "x402-ai-generation-receipt:v1" as const;

const PAYMENT_IDENTIFIER = /^[A-Za-z0-9._:-]{8,200}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const NEAR_NETWORK = /^near:(?:mainnet|testnet)$/;

function recordValue(
  value: JsonValue,
  code: string,
  message: string,
): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(409, code, message);
  }
  return value;
}

export function parseAiGenerationReceiptHandle(
  value: unknown,
): AiGenerationReceiptHandle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(
      400,
      "INVALID_AI_RECEIPT_HANDLE",
      "aiReceiptHandle must be a paid AI generation receipt handle",
    );
  }
  const handle = value as Record<string, unknown>;
  const keys = Object.keys(handle).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "paymentIdentifier" ||
    keys[1] !== "version" ||
    handle.version !== AI_GENERATION_RECEIPT_VERSION ||
    typeof handle.paymentIdentifier !== "string" ||
    !PAYMENT_IDENTIFIER.test(handle.paymentIdentifier)
  ) {
    throw new AppError(
      400,
      "INVALID_AI_RECEIPT_HANDLE",
      "aiReceiptHandle is invalid",
    );
  }
  return {
    version: AI_GENERATION_RECEIPT_VERSION,
    paymentIdentifier: handle.paymentIdentifier,
  };
}

/**
 * Derives campaign-safe provenance exclusively from the durable payment
 * record. No settlement or result claims supplied by the browser are used.
 */
export function verifyAiGenerationReceipt(
  handle: AiGenerationReceiptHandle,
  stored: IdempotencyRecord,
): AiGenerationReceiptEvidence {
  if (
    stored.scope !== AI_GENERATION_IDEMPOTENCY_SCOPE ||
    stored.actorId !== AI_GENERATION_IDEMPOTENCY_ACTOR ||
    stored.key !== handle.paymentIdentifier
  ) {
    throw new AppError(
      409,
      "AI_RECEIPT_UNVERIFIED",
      "The paid AI generation receipt could not be verified",
    );
  }
  if (
    stored.state !== "COMPLETED" ||
    stored.responseStatus === null ||
    stored.responseStatus < 200 ||
    stored.responseStatus >= 300 ||
    !DIGEST.test(stored.requestHash) ||
    !stored.authorizationDigest ||
    !DIGEST.test(stored.authorizationDigest) ||
    stored.processingStage !== null ||
    stored.processingOwner !== null ||
    stored.processingLeaseExpiresAt !== null ||
    !stored.paymentReference
  ) {
    throw new AppError(
      409,
      "AI_RECEIPT_INCOMPLETE",
      "The paid AI generation has not reached durable settlement",
    );
  }

  const body = recordValue(
    stored.responseBody,
    "AI_RECEIPT_INCOMPLETE",
    "The paid AI generation result is incomplete",
  );
  const payment = recordValue(
    body.payment ?? null,
    "AI_RECEIPT_INCOMPLETE",
    "The paid AI settlement evidence is incomplete",
  );
  if (
    payment.rail !== "x402" ||
    payment.paymentIdentifier !== handle.paymentIdentifier ||
    typeof payment.network !== "string" ||
    !NEAR_NETWORK.test(payment.network) ||
    typeof payment.settlementReference !== "string" ||
    payment.settlementReference.length < 8 ||
    payment.settlementReference.length > 256 ||
    payment.settlementReference !== stored.paymentReference
  ) {
    throw new AppError(
      409,
      "AI_RECEIPT_UNVERIFIED",
      "The paid AI settlement evidence does not match its durable record",
    );
  }
  if (
    !Array.isArray(body.entries) ||
    body.entries.length < 3 ||
    !body.entries.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof entry.clue === "string" &&
        entry.clue.length > 0 &&
        typeof entry.answer === "string" &&
        entry.answer.length > 0,
    )
  ) {
    throw new AppError(
      409,
      "AI_RECEIPT_INCOMPLETE",
      "The paid AI generation result is incomplete",
    );
  }

  const receiptDigest = digestJson({
    version: AI_GENERATION_RECEIPT_VERSION,
    paymentIdentifier: handle.paymentIdentifier,
    requestDigest: stored.requestHash,
    resultDigest: digestJson(body.entries),
    settlement: {
      network: payment.network,
      reference: payment.settlementReference,
    },
  });

  return {
    paymentIdentifier: handle.paymentIdentifier,
    receiptDigest,
    network: payment.network,
    settlementReference: payment.settlementReference,
  };
}
