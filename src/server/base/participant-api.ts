import type { Pool } from "pg";
import { privateKeyToAccount } from "viem/accounts";
import { requireActor } from "../v2/auth";
import { AppError } from "../v2/errors";
import { json, pathParam, withErrors } from "../v2/http";
import { getDatabasePool } from "../v2/repository-factory";
import { clientAddress, enforceRateLimit } from "../v2/security";
import { baseDeploymentFromEnvironment, RpcBaseChainReader } from "./chain-reader";
import { BaseRewardIssuer, type BaseClaimSigner } from "./issuer";
import { claimSchema, participantInput, participantOrigin } from "./participant-input";
import { ParticipantRecovery } from "./participant-recovery";
import { PostgresParticipantRepository } from "./participant-repository";
import { ReconciledBaseChainReader } from "./reconciled-chain-reader";
import { realUserId } from "./review";
import { counterfactualPolicyFromEnvironment } from "./counterfactual";

export function participantSignerFromEnvironment(): BaseClaimSigner {
  try {
    if (process.env.BASE_CLAIM_ISSUANCE_ENABLED !== "true" || !/^0x[0-9a-fA-F]{64}$/.test(process.env.BASE_ELIGIBILITY_PRIVATE_KEY || "")) throw new Error();
    const account = privateKeyToAccount(process.env.BASE_ELIGIBILITY_PRIVATE_KEY as `0x${string}`);
    return { address: account.address, sign: async (data, signal) => { signal.throwIfAborted(); return account.signTypedData(data); } };
  } catch { throw new AppError(503, "BASE_ISSUANCE_UNAVAILABLE", "Reward signing is not enabled and configured"); }
}

function productionServices(pool: Pool, origin: string) {
  const rpc = new RpcBaseChainReader(baseDeploymentFromEnvironment(), { counterfactual: counterfactualPolicyFromEnvironment() });
  const chain = new ReconciledBaseChainReader(pool, rpc);
  const repository = new PostgresParticipantRepository(pool, chain, rpc, origin, true);
  return { repository, recovery: new ParticipantRecovery(pool, chain), issuer: () => new BaseRewardIssuer(pool, chain, repository, participantSignerFromEnvironment(), true) };
}

async function participantContext(request: Request) {
  if (process.env.BASE_PARTICIPANT_ENABLED !== "true") throw new AppError(404, "NOT_FOUND", "Not found");
  const origin = participantOrigin();
  if (request.method !== "GET") {
    if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new AppError(403, "ORIGIN_REQUIRED", "A same-origin participant request is required");
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      throw new AppError(415, "JSON_REQUIRED", "A JSON request is required");
    }
  }
  const actor = await requireActor(request);
  if (actor.demo) throw new AppError(401, "AUTH_REQUIRED", "A database-backed account is required");
  realUserId(actor.id);
  const read = request.method === "GET";
  await enforceRateLimit(`base-participant:${read ? "read" : "write"}:ip:${clientAddress(request)}`, { limit: read ? 600 : 180, windowMs: 3600000 });
  await enforceRateLimit(`base-participant:${read ? "read" : "write"}:user:${actor.id}`, { limit: read ? 300 : 90, windowMs: 3600000 });
  return { userId: actor.id, pool: getDatabasePool(), origin };
}

// Bound the stream itself: Content-Length is neither required nor trusted.
export async function readParticipantJson(request: Request) {
  const maxBytes = 16 * 1024;
  if (Number(request.headers.get("content-length")) > maxBytes) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Participant request is too large");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "INVALID_JSON", "Request body is required");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new AppError(413, "PAYLOAD_TOO_LARGE", "Participant request is too large"); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
    catch { throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON"); }
  } finally { reader.releaseLock(); }
}

export function createParticipantHandlers(services: typeof productionServices = productionServices) {
  const mutate = (action: "complete" | "challenge" | "consent" | "claim") => withErrors<{ id: string }>(async (request, context) => {
    const { userId, pool, origin } = await participantContext(request);
    const id = await pathParam(context, "id");
    if (action === "complete") await enforceRateLimit(`base-completion:${id}:${userId}`, { limit: 20, windowMs: 3600000 });
    const raw = await readParticipantJson(request);
    const service = services(pool, origin);
    if (action !== "claim") return json(await service.repository[action](userId, id, raw));
    const input = participantInput(claimSchema, raw);
    const recovery = await service.recovery.get(userId, id);
    if (recovery.status === "PAID") return json(recovery);
    return json(await service.issuer().issue({ campaignId: id, userId, ...input }));
  });
  return {
    complete: mutate("complete"), challenge: mutate("challenge"), consent: mutate("consent"), claim: mutate("claim"),
    recovery: withErrors<{ id: string }>(async (request, context) => {
      const { userId, pool, origin } = await participantContext(request);
      return json(await services(pool, origin).recovery.get(userId, await pathParam(context, "id")));
    }),
  };
}
export const participantHandlers = createParticipantHandlers();
