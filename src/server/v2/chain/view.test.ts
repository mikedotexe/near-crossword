import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getV2ExternalFundingAuthorization } from "./view";

function response(value: unknown): { result: number[] } {
  return {
    result: [...Buffer.from(JSON.stringify(value), "utf8")],
  };
}

describe("v2 external funding authorization view", () => {
  it("reads final state and normalizes the complete immutable authorization", async () => {
    const queries: Record<string, unknown>[] = [];
    const result = await getV2ExternalFundingAuthorization("quote-123", {
      contractId: "campaigns-v2.testnet",
      provider: {
        query: async (params) => {
          queries.push(params);
          return response({
            campaign_id: "campaign-123",
            creator_id: "creator.testnet",
            controller_id: "creator.testnet",
            sponsor_id: "creator.testnet",
            content_hash: Buffer.alloc(32, 1).toString("base64"),
            solution_public_key: Buffer.alloc(32, 2).toString("base64"),
            amount: "25000000",
            opens_at_ms: 1784937600000,
            expires_at_ms: "1785542400000",
            refund_account_id: "creator.testnet",
            funding_reference: "quote-123",
            funding_rail: "intents",
            funding_deadline_ms: "1784938200000",
            expired: false,
            pending: false,
            storage_deposit: "1000000000000000000000",
          });
        },
      },
    });

    assert.equal(queries.length, 1);
    const query = queries[0]!;
    assert.equal(query.request_type, "call_function");
    assert.equal(query.finality, "final");
    assert.equal(query.account_id, "campaigns-v2.testnet");
    assert.equal(query.method_name, "get_external_funding_authorization");
    assert.deepEqual(
      JSON.parse(
        Buffer.from(String(query.args_base64), "base64").toString("utf8"),
      ),
      { funding_reference: "quote-123" },
    );
    assert.deepEqual(result, {
      campaignId: "campaign-123",
      creatorId: "creator.testnet",
      controllerId: "creator.testnet",
      sponsorId: "creator.testnet",
      contentHash: Buffer.alloc(32, 1).toString("base64"),
      solutionPublicKey: Buffer.alloc(32, 2).toString("base64"),
      amount: "25000000",
      opensAtMs: "1784937600000",
      expiresAtMs: "1785542400000",
      refundAccountId: "creator.testnet",
      fundingReference: "quote-123",
      fundingRail: "intents",
      fundingDeadlineMs: "1784938200000",
      expired: false,
      pending: false,
      storageDeposit: "1000000000000000000000",
    });
  });

  it("returns null for an absent authorization and rejects malformed views", async () => {
    assert.equal(
      await getV2ExternalFundingAuthorization("missing", {
        contractId: "campaigns-v2.testnet",
        provider: { query: async () => response(null) },
      }),
      null,
    );
    await assert.rejects(
      getV2ExternalFundingAuthorization("bad", {
        contractId: "campaigns-v2.testnet",
        provider: {
          query: async () =>
            response({
              campaign_id: "campaign-123",
              creator_id: "creator.testnet",
              controller_id: "creator.testnet",
              sponsor_id: "creator.testnet",
              content_hash: "hash",
              solution_public_key: "key",
              amount: "not-an-integer",
              opens_at_ms: "1",
              expires_at_ms: "2",
              refund_account_id: "creator.testnet",
              funding_reference: "bad",
              funding_rail: "intents",
              funding_deadline_ms: "2",
              expired: false,
              pending: false,
              storage_deposit: "1",
            }),
        },
      }),
      /authorization.amount/,
    );
  });
});
