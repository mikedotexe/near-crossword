import type { WalletConfiguration } from "../../lib/base/account";

export function walletConfiguration(): WalletConfiguration {
  const enabled = process.env.BASE_ACCOUNT_ENABLED === "true";
  // This is a public, independently reviewed proxy URL, NEVER the keyed CDP endpoint.
  // The proxy must enforce claim-only sponsorship and provider budget/allowlist policy.
  try {
    const url = new URL(process.env.BASE_SPONSORED_CLAIM_PROXY_URL || "");
    if (
      !enabled ||
      process.env.BASE_SPONSORED_GAS_ENABLED !== "true" ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.hostname === "api.developer.coinbase.com"
    )
      throw new Error();
    return { enabled, sponsoredGas: true, proxyUrl: url.href };
  } catch {
    return { enabled, sponsoredGas: false, proxyUrl: null };
  }
}
