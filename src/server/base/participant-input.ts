import { createHash, timingSafeEqual } from "node:crypto";
import { getAddress, type Address } from "viem";
import { z } from "zod";
import { AppError } from "../v2/errors";

const revision = z.number().int().positive().max(2147483646);
const recipient = z.string().transform((value, context) => {
  try {
    const address = getAddress(value).toLowerCase() as Address;
    if (BigInt(address) !== 0n) return address;
  } catch { /* Do not echo submitted wallet data. */ }
  context.addIssue({ code: "custom", message: "Invalid recipient" });
  return z.NEVER;
});
export const completionSchema = z.object({
  revision,
  answers: z.array(z.string().trim().regex(/^[A-Za-z]{3,24}$/).transform((v) => v.toUpperCase())).min(3).max(12),
}).strict();
export const challengeSchema = z.object({ revision, recipient }).strict();
export const walletProofSchema = z.object({
  challengeId: z.string().uuid(),
  signature: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/).max(8194).transform((v) => v.toLowerCase() as `0x${string}`),
}).strict();
export const claimSchema = z.object({ recipient, proof: walletProofSchema }).strict();
export const consentSchema = z.object({
  expectedVersion: z.number().int().min(0).max(2147483646), shareEmail: z.boolean(),
}).strict();

export function participantInput<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AppError(400, "INVALID_PARTICIPANT_REQUEST", "Invalid participant request");
  return parsed.data;
}

export function correctAnswers(answers: string[], expected: string[]) {
  const digest = (value: string[]) => createHash("sha256").update(JSON.stringify(value)).digest();
  return timingSafeEqual(digest(answers), digest(expected));
}

export function participantOrigin(value = process.env.NEXTAUTH_URL) {
  try {
    const url = new URL(value || "");
    if (url.username || url.password || url.hash || url.search ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error();
    return url.origin;
  } catch { throw new AppError(503, "BASE_PARTICIPANT_UNAVAILABLE", "The participant origin is not configured"); }
}
