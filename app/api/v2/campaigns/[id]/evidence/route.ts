import {
  json,
  pathParam,
  withErrors,
} from "../../../../../../src/server/v2/http";
import { getRepository } from "../../../../../../src/server/v2/repository-factory";
import {
  clientAddress,
  enforceRateLimit,
} from "../../../../../../src/server/v2/security";
import { getCampaignEvidence } from "../../../../../../src/server/v2/transparency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrors(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  await enforceRateLimit(`campaign-evidence:${clientAddress(request)}`, {
    limit: 60,
    windowMs: 60_000,
  });
  const evidence = await getCampaignEvidence(
    getRepository(),
    await pathParam(context, "id"),
  );
  return json(
    { evidence },
    200,
    { "cache-control": "public, max-age=15, stale-while-revalidate=45" },
  );
});
