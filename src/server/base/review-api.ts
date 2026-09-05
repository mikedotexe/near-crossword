import { z } from "zod";
import { requireActor } from "../v2/auth";
import { AppError } from "../v2/errors";
import { getDatabasePool } from "../v2/repository-factory";
import { clientAddress, enforceRateLimit } from "../v2/security";
import { realUserId } from "./review";
import { PostgresReviewRepository } from "./review-repository";

export function assertReviewRequest(request: Request) {
  if (process.env.BASE_REVIEW_ENABLED !== "true") throw new AppError(404, "NOT_FOUND", "Not found");
  if (request.method !== "GET") {
    let origin: string;
    try { origin = new URL(process.env.NEXTAUTH_URL || "").origin; }
    catch { throw new AppError(503, "BASE_REVIEW_UNAVAILABLE", "The private review origin is not configured"); }
    if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new AppError(403, "ORIGIN_REQUIRED", "A same-origin review request is required");
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      throw new AppError(415, "JSON_REQUIRED", "A JSON request is required");
    }
  }
}

export async function reviewContext(request: Request) {
  assertReviewRequest(request);
  const actor = await requireActor(request);
  if (actor.demo) throw new AppError(401, "AUTH_REQUIRED", "A database-backed account is required");
  realUserId(actor.id);
  if (request.method !== "GET") {
    await enforceRateLimit(`base-review:ip:${clientAddress(request)}`, { limit: 120, windowMs: 3_600_000 });
    await enforceRateLimit(`base-review:account:${actor.id}`, { limit: 60, windowMs: 3_600_000 });
  }
  return { ownerId: actor.id, repository: new PostgresReviewRepository(getDatabasePool()) };
}

const revision = z.number().int().positive().max(2147483646);
const updateSchema = z.object({ expectedRevision: revision, submission: z.unknown() }).strict();
const approvalSchema = z.object({
  revision, reviewHash: z.string().regex(/^[0-9a-f]{64}$/), termsHash: z.string().regex(/^0x[0-9a-f]{64}$/),
}).strict();

export function parseReviewUpdate(raw: unknown) {
  const result = updateSchema.safeParse(raw);
  if (!result.success) throw new AppError(400, "INVALID_REVIEW_UPDATE", "Provide the expected revision and review submission");
  return result.data;
}

export function parseReviewApproval(raw: unknown) {
  const result = approvalSchema.safeParse(raw);
  if (!result.success) throw new AppError(400, "INVALID_REVIEW_APPROVAL", "Provide the reviewed revision and both commitments");
  return result.data;
}
