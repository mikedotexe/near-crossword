import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Pool } from "pg";
import { PostgresRepository } from "./postgres-repository";

const timestamp = "2026-07-24T20:00:00.000Z";

function claimRow(status: "PAYING" | "PAID") {
  return {
    id: "90222222-2222-4222-8222-222222222222",
    campaign_id: "90111111-1111-4111-8111-111111111111",
    claimant_id: "winner",
    status,
    idempotency_key: "claim_idempotency_1234",
    payout: {
      kind: "ONE_CLICK",
      destinationAsset: "opaque:destination-usdc",
      recipient: "0xwinner",
      recoveryAccount: "winner.near",
    },
    payout_quote: {
      rail: "ONE_CLICK",
      origin: { assetId: "nep141:usdc.near", amountAtomic: "1000000" },
      principal: { assetId: "nep141:usdc.near", amountAtomic: "1000000" },
      routingFee: { assetId: "nep141:usdc.near", amountAtomic: "0" },
      platformFee: { assetId: "nep141:usdc.near", amountAtomic: "0" },
      depositAddress: "route.near",
      depositMemo: null,
      deadline: timestamp,
      providerQuoteId: "quote",
      providerStatus: "SUCCESS",
      rawDigest: "a".repeat(64),
      instructions: {},
    },
    solution_proof_digest: "b".repeat(64),
    solution_proof: null,
    contract_tx_hash: "contract-receipt",
    settlement_tx_hash: status === "PAID" ? "destination-receipt" : null,
    evidence: { contractState: "claimed" },
    expires_at: timestamp,
    version: status === "PAID" ? 3 : 2,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function campaignRow(status: "CLAIMING" | "CLAIMED") {
  return {
    id: "90111111-1111-4111-8111-111111111111",
    slug: "postgres-atomic-payout",
    creator_id: "creator",
    creator_account_id: "creator.near",
    title: "Postgres atomic payout",
    description: null,
    sponsor_name: null,
    sponsor_url: null,
    visibility: "PUBLIC",
    status,
    puzzle: { width: 3, height: 3, clues: [] },
    content_hash: "c".repeat(64),
    solution_public_key: Buffer.alloc(32, 1).toString("base64"),
    reward_spec: {
      type: "TOKEN_PRIZE",
      assetId: "nep141:usdc.near",
      amountAtomic: "1000000",
      decimals: 6,
      symbol: "USDC",
    },
    contract_id: "campaigns.near",
    opening_at: timestamp,
    expires_at: timestamp,
    refund_account: "creator.near",
    funding_reference: "funding-reference",
    chain_campaign_id: "90111111-1111-4111-8111-111111111111",
    version: status === "CLAIMED" ? 3 : 2,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

class AtomicTransactionPool {
  readonly statements: string[] = [];
  claim: ReturnType<typeof claimRow>;
  campaign: ReturnType<typeof campaignRow>;

  constructor(
    claimStatus: "PAYING" | "PAID",
    campaignStatus: "CLAIMING" | "CLAIMED",
  ) {
    this.claim = claimRow(claimStatus);
    this.campaign = campaignRow(campaignStatus);
  }

  asPool(): Pool {
    const client = {
      query: async (sql: string, values: readonly unknown[] = []) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        this.statements.push(normalized);
        if (normalized === "BEGIN" || normalized === "COMMIT") {
          return { rowCount: null, rows: [] };
        }
        if (normalized === "ROLLBACK") {
          return { rowCount: null, rows: [] };
        }
        if (normalized.startsWith("SELECT * FROM v2_claims")) {
          return { rowCount: 1, rows: [{ ...this.claim }] };
        }
        if (normalized.startsWith("SELECT * FROM v2_campaigns")) {
          return { rowCount: 1, rows: [{ ...this.campaign }] };
        }
        if (normalized.startsWith("UPDATE v2_claims")) {
          this.claim = {
            ...this.claim,
            status: values[1] as "PAID",
            settlement_tx_hash: values[2] as string,
            evidence: {
              ...this.claim.evidence,
              ...(values[3] as Record<string, unknown>),
            },
            version: this.claim.version + 1,
          };
          return { rowCount: 1, rows: [{ ...this.claim }] };
        }
        if (normalized.startsWith("UPDATE v2_campaigns")) {
          this.campaign = {
            ...this.campaign,
            status: "CLAIMED",
            version: this.campaign.version + 1,
          };
          return { rowCount: 1, rows: [{ ...this.campaign }] };
        }
        throw new Error(`Unexpected SQL: ${normalized}`);
      },
      release: () => undefined,
    };
    return {
      connect: async () => client,
    } as unknown as Pool;
  }
}

describe("Postgres 1Click terminal ledger transaction", () => {
  it("writes claim and campaign before one commit", async () => {
    const fake = new AtomicTransactionPool("PAYING", "CLAIMING");
    const repository = new PostgresRepository(fake.asPool());
    const result = await repository.finalizeOneClickPayoutAtomically({
      claimId: fake.claim.id,
      campaignId: fake.campaign.id,
      target: "PAID",
      claimPatch: {
        settlementTxHash: "destination-receipt",
        evidence: {
          contractState: "claimed",
          oneClickProviderStatus: "SUCCESS",
        },
      },
    });

    assert.equal(result?.claim.status, "PAID");
    assert.equal(result?.campaign.status, "CLAIMED");
    assert.deepEqual(
      fake.statements.map((statement) =>
        statement
          .replace(/SELECT \*/u, "SELECT")
          .split(" ")
          .slice(0, 3)
          .join(" "),
      ),
      [
        "BEGIN",
        "SELECT FROM v2_claims",
        "SELECT FROM v2_campaigns",
        "UPDATE v2_claims SET",
        "UPDATE v2_campaigns SET",
        "COMMIT",
      ],
    );
  });

  it("repairs and then idempotently replays a terminal-claim split state", async () => {
    const fake = new AtomicTransactionPool("PAID", "CLAIMING");
    const repository = new PostgresRepository(fake.asPool());
    const input = {
      claimId: fake.claim.id,
      campaignId: fake.campaign.id,
      target: "PAID" as const,
    };

    const repaired = await repository.finalizeOneClickPayoutAtomically(input);
    assert.equal(repaired?.campaign.status, "CLAIMED");
    assert.equal(
      fake.statements.filter((statement) =>
        statement.startsWith("UPDATE v2_claims"),
      ).length,
      0,
    );
    assert.equal(
      fake.statements.filter((statement) =>
        statement.startsWith("UPDATE v2_campaigns"),
      ).length,
      1,
    );

    const replayed = await repository.finalizeOneClickPayoutAtomically(input);
    assert.equal(replayed?.claim.status, "PAID");
    assert.equal(replayed?.campaign.status, "CLAIMED");
    assert.equal(
      fake.statements.filter((statement) =>
        statement.startsWith("UPDATE v2_campaigns"),
      ).length,
      1,
    );
    assert.equal(
      fake.statements.filter((statement) => statement === "COMMIT").length,
      2,
    );
  });
});
