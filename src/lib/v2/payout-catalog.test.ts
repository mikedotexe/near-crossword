import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  payoutAssetLabel,
  payoutAssetsFromCatalog,
} from "./payout-catalog";

describe("live 1Click payout catalog", () => {
  it("preserves opaque provider asset ids and removes escrow/duplicates", () => {
    const tokens = [
      {
        assetId: "nep141:usdc.near",
        symbol: "USDC",
        network: "near",
      },
      {
        assetId:
          "nep141:arb-0xaf88d065e77c8cC2239327C5EDb3A432268e5831.omft.near",
        symbol: "USDC",
        network: "arbitrum",
      },
      {
        assetId:
          "nep141:arb-0xaf88d065e77c8cC2239327C5EDb3A432268e5831.omft.near",
        symbol: "USDC",
        network: "arbitrum",
      },
    ];
    const options = payoutAssetsFromCatalog(tokens, "nep141:usdc.near");

    assert.deepEqual(options.map((token) => token.assetId), [
      "nep141:arb-0xaf88d065e77c8cC2239327C5EDb3A432268e5831.omft.near",
    ]);
    assert.equal(payoutAssetLabel(options[0]), "USDC on arbitrum");
  });
});
