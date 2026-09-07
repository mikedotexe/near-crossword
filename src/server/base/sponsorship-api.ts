import { z } from "zod";
import type { Pool } from "pg";
import { AppError } from "../v2/errors";
import { json, pathParam, withErrors } from "../v2/http";
import { getDatabasePool } from "../v2/repository-factory";
import { clientAddress, enforceRateLimit } from "../v2/security";
import {
  baseDeploymentFromEnvironment,
  RpcBaseChainReader,
} from "./chain-reader";
import { participantContext, readParticipantJson } from "./participant-api";
import { ReconciledBaseChainReader } from "./reconciled-chain-reader";
import { cdpPaymasterUpstream, ClaimSponsorship } from "./sponsorship";
import {
  parseSponsorshipRequest,
  sponsorshipConfigurationFromEnvironment,
  sponsorshipPolicyFromEnvironment,
  sponsorshipUnavailable,
} from "./sponsorship-policy";

type SponsorshipMode = "PROXY" | "CDP_MANAGED";

function productionSponsorship(pool: Pool, mode: SponsorshipMode = "PROXY") {
  const configuration =
    mode === "PROXY"
      ? sponsorshipConfigurationFromEnvironment()
      : { policy: sponsorshipPolicyFromEnvironment(), upstreamUrl: null };
  const rpc = new RpcBaseChainReader(baseDeploymentFromEnvironment());
  return new ClaimSponsorship(
    pool,
    new ReconciledBaseChainReader(pool, rpc),
    rpc,
    configuration.policy,
    configuration.upstreamUrl
      ? cdpPaymasterUpstream(configuration.upstreamUrl)
      : async () => sponsorshipUnavailable(),
  );
}
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "300",
};
function proxyEnabled() {
  if (
    process.env.BASE_PAYMASTER_PROXY_ENABLED !== "true" ||
    process.env.BASE_CDP_MANAGED_PAYMASTER_ENABLED === "true" ||
    process.env.BASE_SPONSORED_GAS_ENABLED !== "true"
  )
    throw new AppError(404, "NOT_FOUND", "Not found");
}
function permitMode(): SponsorshipMode {
  const proxy = process.env.BASE_PAYMASTER_PROXY_ENABLED === "true";
  const managed =
    process.env.BASE_CDP_MANAGED_PAYMASTER_ENABLED === "true";
  if (
    process.env.BASE_SPONSORED_GAS_ENABLED !== "true" ||
    proxy === managed
  )
    throw new AppError(404, "NOT_FOUND", "Not found");
  return managed ? "CDP_MANAGED" : "PROXY";
}
export function createSponsorshipHandlers(
  service: typeof productionSponsorship = productionSponsorship,
) {
  return {
    permit: withErrors<{ id: string }>(async (request, context) => {
      const enabledMode = permitMode();
      const { pool, userId } = await participantContext(request);
      const digest = z.string().regex(/^0x[0-9a-f]{64}$/);
      const body = z
        .union([
          z.object({ digest }).strict(),
          z
            .object({
              digest,
              mode: z.literal("CDP_MANAGED"),
              action: z.literal("RESERVE"),
            })
            .strict(),
          z
            .object({
              digest,
              mode: z.literal("CDP_MANAGED"),
              action: z.literal("REPORT"),
              attemptId: z.string().uuid(),
              outcome: z.enum(["SUBMITTED", "UNKNOWN"]),
              userOperationHash: z
                .string()
                .regex(/^0x[0-9a-fA-F]{64}$/)
                .optional(),
            })
            .strict(),
        ])
        .safeParse(await readParticipantJson(request));
      if (!body.success)
        throw new AppError(
          400,
          "INVALID_PERMIT",
          "A saved reward authorization is required",
        );
      const campaignId = await pathParam(context, "id");
      if (!("mode" in body.data)) {
        if (enabledMode !== "PROXY")
          throw new AppError(404, "NOT_FOUND", "Not found");
        return json(
          await service(pool, "PROXY").permit(
            userId,
            campaignId,
            body.data.digest,
          ),
        );
      }
      if (enabledMode !== "CDP_MANAGED")
        throw new AppError(404, "NOT_FOUND", "Not found");
      if (body.data.action === "RESERVE")
        return json(
          await service(pool, "CDP_MANAGED").reserveManaged(
            userId,
            campaignId,
            body.data.digest,
          ),
        );
      return json(
        await service(pool, "CDP_MANAGED").reportManaged(
          userId,
          campaignId,
          body.data.digest,
          body.data.attemptId,
          body.data.outcome,
          body.data.userOperationHash,
        ),
      );
    }),
    proxy: async (request: Request) => {
      let id: number | string | null = null;
      try {
        proxyEnabled();
        if (
          request.headers
            .get("content-type")
            ?.split(";")[0]
            .trim()
            .toLowerCase() !== "application/json"
        )
          throw new AppError(
            415,
            "JSON_REQUIRED",
            "A JSON request is required",
          );
        await enforceRateLimit(`base-paymaster:ip:${clientAddress(request)}`, {
          limit: 180,
          windowMs: 60000,
        });
        const body = parseSponsorshipRequest(
          await readParticipantJson(request),
        );
        id = body.id;
        return json(
          {
            jsonrpc: "2.0",
            id,
            result: await service(getDatabasePool()).proxy(body),
          },
          200,
          cors,
        );
      } catch (error) {
        // No provider bodies, URLs, context tokens or wallet data are logged or echoed in errors.
        const status = error instanceof AppError ? error.status : 503;
        return json(
          {
            jsonrpc: "2.0",
            id,
            error: {
              code: status >= 500 ? -32000 : -32602,
              message:
                status >= 500
                  ? "Sponsorship unavailable; check recovery before retrying"
                  : "Sponsorship request denied",
            },
          },
          status,
          cors,
        );
      }
    },
    options: async () => {
      try {
        proxyEnabled();
        return new Response(null, {
          status: 204,
          headers: { ...cors, "cache-control": "no-store" },
        });
      } catch {
        return json({ error: "Not found" }, 404);
      }
    },
  };
}
export const sponsorshipHandlers = createSponsorshipHandlers();
