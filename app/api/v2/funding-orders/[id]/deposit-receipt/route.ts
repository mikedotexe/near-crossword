import { requireActor } from "../../../../../../src/server/v2/auth";
import { recordDirectFundingReceipt } from "../../../../../../src/server/v2/chain/direct-funding-receipt";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrors(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  await enforceRateLimit(`direct-receipt:${clientAddress(request)}`, {
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  const actor = await requireActor(request);
  const fundingOrder = await recordDirectFundingReceipt(
    getRepository(),
    actor,
    await pathParam(context, "id"),
    await readJson(request, 4 * 1024),
  );
  return json({ fundingOrder });
});
