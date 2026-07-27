import { requireActor } from "../../../../../../src/server/v2/auth";
import { json, pathParam, withErrors } from "../../../../../../src/server/v2/http";
import { getRepository } from "../../../../../../src/server/v2/repository-factory";
import { getCampaignLifecycleStatus } from "../../../../../../src/server/v2/services";
import {
  canRevealExternalFundingDeposit,
  maskFundingOrderUntilAuthorization,
} from "../../../../../../src/server/v2/external-funding-authorization";
import {
  clientAddress,
  enforceRateLimit,
} from "../../../../../../src/server/v2/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrors(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  await enforceRateLimit(`campaign-status:${clientAddress(request)}`, {
    limit: 60,
    windowMs: 60_000,
  });
  const actor = await requireActor(request);
  const status = await getCampaignLifecycleStatus(
    getRepository(),
    actor,
    await pathParam(context, "id"),
  );
  if (status.fundingOrder?.rail !== "ONE_CLICK") {
    return json({
      ...status,
      authorizationRequired: false,
      quoteExpired: false,
    });
  }
  const contractId = status.campaign.contractId;
  const quoteExpired =
    new Date(status.fundingOrder.expiresAt).getTime() <= Date.now();
  const canReveal =
    Boolean(contractId) &&
    canRevealExternalFundingDeposit(
      status.fundingOrder,
      contractId!,
    );
  return json({
    ...status,
    fundingOrder: canReveal
      ? status.fundingOrder
      : maskFundingOrderUntilAuthorization(status.fundingOrder),
    authorizationRequired: !canReveal && !quoteExpired,
    quoteExpired,
  });
});
