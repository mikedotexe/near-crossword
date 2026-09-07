import assert from "node:assert/strict";
import { test } from "node:test";
import { walletConfiguration } from "./wallet-configuration";

const keys = [
  "BASE_ACCOUNT_ENABLED",
  "CDP_PARTICIPANT_AUTH_ENABLED",
  "NEXT_PUBLIC_CDP_PROJECT_ID",
  "BASE_SPONSORED_GAS_ENABLED",
  "BASE_PAYMASTER_POLICY_REVIEWED",
  "BASE_CHAIN_ID",
  "BASE_CDP_MANAGED_PAYMASTER_ENABLED",
  "BASE_PAYMASTER_PROXY_ENABLED",
  "BASE_SPONSORED_CLAIM_PROXY_URL",
];

test("wallet configuration selects one reviewed managed or proxy sponsorship mode", () => {
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      BASE_ACCOUNT_ENABLED: "true",
      CDP_PARTICIPANT_AUTH_ENABLED: "true",
      NEXT_PUBLIC_CDP_PROJECT_ID: "project",
      BASE_SPONSORED_GAS_ENABLED: "true",
      BASE_PAYMASTER_POLICY_REVIEWED: "true",
      BASE_CHAIN_ID: "84532",
      BASE_CDP_MANAGED_PAYMASTER_ENABLED: "true",
      BASE_PAYMASTER_PROXY_ENABLED: "false",
      BASE_SPONSORED_CLAIM_PROXY_URL: "",
    });
    assert.deepEqual(walletConfiguration(), {
      enabled: true,
      sponsoredGas: true,
      proxyUrl: null,
    });
    process.env.BASE_PAYMASTER_PROXY_ENABLED = "true";
    assert.deepEqual(walletConfiguration(), {
      enabled: true,
      sponsoredGas: false,
      proxyUrl: null,
    });
    process.env.BASE_CDP_MANAGED_PAYMASTER_ENABLED = "false";
    process.env.BASE_SPONSORED_CLAIM_PROXY_URL =
      "https://sponsorship.example.test/claim";
    assert.deepEqual(walletConfiguration(), {
      enabled: true,
      sponsoredGas: true,
      proxyUrl: "https://sponsorship.example.test/claim",
    });
    process.env.BASE_CHAIN_ID = "8453";
    assert.equal(walletConfiguration().sponsoredGas, false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
