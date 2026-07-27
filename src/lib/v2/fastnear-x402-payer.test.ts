import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload } from "@x402/core/types";
import {
  createFastNearX402Payer,
  type FastNearDelegateWallet,
} from "../../../app/lib/fastnear-x402-payer";

const paymentRequired = {
  x402Version: 2,
  resource: {
    url: "https://crossword.xyz/api/v2/ai/generate",
    description: "AI crossword draft",
    mimeType: "application/json",
  },
  accepts: [
    {
      scheme: "exact",
      network: "near:testnet",
      asset: "usdc.testnet",
      amount: "100000",
      payTo: "merchant.testnet",
      maxTimeoutSeconds: 300,
      extra: {},
    },
  ],
  extensions: {
    "payment-identifier": {
      info: { required: true, id: "ai_1234567890abcdef" },
      schema: {
        type: "object",
        properties: {
          required: { type: "boolean" },
          id: { type: "string" },
        },
        required: ["required"],
      },
    },
  },
};

describe("FastNEAR x402 payer", () => {
  it("uses timeout-aware wallet delegate signing and emits PAYMENT-SIGNATURE", async () => {
    let delegateInput: Parameters<
      FastNearDelegateWallet["signDelegateActions"]
    >[0] | null = null;
    const wallet: FastNearDelegateWallet = {
      accountId: () => "payer.testnet",
      async signDelegateActions(input) {
        delegateInput = input;
        return {
          signedDelegateActions: [
            { borshSerializedBase64: "c2lnbmVkLWRlbGVnYXRl" },
          ],
        };
      },
    };
    const payer = createFastNearX402Payer(wallet, "testnet");
    const headers = await payer.createPaymentHeaders({
      paymentRequired,
      paymentIdentifier: "ai_1234567890abcdef",
      request: {
        method: "POST",
        url: "/api/v2/ai/generate",
        body: "{}",
        headers: { "content-type": "application/json" },
      },
    });
    const signature = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === "payment-signature",
    )?.[1];
    assert.ok(signature);
    const payload = decodePaymentSignatureHeader(signature) as PaymentPayload;
    assert.equal(
      (payload.payload as { signedDelegateAction: string })
        .signedDelegateAction,
      "c2lnbmVkLWRlbGVnYXRl",
    );
    assert.equal(
      (
        payload.extensions?.["payment-identifier"] as {
          info: { id: string };
        }
      ).info.id,
      "ai_1234567890abcdef",
    );
    assert.deepEqual(delegateInput, {
      network: "testnet",
      signerId: "payer.testnet",
      delegateActions: [
        {
          receiverId: "usdc.testnet",
          blockHeightTtl: 300,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName: "ft_transfer",
                args: {
                  receiver_id: "merchant.testnet",
                  amount: "100000",
                },
                gas: "30000000000000",
                deposit: "1",
              },
            },
          ],
        },
      ],
    });
  });

  it("rejects a legacy non-transport-safe wallet response", async () => {
    const payer = createFastNearX402Payer(
      {
        accountId: () => "payer.testnet",
        async signDelegateActions() {
          return {
            signedDelegateActions: [
              { delegateHash: new Uint8Array(), signedDelegate: {} },
            ],
          } as never;
        },
      },
      "testnet",
    );
    await assert.rejects(
      () =>
        payer.createPaymentHeaders({
          paymentRequired,
          paymentIdentifier: "ai_1234567890abcdef",
          request: {
            method: "POST",
            url: "/api/v2/ai/generate",
            body: "{}",
            headers: {},
          },
        }),
      /canonical signed-delegate format/,
    );
  });
});
