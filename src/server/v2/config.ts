import { AppError } from "./errors";

export const ONE_CLICK_BASE_URL = "https://1click.chaindefuser.com/v0";
export type V2NearNetwork = "mainnet" | "testnet";

export function isExplicitMockMode(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.V2_FUNDING_MODE === "mock";
}

export function requireProductionConfiguration(): void {
  if (process.env.NODE_ENV !== "production") return;
  const missing = [
    "DATABASE_URL",
    "NEXT_PUBLIC_APP_URL",
    "NEXTAUTH_URL",
    "NEXTAUTH_SECRET",
    "RESEND_API_KEY",
    "V2_CONTRACT_ID",
    "V2_USDC_ASSET_ID",
    "V2_USDC_CONTRACT_ID",
    "V2_NEAR_NETWORK",
    "NEXT_PUBLIC_NEAR_NETWORK",
    "NEXT_PUBLIC_V2_CONTRACT_ID",
    "NEXT_PUBLIC_V2_USDC_CONTRACT_ID",
    "V2_TRUSTED_CLIENT_IP_HEADER",
  ].filter((name) => !process.env[name]);
  if (missing.length) {
    throw new AppError(
      503,
      "SERVICE_NOT_CONFIGURED",
      `Crossword Campaigns v2 is missing required configuration: ${missing.join(", ")}`,
    );
  }
  v2NearNetwork();
  if (process.env.NEXT_PUBLIC_V2_CONTRACT_ID !== process.env.V2_CONTRACT_ID) {
    throw new AppError(
      503,
      "SERVICE_NOT_CONFIGURED",
      "NEXT_PUBLIC_V2_CONTRACT_ID must match V2_CONTRACT_ID",
    );
  }
  if (
    process.env.NEXT_PUBLIC_V2_USDC_CONTRACT_ID !==
    process.env.V2_USDC_CONTRACT_ID
  ) {
    throw new AppError(
      503,
      "SERVICE_NOT_CONFIGURED",
      "NEXT_PUBLIC_V2_USDC_CONTRACT_ID must match V2_USDC_CONTRACT_ID",
    );
  }
  for (const name of ["NEXT_PUBLIC_APP_URL", "NEXTAUTH_URL"] as const) {
    let url: URL;
    try {
      url = new URL(process.env[name]!);
    } catch {
      throw new AppError(
        503,
        "SERVICE_NOT_CONFIGURED",
        `${name} must be an absolute HTTPS URL`,
      );
    }
    if (url.protocol !== "https:") {
      throw new AppError(
        503,
        "SERVICE_NOT_CONFIGURED",
        `${name} must use HTTPS in production`,
      );
    }
  }
  if (process.env.V2_NEAR_RPC_URL) {
    let rpcUrl: URL;
    try {
      rpcUrl = new URL(process.env.V2_NEAR_RPC_URL);
    } catch {
      throw new AppError(
        503,
        "SERVICE_NOT_CONFIGURED",
        "V2_NEAR_RPC_URL must be an absolute HTTPS URL",
      );
    }
    if (rpcUrl.protocol !== "https:") {
      throw new AppError(
        503,
        "SERVICE_NOT_CONFIGURED",
        "V2_NEAR_RPC_URL must use HTTPS in production",
      );
    }
  }
  const trustedClientHeader =
    process.env.V2_TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (
    !trustedClientHeader ||
    ![
      "cf-connecting-ip",
      "fly-client-ip",
      "true-client-ip",
      "x-real-ip",
      "x-forwarded-for",
    ].includes(trustedClientHeader)
  ) {
    throw new AppError(
      503,
      "SERVICE_NOT_CONFIGURED",
      "V2_TRUSTED_CLIENT_IP_HEADER must name a supported header overwritten by the trusted ingress",
    );
  }
}

function configuredNearNetwork(
  value: string | undefined,
  name: string,
): V2NearNetwork | undefined {
  if (!value) return undefined;
  if (value !== "mainnet" && value !== "testnet") {
    throw new AppError(
      503,
      "INVALID_NEAR_NETWORK",
      `${name} must be either mainnet or testnet`,
    );
  }
  return value;
}

export function v2NearNetwork(): V2NearNetwork {
  const explicit = configuredNearNetwork(
    process.env.V2_NEAR_NETWORK,
    "V2_NEAR_NETWORK",
  );
  const browser = configuredNearNetwork(
    process.env.NEXT_PUBLIC_NEAR_NETWORK,
    "NEXT_PUBLIC_NEAR_NETWORK",
  );
  if (explicit && browser && explicit !== browser) {
    throw new AppError(
      503,
      "NEAR_NETWORK_MISMATCH",
      "V2_NEAR_NETWORK must match NEXT_PUBLIC_NEAR_NETWORK",
    );
  }
  if (process.env.NODE_ENV === "production" && (!explicit || !browser)) {
    throw new AppError(
      503,
      "NEAR_NETWORK_NOT_CONFIGURED",
      "V2_NEAR_NETWORK and NEXT_PUBLIC_NEAR_NETWORK are required in production",
    );
  }
  return (
    explicit ??
    browser ??
    "testnet"
  );
}

export interface EscrowAsset {
  assetId: string;
  contractId: string;
  symbol: "USDC";
  decimals: number;
  mock: boolean;
}

export function escrowAsset(): EscrowAsset {
  const assetId = process.env.V2_USDC_ASSET_ID;
  const contractId = process.env.V2_USDC_CONTRACT_ID;
  if (assetId && contractId) {
    return { assetId, contractId, symbol: "USDC", decimals: 6, mock: false };
  }
  if (isExplicitMockMode()) {
    return {
      assetId: "nep141:mock-usdc.testnet",
      contractId: "mock-usdc.testnet",
      symbol: "USDC",
      decimals: 6,
      mock: true,
    };
  }
  throw new AppError(
    503,
    "ESCROW_ASSET_NOT_CONFIGURED",
    "V2_USDC_ASSET_ID and V2_USDC_CONTRACT_ID are required",
  );
}

export function campaignContractId(): string {
  const configured = process.env.V2_CONTRACT_ID;
  if (configured) return configured;
  if (isExplicitMockMode()) return "crossword-campaigns-v2.testnet";
  throw new AppError(503, "CONTRACT_NOT_CONFIGURED", "V2_CONTRACT_ID is required");
}

export function oneClickJwt(): string | undefined {
  return process.env.ONE_CLICK_JWT || process.env.ONECLICK_JWT;
}
