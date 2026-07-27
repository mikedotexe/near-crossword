import { AppError } from "../../../../../src/server/v2/errors";
import { json, pathParam, withErrors } from "../../../../../src/server/v2/http";
import { getRepository } from "../../../../../src/server/v2/repository-factory";
import { publicClaimView } from "../../../../../src/server/v2/public-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrors(async (
  _request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  const claim = await getRepository().getClaim(await pathParam(context, "id"));
  if (!claim) throw new AppError(404, "CLAIM_NOT_FOUND", "Claim not found");
  return json({ claim: publicClaimView(claim) });
});
