import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  confirmFundingAuthorization,
  requestFundingQuote,
} from "../../../app/lib/api";
import { readExternalFundingAuthorizationInstruction } from "../../../app/components/ExternalFundingAuthorizationAction";

function authorizationInstructions(): Record<string, unknown> {
  return {
    creatorAuthorization: {
      version: "crossword-external-funding-authorization:v1",
      authorizedCreatorAccountId: "creator.testnet",
      fundingReference: "provider-quote-1",
      storageDepositNotice: "Unused storage allowance is refunded.",
      walletCall: {
        signerId: "creator.testnet",
        receiverId: "campaigns-v2.testnet",
        actions: [
          {
            type: "FunctionCall",
            methodName: "authorize_external_funding",
            args: {
              args: {
                campaign: {
                  campaign_id: "campaign-1",
                  creator_id: "creator.testnet",
                  controller_id: "creator.testnet",
                  content_hash: "hash",
                  solution_public_key: "public-key",
                  opens_at_ms: 1,
                  expires_at_ms: 2,
                  refund_account_id: "creator.testnet",
                },
                amount: "25000000",
                funding_reference: "provider-quote-1",
                funding_rail: "intents",
                sponsor_id: "creator.testnet",
                funding_deadline_ms: 2,
              },
            },
            gas: "100000000000000",
            deposit: "50000000000000000000000",
          },
        ],
      },
    },
  };
}

describe("creator external-funding browser handshake", () => {
  it("accepts only the single pinned creator authorization wallet call", () => {
    const instructions = authorizationInstructions();
    assert.ok(readExternalFundingAuthorizationInstruction(instructions));

    const authorization = instructions.creatorAuthorization as {
      walletCall: { actions: unknown[] };
    };
    authorization.walletCall.actions.push({
      type: "FunctionCall",
      methodName: "ft_transfer",
      args: {},
      gas: "100000000000000",
      deposit: "1",
    });
    assert.equal(
      readExternalFundingAuthorizationInstruction(instructions),
      null,
    );
  });

  it("preserves an authorization-required masked quote", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          authorizationRequired: true,
          fundingOrder: {
            id: "funding-1",
            campaignId: "campaign-1",
            rail: "ONE_CLICK",
            status: "QUOTED",
            originAssetId: "asset:origin",
            principalAmountAtomic: "25000000",
            inputAmountAtomic: null,
            routingFeeAtomic: "1000",
            platformFeeAtomic: "0",
            depositAddress: null,
            expiresAt: "2030-01-01T00:10:00.000Z",
            quote: {
              depositMemo: null,
              instructions: authorizationInstructions(),
            },
          },
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      )) as typeof fetch;
    try {
      const result = await requestFundingQuote({
        campaignId: "campaign-1",
        rail: "intents",
        originAssetId: "asset:origin",
        refundTo: "0xrefund",
      });
      assert.equal(result.authorizationRequired, true);
      assert.equal(result.fundingOrder.inputAmountAtomic, null);
      assert.equal(result.fundingOrder.depositAddress, null);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("returns only the independently verified deposit display fields", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          fundingOrder: {
            id: "funding-1",
            campaignId: "campaign-1",
            status: "QUOTED",
            version: 2,
          },
          authorization: {
            contractId: "campaigns-v2.testnet",
            campaignId: "campaign-1",
            fundingReference: "provider-quote-1",
            fundingDeadlineMs: String(
              new Date("2030-01-01T00:25:00.000Z").getTime(),
            ),
            verifiedAt: "2030-01-01T00:00:10.000Z",
          },
          deposit: {
            depositAddress: "0xprovider-deposit",
            depositMemo: "required-memo",
            originAssetId: "asset:origin",
            inputAmountAtomic: "25100000",
            deadline: "2030-01-01T00:10:00.000Z",
            providerQuoteId: "provider-quote-1",
            instructions: {
              arbitraryProviderWalletAction: "discarded",
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as typeof fetch;
    try {
      const result = await confirmFundingAuthorization("funding-1");
      assert.deepEqual(result.deposit, {
        depositAddress: "0xprovider-deposit",
        depositMemo: "required-memo",
        originAssetId: "asset:origin",
        inputAmountAtomic: "25100000",
        deadline: "2030-01-01T00:10:00.000Z",
        providerQuoteId: "provider-quote-1",
      });
      assert.equal("instructions" in result.deposit, false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
