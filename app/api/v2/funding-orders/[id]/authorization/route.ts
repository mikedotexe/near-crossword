import { requireActor } from "../../../../../../src/server/v2/auth";
import {
  verifyExternalFundingAuthorization,
} from "../../../../../../src/server/v2/external-funding-authorization";
import { json, pathParam, withErrors } from "../../../../../../src/server/v2/http";
import { getRepository } from "../../../../../../src/server/v2/repository-factory";
import {
  clientAddress,
  enforceRateLimit,
} from "../../../../../../src/server/v2/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrors(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  await enforceRateLimit(`funding-authorization:${clientAddress(request)}`, {
    limit: 30,
    windowMs: 60 * 60 * 1000,
  });
  const actor = await requireActor(request);
  const response = await verifyExternalFundingAuthorization(
    getRepository(),
    actor,
    await pathParam(context, "id"),
  );
  return json(response);
});
