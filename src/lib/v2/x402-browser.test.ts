import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachPaymentIdentifier,
  executeX402PaidRequest,
  type X402BrowserPayer,
} from "../../../app/lib/x402-browser";

const declaration = {
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
      payTo: "crossword.testnet",
      maxTimeoutSeconds: 300,
      extra: {},
    },
  ],
  extensions: {
    "payment-identifier": {
      info: { required: true },
      schema: { type: "object" },
    },
  },
};

function challengeResponse(): Response {
  return new Response(
    JSON.stringify({
      error: { code: "PAYMENT_REQUIRED" },
      paymentRequired: declaration,
    }),
    {
      status: 402,
      headers: { "content-type": "application/json" },
    },
  );
}

describe("browser x402 payment boundary", () => {
  it("adds the same payment identifier without mutating the challenge", () => {
    const paymentIdentifier = "ai_1234567890abcdef";
    const enriched = attachPaymentIdentifier(declaration, paymentIdentifier);
    assert.equal(
      (
        (
          enriched.extensions as Record<string, unknown>
        )["payment-identifier"] as { info: { id: string } }
      ).info.id,
      paymentIdentifier,
    );
    assert.equal(
      (
        (
          declaration.extensions as Record<string, unknown>
        )["payment-identifier"] as { info: { id?: string } }
      ).info.id,
      undefined,
    );
  });

  it("uses a standard PAYMENT-SIGNATURE retry with a stable body and id", async () => {
    const calls: Array<{ headers: Headers; body: string }> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      calls.push({
        headers: new Headers(init?.headers),
        body: String(init?.body ?? ""),
      });
      if (calls.length === 1) return challengeResponse();
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const payer: X402BrowserPayer = {
      async createPaymentHeaders(input) {
        assert.equal(input.paymentIdentifier, "ai_1234567890abcdef");
        return { "PAYMENT-SIGNATURE": "signed-payment-payload" };
      },
    };
    const response = await executeX402PaidRequest({
      url: "/api/v2/ai/generate",
      body: JSON.stringify({ topic: "payments", tone: "clever", count: 7 }),
      paymentIdentifier: "ai_1234567890abcdef",
      payer,
      fetcher,
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body, calls[1].body);
    assert.equal(
      calls[1].headers.get("payment-signature"),
      "signed-payment-payload",
    );
    assert.equal(
      calls[1].headers.get("idempotency-key"),
      "ai_1234567890abcdef",
    );
  });

  it("reuses the exact signature after a lost paid response", async () => {
    const signatures: Array<string | null> = [];
    let call = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      call += 1;
      const headers = new Headers(init?.headers);
      signatures.push(headers.get("payment-signature"));
      if (call === 1) return challengeResponse();
      if (call === 2) throw new TypeError("response lost");
      return new Response(JSON.stringify({ entries: [], cached: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-idempotent-replay": "true",
        },
      });
    };
    const response = await executeX402PaidRequest({
      url: "/api/v2/ai/generate",
      body: "{}",
      paymentIdentifier: "ai_1234567890abcdef",
      payer: {
        createPaymentHeaders: async () => ({
          "payment-signature": "same-signature",
        }),
      },
      fetcher,
    });

    assert.equal(response.headers.get("x-idempotent-replay"), "true");
    assert.deepEqual(signatures, [null, "same-signature", "same-signature"]);
  });
});
