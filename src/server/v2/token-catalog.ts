import { AppError } from "./errors";
import { escrowAsset, isExplicitMockMode, ONE_CLICK_BASE_URL } from "./config";
import type { TokenCatalogItem } from "./types";

interface Cache {
  tokens: TokenCatalogItem[];
  expiresAt: number;
}

let cache: Cache | null = null;

const demoTokens: TokenCatalogItem[] = [
  {
    assetId: "nep141:mock-usdc.testnet",
    symbol: "USDC",
    decimals: 6,
    blockchain: "near",
    contractAddress: "mock-usdc.testnet",
    price: 1,
    priceUpdatedAt: null,
  },
  {
    assetId: "nep141:wrap.testnet",
    symbol: "wNEAR",
    decimals: 24,
    blockchain: "near",
    contractAddress: "wrap.testnet",
    price: null,
    priceUpdatedAt: null,
  },
  {
    assetId: "nep141:eth.mock-usdc.testnet",
    symbol: "USDC",
    decimals: 6,
    blockchain: "eth",
    contractAddress: null,
    price: 1,
    priceUpdatedAt: null,
  },
];

export async function getTokenCatalog(
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<TokenCatalogItem[]> {
  if (isExplicitMockMode()) return structuredClone(demoTokens);
  if (cache && cache.expiresAt > now) return structuredClone(cache.tokens);
  let response: Response;
  try {
    response = await fetcher(`${ONE_CLICK_BASE_URL}/tokens`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
  } catch {
    if (cache) return structuredClone(cache.tokens);
    throw new AppError(503, "TOKEN_CATALOG_UNAVAILABLE", "Token catalog is unavailable");
  }
  if (!response.ok) {
    if (cache) return structuredClone(cache.tokens);
    throw new AppError(503, "TOKEN_CATALOG_UNAVAILABLE", "Token catalog is unavailable");
  }
  const body = await response.json();
  if (!Array.isArray(body)) {
    throw new AppError(502, "INVALID_PROVIDER_RESPONSE", "Token catalog response is invalid");
  }
  const tokens = body.flatMap((value): TokenCatalogItem[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (
      typeof item.assetId !== "string" ||
      typeof item.symbol !== "string" ||
      !Number.isInteger(item.decimals) ||
      typeof item.blockchain !== "string"
    ) {
      return [];
    }
    return [
      {
        assetId: item.assetId,
        symbol: item.symbol,
        decimals: item.decimals as number,
        blockchain: item.blockchain,
        contractAddress:
          typeof item.contractAddress === "string" ? item.contractAddress : null,
        price: typeof item.price === "number" && Number.isFinite(item.price) ? item.price : null,
        priceUpdatedAt:
          typeof item.priceUpdatedAt === "string" ? item.priceUpdatedAt : null,
      },
    ];
  });
  if (tokens.length === 0) {
    throw new AppError(502, "INVALID_PROVIDER_RESPONSE", "Token catalog was empty");
  }
  cache = { tokens, expiresAt: now + 5 * 60 * 1000 };
  return structuredClone(tokens);
}

export function getEscrowAssetConfiguration() {
  return escrowAsset();
}

export function resetTokenCatalogForTests(): void {
  cache = null;
}
