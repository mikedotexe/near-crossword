import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { nearChainConfigFromEnvironment } from "./near-client";

const names = [
  "NODE_ENV",
  "V2_NEAR_NETWORK",
  "NEXT_PUBLIC_NEAR_NETWORK",
  "V2_CONTRACT_ID",
  "V2_USDC_ASSET_ID",
  "V2_USDC_CONTRACT_ID",
  "V2_OPERATOR_ACCOUNT_ID",
  "V2_OPERATOR_PRIVATE_KEY",
  "NEAR_ACCOUNT_ID",
  "NEAR_PRIVATE_KEY",
] as const;

const original = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
) as Record<(typeof names)[number], string | undefined>;

beforeEach(() => {
  const environment = process.env as Record<string, string | undefined>;
  environment.NODE_ENV = "test";
  environment.V2_NEAR_NETWORK = "testnet";
  delete environment.NEXT_PUBLIC_NEAR_NETWORK;
  environment.V2_CONTRACT_ID = "campaigns-v2.testnet";
  environment.V2_USDC_ASSET_ID = "nep141:usdc.testnet";
  environment.V2_USDC_CONTRACT_ID = "usdc.testnet";
  delete environment.V2_OPERATOR_ACCOUNT_ID;
  delete environment.V2_OPERATOR_PRIVATE_KEY;
  environment.NEAR_ACCOUNT_ID = "legacy-operator.testnet";
  environment.NEAR_PRIVATE_KEY = `ed25519:${"L".repeat(64)}`;
});

afterEach(() => {
  const environment = process.env as Record<string, string | undefined>;
  for (const name of names) {
    const value = original[name];
    if (value === undefined) delete environment[name];
    else environment[name] = value;
  }
});

describe("v2 chain signer configuration", () => {
  it("never falls back to legacy NEAR account or private-key variables", () => {
    assert.throws(
      () => nearChainConfigFromEnvironment(),
      /V2_OPERATOR_ACCOUNT_ID is required/,
    );
    process.env.V2_OPERATOR_ACCOUNT_ID = "v2-operator.testnet";
    assert.throws(
      () => nearChainConfigFromEnvironment(),
      /V2_OPERATOR_PRIVATE_KEY is required/,
    );

    process.env.V2_OPERATOR_PRIVATE_KEY = `ed25519:${"V".repeat(64)}`;
    const config = nearChainConfigFromEnvironment();
    assert.equal(config.operatorAccountId, "v2-operator.testnet");
    assert.equal(config.operatorPrivateKey, process.env.V2_OPERATOR_PRIVATE_KEY);
  });
});
