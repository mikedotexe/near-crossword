import { requireActor } from "../../../../../src/server/v2/auth";
import { AppError } from "../../../../../src/server/v2/errors";
import { json, pathParam, withErrors } from "../../../../../src/server/v2/http";
import { getRepository } from "../../../../../src/server/v2/repository-factory";
import { refreshFundingOrder } from "../../../../../src/server/v2/services";
import {
  clientAddress,
  enforceRateLimit,
} from "../../../../../src/server/v2/security";
import {
  canRevealExternalFundingDeposit,
  maskFundingOrderUntilAuthorization,
} from "../../../../../src/server/v2/external-funding-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrors(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  await enforceRateLimit(`funding-status:${clientAddress(request)}`, {
    limit: 60,
    windowMs: 60_000,
  });
  const actor = await requireActor(request);
  const repository = getRepository();
  const id = await pathParam(context, "id");
  const refresh = new URL(request.url).searchParams.get("refresh") === "true";
  const fundingOrder = refresh
    ? await refreshFundingOrder(repository, actor, id)
    : await repository.getFundingOrder(id);
  if (!fundingOrder) {
    throw new AppError(404, "FUNDING_ORDER_NOT_FOUND", "Funding order not found");
  }
  if (fundingOrder.creatorId !== actor.id) {
    throw new AppError(403, "FORBIDDEN", "Only the creator can inspect this funding order");
  }
  if (fundingOrder.rail === "ONE_CLICK") {
    const campaign = await repository.getCampaign(fundingOrder.campaignId);
    const revealed =
      campaign?.contractId &&
      canRevealExternalFundingDeposit(
        fundingOrder,
        campaign.contractId,
      );
    if (!revealed) {
      const quoteExpired =
        new Date(fundingOrder.expiresAt).getTime() <= Date.now();
      return json({
        fundingOrder: maskFundingOrderUntilAuthorization(fundingOrder),
        authorizationRequired: !quoteExpired,
        quoteExpired,
      });
    }
  }
  return json({
    fundingOrder,
    authorizationRequired: false,
    quoteExpired: false,
  });
});
