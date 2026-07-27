export interface CatalogPayoutAsset {
  assetId: string;
  symbol: string;
  network: string;
  label?: string;
}

/**
 * Keeps provider asset identifiers opaque. They are never synthesized from a
 * display symbol/network pair because 1Click quotes require the exact catalog
 * asset id.
 */
export function payoutAssetsFromCatalog<T extends CatalogPayoutAsset>(
  tokens: readonly T[],
  escrowAssetId: string,
): T[] {
  const seen = new Set<string>();
  return tokens.filter((token) => {
    if (!token.assetId || token.assetId === escrowAssetId) return false;
    if (seen.has(token.assetId)) return false;
    seen.add(token.assetId);
    return true;
  });
}

export function payoutAssetLabel(asset: CatalogPayoutAsset): string {
  return asset.label?.trim() || `${asset.symbol} on ${asset.network}`;
}
