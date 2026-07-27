import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { requireProductionConfiguration, v2NearNetwork } from "./config";

const managedEnvironmentNames = [
  "NODE_ENV",
  "V2_NEAR_NETWORK",
  "NEXT_PUBLIC_NEAR_NETWORK",
  "NEAR_NETWORK",
  "DATABASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "RESEND_API_KEY",
  "V2_CONTRACT_ID",
  "V2_USDC_ASSET_ID",
  "V2_USDC_CONTRACT_ID",
  "NEXT_PUBLIC_V2_CONTRACT_ID",
  "NEXT_PUBLIC_V2_USDC_CONTRACT_ID",
  "V2_TRUSTED_CLIENT_IP_HEADER",
  "V2_NEAR_RPC_URL",
] as const;

const originalEnvironment = Object.fromEntries(
  managedEnvironmentNames.map((name) => [name, process.env[name]]),
) as Record<(typeof managedEnvironmentNames)[number], string | undefined>;

afterEach(() => {
  const environment = process.env as Record<string, string | undefined>;
  for (const name of managedEnvironmentNames) {
    const value = originalEnvironment[name];
    if (value === undefined) delete environment[name];
    else environment[name] = value;
  }
});

function configureValidProductionEnvironment(): void {
  Object.assign(process.env, {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://campaigns.example.invalid/database",
    NEXT_PUBLIC_APP_URL: "https://crossword.example",
    NEXTAUTH_URL: "https://crossword.example",
    NEXTAUTH_SECRET: "test-only-secret",
    RESEND_API_KEY: "test-only-resend-key",
    V2_CONTRACT_ID: "campaigns.near",
    V2_USDC_ASSET_ID: "nep141:usdc.near",
    V2_USDC_CONTRACT_ID: "usdc.near",
    V2_NEAR_NETWORK: "mainnet",
    NEXT_PUBLIC_NEAR_NETWORK: "mainnet",
    NEXT_PUBLIC_V2_CONTRACT_ID: "campaigns.near",
    NEXT_PUBLIC_V2_USDC_CONTRACT_ID: "usdc.near",
    V2_TRUSTED_CLIENT_IP_HEADER: "cf-connecting-ip",
  });
  delete process.env.V2_NEAR_RPC_URL;
}

describe("v2 NEAR network configuration", () => {
  it("defaults local development to testnet instead of mainnet", () => {
    const environment = process.env as Record<string, string | undefined>;
    environment.NODE_ENV = "development";
    delete environment.V2_NEAR_NETWORK;
    delete environment.NEXT_PUBLIC_NEAR_NETWORK;
    environment.NEAR_NETWORK = "mainnet";
    assert.equal(v2NearNetwork(), "testnet");
  });

  it("rejects a server/browser network mismatch", () => {
    process.env.V2_NEAR_NETWORK = "mainnet";
    process.env.NEXT_PUBLIC_NEAR_NETWORK = "testnet";
    assert.throws(
      () => v2NearNetwork(),
      /V2_NEAR_NETWORK must match NEXT_PUBLIC_NEAR_NETWORK/,
    );
  });

  it("requires the explicit network in production", () => {
    const environment = process.env as Record<string, string | undefined>;
    environment.NODE_ENV = "production";
    delete environment.V2_NEAR_NETWORK;
    environment.NEXT_PUBLIC_NEAR_NETWORK = "testnet";
    assert.throws(
      () => v2NearNetwork(),
      /V2_NEAR_NETWORK and NEXT_PUBLIC_NEAR_NETWORK are required/,
    );
  });

  it("requires the browser network in production", () => {
    const environment = process.env as Record<string, string | undefined>;
    environment.NODE_ENV = "production";
    environment.V2_NEAR_NETWORK = "mainnet";
    delete environment.NEXT_PUBLIC_NEAR_NETWORK;
    assert.throws(
      () => v2NearNetwork(),
      /NEXT_PUBLIC_NEAR_NETWORK are required/,
    );
  });

  it("accepts a fully pinned production configuration", () => {
    configureValidProductionEnvironment();
    assert.doesNotThrow(() => requireProductionConfiguration());
  });

  it("rejects a public campaign contract that differs from the server pin", () => {
    configureValidProductionEnvironment();
    process.env.NEXT_PUBLIC_V2_CONTRACT_ID = "attacker.near";
    assert.throws(
      () => requireProductionConfiguration(),
      /NEXT_PUBLIC_V2_CONTRACT_ID must match V2_CONTRACT_ID/,
    );
  });

  it("rejects a public token contract that differs from the server pin", () => {
    configureValidProductionEnvironment();
    process.env.NEXT_PUBLIC_V2_USDC_CONTRACT_ID = "wrong-token.near";
    assert.throws(
      () => requireProductionConfiguration(),
      /NEXT_PUBLIC_V2_USDC_CONTRACT_ID must match V2_USDC_CONTRACT_ID/,
    );
  });

  it("rejects an insecure custom production RPC URL", () => {
    configureValidProductionEnvironment();
    process.env.V2_NEAR_RPC_URL = "http://rpc.example";
    assert.throws(
      () => requireProductionConfiguration(),
      /V2_NEAR_RPC_URL must use HTTPS/,
    );
  });
});
