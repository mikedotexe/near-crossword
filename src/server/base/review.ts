import { createHash } from "node:crypto";
import { getAddress, keccak256, stringToHex } from "viem";
import { z } from "zod";
import { AppError } from "../v2/errors";
import { parseLearningDraftInput, validateLearningDraft } from "../v2/learning-draft";

const address = z.string().transform((value, context) => {
  try {
    const normalized = getAddress(value);
    if (BigInt(normalized) !== 0n) return normalized.toLowerCase();
  } catch { /* Report only a field error, never the submitted value. */ }
  context.addIssue({ code: "custom", message: "Invalid address" });
  return z.NEVER;
});
const seconds = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const termsSchema = z.object({
  chainId: z.union([z.literal(8453), z.literal(84532), z.literal(31337)]),
  escrow: address,
  token: address,
  sponsor: address,
  initialSigner: address,
  rewardAtomic: z.string().regex(/^[1-9][0-9]{0,77}$/),
  maxClaims: z.number().int().min(1).max(2 ** 32 - 1),
  startsAt: seconds,
  endsAt: seconds,
  claimDeadline: seconds,
}).strict().superRefine((terms, context) => {
  const nativeToken = terms.chainId === 8453 ? "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" :
    terms.chainId === 84532 ? "0x036cbd53842c5426634e7929541ec2318f3dcf7e" : terms.token;
  if (terms.token !== nativeToken || terms.sponsor === terms.escrow ||
      terms.endsAt <= terms.startsAt || terms.claimDeadline <= terms.endsAt ||
      BigInt(terms.rewardAtomic) * BigInt(terms.maxClaims) >= 1n << 256n) {
    context.addIssue({ code: "custom", message: "Invalid reward terms" });
  }
});

const submissionSchema = z.object({ source: z.unknown(), draft: z.unknown(), terms: termsSchema }).strict();
export type RewardTerms = z.infer<typeof termsSchema>;

export function parseReviewSubmission(raw: unknown) {
  const parsed = submissionSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(400, "INVALID_REVIEW", "Provide source material, a draft, and valid reward terms");
  const source = parseLearningDraftInput(parsed.data.source);
  try {
    return { source, draft: validateLearningDraft(parsed.data.draft, source), terms: parsed.data.terms };
  } catch (error) {
    if (error instanceof AppError && error.code === "AI_DRAFT_INVALID") {
      throw new AppError(400, "INVALID_REVIEW_DRAFT", "The draft failed source or content validation");
    }
    throw error;
  }
}
export type ReviewSubmission = ReturnType<typeof parseReviewSubmission>;

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// Schema parsing establishes key order again after a JSONB round-trip. Arrays keep their order.
export function reviewMaterial(raw: unknown, revision: number, campaignId: string) {
  validId(campaignId);
  const submission = parseReviewSubmission(raw);
  const sourceManifest = submission.source.sources.map(({ id, title, text, url }) => ({
    id, title, url: url ?? null, sha256: sha256(text),
  }));
  const publicContent = {
    title: submission.draft.title,
    paragraphs: submission.draft.paragraphs.map(({ text }) => text),
    clues: submission.draft.entries.map(({ clue, answer }) => ({ clue, length: answer.length })),
  };
  const publicTerms = {
    version: "base-learning-terms:v1" as const,
    campaignId,
    revision,
    contentHash: keccak256(stringToHex(JSON.stringify(publicContent))),
    ...submission.terms,
    eligibilityPolicy: "verified-email-wallet-completion:v1",
    privacyPolicy: "private-email-optional-sponsor-contact:v1",
    signerPolicy: "sponsor-pause-rotation-no-deadline-extension:v1",
  };
  return {
    submission, sourceManifest, publicContent, publicTerms,
    reviewHash: sha256(JSON.stringify({ version: "private-learning-review:v1", submission })),
    termsHash: keccak256(stringToHex(JSON.stringify(publicTerms))),
  };
}

export function validId(value: string): string {
  if (!z.string().uuid().safeParse(value).success) throw new AppError(400, "INVALID_ID", "Invalid workflow identifier");
  return value;
}

export function realUserId(value: string): string {
  if (!/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new AppError(401, "AUTH_REQUIRED", "A database-backed account is required");
  }
  return value;
}
