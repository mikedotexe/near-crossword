import { parseReviewApproval, reviewContext } from "../../../../../../src/server/base/review-api";
import { json, pathParam, readJson, withErrors, type RouteContext } from "../../../../../../src/server/v2/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrors(async (request: Request, context: RouteContext<{ id: string }>) => {
  const { ownerId, repository } = await reviewContext(request);
  const approval = parseReviewApproval(await readJson(request));
  return json(await repository.approve(ownerId, await pathParam(context, "id"), approval.revision, approval.reviewHash, approval.termsHash));
});
