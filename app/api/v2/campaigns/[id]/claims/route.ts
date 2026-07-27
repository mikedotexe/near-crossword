import { json, pathParam, readJson, withErrors } from "../../../../../../src/server/v2/http";
import { getRepository } from "../../../../../../src/server/v2/repository-factory";
import { clientAddress, enforceRateLimit } from "../../../../../../src/server/v2/security";
import { submitClaim } from "../../../../../../src/server/v2/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrors(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  await enforceRateLimit(`claim-submit:${clientAddress(request)}`, {
    limit: 60,
    windowMs: 60 * 60 * 1000,
  });
  const claim = await submitClaim(
    getRepository(),
    await pathParam(context, "id"),
    await readJson(request),
  );
  return json({ claim }, 202);
});
