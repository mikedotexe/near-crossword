import { requireActor } from "../../../../src/server/v2/auth";
import { AppError } from "../../../../src/server/v2/errors";
import { getRepository } from "../../../../src/server/v2/repository-factory";
import {
  campaignStatus,
  createCampaign,
} from "../../../../src/server/v2/services";
import { json, readJson, withErrors } from "../../../../src/server/v2/http";
import {
  clientAddress,
  enforceRateLimit,
} from "../../../../src/server/v2/security";
import { publicCampaignView } from "../../../../src/server/v2/public-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrors(async (request) => {
  const repository = getRepository();
  const url = new URL(request.url);
  const mine = url.searchParams.get("mine") === "true";
  const actor = mine ? await requireActor(request) : null;
  const requestedStatus = campaignStatus(url.searchParams.get("status"));
  if (!mine && requestedStatus && ["DRAFT", "FUNDING"].includes(requestedStatus)) {
    // Private workflow states are creator-only and must not be enumerable,
    // including when the caller happens to have an unrelated session.
    throw new AppError(404, "CAMPAIGNS_NOT_FOUND", "Campaigns not found");
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 24), 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
  const result = await repository.listCampaigns({
    creatorId: mine ? actor!.id : undefined,
    status: requestedStatus,
    statuses:
      requestedStatus || mine ? undefined : ["SCHEDULED", "ACTIVE"],
    visibility: mine ? undefined : "PUBLIC",
    limit: Number.isFinite(limit) ? limit : 24,
    offset: Number.isFinite(offset) ? offset : 0,
  });
  return json(
    mine
      ? result
      : {
          ...result,
          campaigns: result.campaigns.map(publicCampaignView),
        },
  );
});

export const POST = withErrors(async (request) => {
  await enforceRateLimit(`campaign-create:${clientAddress(request)}`, {
    limit: 30,
    windowMs: 60 * 60 * 1000,
  });
  const actor = await requireActor(request);
  const repository = getRepository();
  const campaign = await createCampaign(repository, actor, await readJson(request));
  return json({ campaign }, 201);
});
