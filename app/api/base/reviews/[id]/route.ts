import { parseReviewUpdate, reviewContext } from "../../../../../src/server/base/review-api";
import { json, pathParam, readJson, withErrors, type RouteContext } from "../../../../../src/server/v2/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrors(async (request: Request, context: RouteContext<{ id: string }>) => {
  const { ownerId, repository } = await reviewContext(request);
  return json(await repository.get(ownerId, await pathParam(context, "id")));
});

export const PUT = withErrors(async (request: Request, context: RouteContext<{ id: string }>) => {
  const { ownerId, repository } = await reviewContext(request);
  const update = parseReviewUpdate(await readJson(request));
  return json(await repository.revise(ownerId, await pathParam(context, "id"), update.expectedRevision, update.submission));
});
