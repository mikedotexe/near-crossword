import { optionalActor, requireActor } from "../../../../../src/server/v2/auth";
import { AppError } from "../../../../../src/server/v2/errors";
import {
  json,
  pathParam,
  readJson,
  withErrors,
} from "../../../../../src/server/v2/http";
import { getRepository } from "../../../../../src/server/v2/repository-factory";
import {
  patchCampaign,
  requireCampaign,
} from "../../../../../src/server/v2/services";
import {
  clientAddress,
  enforceRateLimit,
} from "../../../../../src/server/v2/security";
import { publicCampaignView } from "../../../../../src/server/v2/public-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrors(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  const repository = getRepository();
  const campaign = await requireCampaign(repository, await pathParam(context, "id"));
  if (["DRAFT", "FUNDING"].includes(campaign.status)) {
    const actor = await optionalActor(request);
    if (!actor || actor.id !== campaign.creatorId) {
      throw new AppError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
    }
    return json({ campaign });
  }
  return json({ campaign: publicCampaignView(campaign) });
});

export const PATCH = withErrors(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  await enforceRateLimit(`campaign-patch:${clientAddress(request)}`, {
    limit: 120,
    windowMs: 60 * 60 * 1000,
  });
  const actor = await requireActor(request);
  const repository = getRepository();
  const campaign = await patchCampaign(
    repository,
    actor,
    await pathParam(context, "id"),
    await readJson(request),
  );
  return json({ campaign });
});
