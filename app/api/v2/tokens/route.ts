import { json, withErrors } from "../../../../src/server/v2/http";
import {
  getEscrowAssetConfiguration,
  getTokenCatalog,
} from "../../../../src/server/v2/token-catalog";
import {
  clientAddress,
  enforceRateLimit,
} from "../../../../src/server/v2/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrors(async (request) => {
  await enforceRateLimit(`token-catalog:${clientAddress(request)}`, {
    limit: 60,
    windowMs: 60_000,
  });
  const tokens = (await getTokenCatalog()).map((token) => ({
    assetId: token.assetId,
    symbol: token.symbol,
    decimals: token.decimals,
    network: token.blockchain,
    contractAddress: token.contractAddress,
  }));
  return json(
    {
      escrowAsset: getEscrowAssetConfiguration(),
      tokens,
    },
    200,
    { "cache-control": "public, max-age=60, stale-while-revalidate=240" },
  );
});
