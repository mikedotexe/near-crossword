import { requireActor } from "../../../../../../src/server/v2/auth";
import { clientAddress, enforceRateLimit } from "../../../../../../src/server/v2/security";
import {
  json,
  pathParam,
  readJson,
  withErrors,
} from "../../../../../../src/server/v2/http";
import { getRepository } from "../../../../../../src/server/v2/repository-factory";
import { createFundingQuote } from "../../../../../../src/server/v2/services";
import { maskFundingOrderUntilAuthorization } from "../../../../../../src/server/v2/external-funding-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrors(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  await enforceRateLimit(`funding:${clientAddress(request)}`, {
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  const actor = await requireActor(request);
  const fundingOrder = await createFundingQuote(
    getRepository(),
    actor,
    await pathParam(context, "id"),
    await readJson(request),
  );
  if (fundingOrder.rail === "ONE_CLICK") {
    return json(
      {
        fundingOrder: maskFundingOrderUntilAuthorization(fundingOrder),
        authorizationRequired: true,
      },
      201,
    );
  }
  return json({ fundingOrder, authorizationRequired: false }, 201);
});
