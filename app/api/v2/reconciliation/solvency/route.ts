import { json, withErrors } from "../../../../../src/server/v2/http";
import { getRepository } from "../../../../../src/server/v2/repository-factory";
import {
  clientAddress,
  enforceRateLimit,
} from "../../../../../src/server/v2/security";
import { reconcileSolvency } from "../../../../../src/server/v2/transparency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrors(async (request: Request) => {
  await enforceRateLimit(`solvency-evidence:${clientAddress(request)}`, {
    limit: 30,
    windowMs: 60_000,
  });
  const reconciliation = await reconcileSolvency(getRepository());
  return json(
    { reconciliation },
    200,
    { "cache-control": "public, max-age=15, stale-while-revalidate=45" },
  );
});
