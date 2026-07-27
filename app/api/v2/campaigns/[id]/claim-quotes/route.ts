import {
  anonymousActorId,
  optionalActor,
} from "../../../../../../src/server/v2/auth";
import { json, pathParam, readJson, withErrors } from "../../../../../../src/server/v2/http";
import { getRepository } from "../../../../../../src/server/v2/repository-factory";
import { clientAddress, enforceRateLimit } from "../../../../../../src/server/v2/security";
import { createClaimQuote } from "../../../../../../src/server/v2/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrors(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  await enforceRateLimit(`claim-quote:${clientAddress(request)}`, {
    limit: 30,
    windowMs: 60 * 60 * 1000,
  });
  const actor = await optionalActor(request);
  const view = await createClaimQuote(
    getRepository(),
    actor?.id ?? anonymousActorId(request),
    await pathParam(context, "id"),
    await readJson(request),
  );
  return json(
    {
      claim: {
        ...view.claim,
        payoutDigest: view.payoutDigest,
        nonce: view.nonce,
        deadlineMs: view.deadlineMs,
        receiverId: view.receiverId,
        escrowPrincipalAmount: view.escrowPrincipalAmount,
        estimatedDeliveryAmount: view.estimatedDeliveryAmount,
        estimatedDeliveryAsset: view.estimatedDeliveryAsset,
      },
    },
    201,
  );
});
