import { createHash } from "node:crypto";
import { AppError } from "./errors";
import type {
  JsonValue,
  Payout,
  PublicPuzzle,
  RewardSpec,
  SolutionProof,
} from "./types";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ATOMIC = /^(?:0|[1-9][0-9]*)$/;
const HASH = /^[a-fA-F0-9]{64}$/;
const U64_MAX = 18_446_744_073_709_551_615n;
const NEAR_ACCOUNT =
  /^(?=.{2,64}$)(?:[a-z0-9]+[-_])*[a-z0-9]+(?:\.(?:[a-z0-9]+[-_])*[a-z0-9]+)*$/;
const IDEMPOTENCY = /^[A-Za-z0-9_-]{16,128}$/;
const ASSET_ID = /^[A-Za-z0-9:._-]{3,240}$/;

export function objectValue(value: unknown, label = "body"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "INVALID_REQUEST", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function stringValue(
  value: unknown,
  label: string,
  options: { min?: number; max?: number; optional?: boolean } = {},
): string | undefined {
  if (value === undefined || value === null) {
    if (options.optional) return undefined;
    throw new AppError(400, "INVALID_REQUEST", `${label} is required`);
  }
  if (typeof value !== "string") {
    throw new AppError(400, "INVALID_REQUEST", `${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < (options.min ?? 1)) {
    throw new AppError(400, "INVALID_REQUEST", `${label} is too short`);
  }
  if (trimmed.length > (options.max ?? 4096)) {
    throw new AppError(400, "INVALID_REQUEST", `${label} is too long`);
  }
  return trimmed;
}

export function nullableString(
  value: unknown,
  label: string,
  max = 4096,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return stringValue(value, label, { max }) ?? null;
}

export function integerValue(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new AppError(
      400,
      "INVALID_REQUEST",
      `${label} must be an integer between ${min} and ${max}`,
    );
  }
  return value as number;
}

export function atomicAmount(value: unknown, label = "amountAtomic"): string {
  const amount = stringValue(value, label, { max: 80 });
  if (!amount || !ATOMIC.test(amount) || BigInt(amount) <= 0n) {
    throw new AppError(400, "INVALID_REQUEST", `${label} must be a positive atomic amount`);
  }
  return amount;
}

export function idempotencyKey(value: unknown): string {
  const key = stringValue(value, "idempotencyKey", { min: 16, max: 128 });
  if (!key || !IDEMPOTENCY.test(key)) {
    throw new AppError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "idempotencyKey must be 16-128 letters, digits, underscores, or hyphens",
    );
  }
  return key;
}

export function slugValue(value: unknown): string {
  const slug = stringValue(value, "slug", { min: 3, max: 80 })?.toLowerCase();
  if (!slug || !SLUG.test(slug)) {
    throw new AppError(
      400,
      "INVALID_SLUG",
      "slug must contain lowercase letters, digits, and single hyphens",
    );
  }
  return slug;
}

export function assetIdValue(value: unknown, label: string): string {
  const asset = stringValue(value, label, { max: 240 });
  if (!asset || !ASSET_ID.test(asset)) {
    throw new AppError(400, "INVALID_ASSET", `${label} is not a valid asset id`);
  }
  return asset;
}

export function isoDateValue(value: unknown, label: string): string {
  const text = stringValue(value, label, { max: 64 });
  const date = text ? new Date(text) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, "INVALID_REQUEST", `${label} must be an ISO timestamp`);
  }
  return date.toISOString();
}

export function optionalIsoDate(
  value: unknown,
  label: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return isoDateValue(value, label);
}

export function validateCampaignWindow(
  openingAt: string | null,
  expiresAt: string | null,
  now = Date.now(),
): void {
  if (!expiresAt) return;
  const opens = openingAt ? new Date(openingAt).getTime() : now;
  const expires = new Date(expiresAt).getTime();
  const duration = expires - opens;
  if (duration < 60 * 60 * 1000 || duration > 30 * 24 * 60 * 60 * 1000) {
    throw new AppError(
      400,
      "INVALID_CAMPAIGN_WINDOW",
      "Campaign duration must be between one hour and thirty days",
    );
  }
}

export function publicPuzzle(value: unknown): PublicPuzzle {
  let puzzle = objectValue(value, "puzzle");
  rejectSecretFields(puzzle);
  if (
    puzzle.width === undefined &&
    puzzle.height === undefined &&
    (puzzle.columns !== undefined || puzzle.rows !== undefined)
  ) {
    puzzle = {
      width: puzzle.columns,
      height: puzzle.rows,
      clues: puzzle.entries,
    };
  }
  const width = integerValue(puzzle.width, "puzzle.width", 2, 100);
  const height = integerValue(puzzle.height, "puzzle.height", 2, 100);
  if (!Array.isArray(puzzle.clues) || puzzle.clues.length < 2 || puzzle.clues.length > 200) {
    throw new AppError(400, "INVALID_PUZZLE", "puzzle.clues must contain 2-200 clues");
  }
  const clues = puzzle.clues.map((candidate, index) => {
    const clue = objectValue(candidate, `puzzle.clues[${index}]`);
    rejectSecretFields(clue);
    const directionValue = stringValue(
      clue.direction,
      `puzzle.clues[${index}].direction`,
    );
    if (directionValue !== "across" && directionValue !== "down") {
      throw new AppError(400, "INVALID_PUZZLE", "Clue direction must be across or down");
    }
    const direction: "across" | "down" = directionValue;
    const normalized = {
      number: integerValue(clue.number, `puzzle.clues[${index}].number`, 1, 999),
      clue: stringValue(clue.clue, `puzzle.clues[${index}].clue`, {
        min: 3,
        max: 500,
      })!,
      row: integerValue(clue.row, `puzzle.clues[${index}].row`, 0, height - 1),
      column: integerValue(
        clue.column ?? clue.col,
        `puzzle.clues[${index}].column`,
        0,
        width - 1,
      ),
      direction,
      length: integerValue(clue.length, `puzzle.clues[${index}].length`, 2, 100),
    };
    const endRow =
      normalized.row + (normalized.direction === "down" ? normalized.length - 1 : 0);
    const endColumn =
      normalized.column +
      (normalized.direction === "across" ? normalized.length - 1 : 0);
    if (endRow >= height || endColumn >= width) {
      throw new AppError(
        400,
        "INVALID_PUZZLE",
        `puzzle.clues[${index}] extends beyond the ${width}×${height} grid`,
      );
    }
    return normalized;
  });
  return { width, height, clues };
}

function rejectSecretFields(value: Record<string, unknown>): void {
  const forbidden = ["answer", "answers", "seed", "seedPhrase", "privateKey", "solution"];
  for (const field of forbidden) {
    if (field in value) {
      throw new AppError(
        400,
        "SECRET_MATERIAL_REJECTED",
        `Public puzzle data cannot contain ${field}`,
      );
    }
  }
}

export function rewardSpec(value: unknown): RewardSpec {
  const reward = objectValue(value, "reward");
  if (reward.type !== "TOKEN_PRIZE") {
    throw new AppError(
      400,
      "UNSUPPORTED_REWARD",
      "Only TOKEN_PRIZE rewards are enabled in v1",
    );
  }
  return {
    type: "TOKEN_PRIZE",
    assetId: assetIdValue(reward.assetId, "reward.assetId"),
    amountAtomic: atomicAmount(reward.amountAtomic, "reward.amountAtomic"),
    decimals: integerValue(reward.decimals, "reward.decimals", 0, 30),
    symbol: stringValue(reward.symbol, "reward.symbol", { min: 1, max: 16 })!,
  };
}

export function contentHashValue(value: unknown): string {
  const hash = stringValue(value, "contentHash", { min: 64, max: 64 });
  if (!hash || !HASH.test(hash)) {
    throw new AppError(400, "INVALID_CONTENT_HASH", "contentHash must be 32-byte hex");
  }
  return hash.toLowerCase();
}

export function publicKeyValue(value: unknown, label = "solutionPublicKey"): string {
  return fixedBase64(value, label, 32);
}

export function nearAccountValue(value: unknown, label: string): string {
  const account = stringValue(value, label, { min: 2, max: 64 })?.toLowerCase();
  if (!account || !NEAR_ACCOUNT.test(account)) {
    throw new AppError(400, "INVALID_NEAR_ACCOUNT", `${label} is not a NEAR account`);
  }
  return account;
}

export function payoutValue(value: unknown): Payout {
  const payout = objectValue(value, "payout");
  if (payout.kind !== "DIRECT_NEAR" && payout.kind !== "ONE_CLICK") {
    throw new AppError(400, "INVALID_PAYOUT", "Unsupported payout kind");
  }
  const recipient = stringValue(payout.recipient, "payout.recipient", {
    min: 2,
    max: 256,
  })!;
  return {
    kind: payout.kind,
    destinationAsset: assetIdValue(payout.destinationAsset, "payout.destinationAsset"),
    recipient,
    recoveryAccount: nearAccountValue(payout.recoveryAccount, "payout.recoveryAccount"),
  };
}

export function solutionProofValue(value: unknown): SolutionProof {
  const proof = objectValue(value, "proof");
  const deadlineMs = u64Value(proof.deadlineMs, "proof.deadlineMs");
  if (BigInt(deadlineMs) <= BigInt(Date.now())) {
    throw new AppError(400, "EXPIRED_SOLUTION_PROOF", "Solution proof has expired");
  }
  return {
    signature: fixedBase64(proof.signature, "proof.signature", 64),
    nonce: u64Value(proof.nonce, "proof.nonce"),
    deadlineMs,
    payoutDigest: fixedBase64(proof.payoutDigest, "proof.payoutDigest", 32),
  };
}

export function uuidValue(value: unknown, label = "id"): string {
  const uuid = stringValue(value, label, { min: 36, max: 36 })?.toLowerCase();
  if (
    !uuid ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      uuid,
    )
  ) {
    throw new AppError(400, "INVALID_UUID", `${label} must be a UUID`);
  }
  return uuid;
}

export function u64Value(value: unknown, label: string): string {
  const text =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : stringValue(value, label, { min: 1, max: 20 });
  if (!text || !ATOMIC.test(text)) {
    throw new AppError(400, "INVALID_REQUEST", `${label} must be an unsigned integer`);
  }
  const number = BigInt(text);
  if (number > U64_MAX) {
    throw new AppError(400, "INVALID_REQUEST", `${label} exceeds u64`);
  }
  return text;
}

function fixedBase64(value: unknown, label: string, bytes: number): string {
  const text = stringValue(value, label, { min: 4, max: 256 });
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    throw new AppError(400, "INVALID_BASE64", `${label} must be standard base64`);
  }
  const decoded = Buffer.from(text, "base64");
  if (
    decoded.length !== bytes ||
    decoded.toString("base64").replace(/=+$/, "") !== text.replace(/=+$/, "")
  ) {
    throw new AppError(
      400,
      "INVALID_BASE64",
      `${label} must encode exactly ${bytes} bytes`,
    );
  }
  return decoded.toString("base64");
}

export function expectedVersion(value: unknown): number {
  return integerValue(value, "expectedVersion", 1, Number.MAX_SAFE_INTEGER);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

export function digestJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function jsonValue(value: unknown): JsonValue {
  JSON.stringify(value);
  return value as JsonValue;
}
