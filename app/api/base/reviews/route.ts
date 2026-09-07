import { reviewContext } from "../../../../src/server/base/review-api";
import { validId } from "../../../../src/server/base/review";
import { json, readJson, withErrors } from "../../../../src/server/v2/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrors(async (request: Request) => {
  const { ownerId, repository } = await reviewContext(request);
  return json({ campaigns: await repository.list(ownerId) });
});

export const POST = withErrors(async (request: Request) => {
  const { ownerId, repository } = await reviewContext(request);
  const key = validId(request.headers.get("idempotency-key") || "");
  return json(await repository.create(ownerId, key, await readJson(request)), 201);
});
