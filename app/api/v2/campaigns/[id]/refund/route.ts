import {
  anonymousActorId,
  optionalActor,
} from "../../../../../../src/server/v2/auth";
import {
  json,
  pathParam,
  readJson,
  withErrors,
} from "../../../../../../src/server/v2/http";
import { getRepository } from "../../../../../../src/server/v2/repository-factory";
import {
  clientAddress,
  enforceRateLimit,
} from "../../../../../../src/server/v2/security";
import { requestExpiredCampaignRefund } from "../../../../../../src/server/v2/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrors(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  await enforceRateLimit(`campaign-refund:${clientAddress(request)}`, {
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });
  const actor = (await optionalActor(request)) ?? {
    id: anonymousActorId(request),
    email: null,
    demo: false,
  };
  const campaign = await requestExpiredCampaignRefund(
    getRepository(),
    actor,
    await pathParam(context, "id"),
    await readJson(request),
  );
  return json({ campaign }, 202);
});
