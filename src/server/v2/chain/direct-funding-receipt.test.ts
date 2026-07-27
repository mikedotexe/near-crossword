import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../errors";
import { MemoryRepository } from "../memory-repository";
import type { Campaign, FundingOrder } from "../types";
import type { OnChainCampaign } from "./types";
import {
  recordDirectFundingReceipt,
  verifyDirectFundingReceipt,
} from "./direct-funding-receipt";

const TX_HASH = "3".repeat(44);
const OTHER_TX_HASH = "4".repeat(44);
const CONTRACT_ID = "campaigns.testnet";
const TOKEN_ID = "usdc.testnet";
const CREATOR_ID = "sponsor.testnet";
const CAMPAIGN_ID = "1b0f52b9-2c58-48c9-8787-cde51fd4a89d";
const FUNDING_REFERENCE = `campaign:${CAMPAIGN_ID}:direct-receipt`;
const OPENING_AT = "2026-07-24T20:00:00.000Z";
const EXPIRES_AT = "2026-07-31T20:00:00.000Z";
const CONTENT_HASH = "ab".repeat(32);
const SOLUTION_PUBLIC_KEY = Buffer.alloc(32, 7).toString("base64");

function directMessage(): string {
  return JSON.stringify({
    action: "create_campaign",
    campaign: {
      campaign_id: CAMPAIGN_ID,
      creator_id: CREATOR_ID,
      controller_id: CREATOR_ID,
      content_hash: Buffer.from(CONTENT_HASH, "hex").toString("base64"),
      solution_public_key: SOLUTION_PUBLIC_KEY,
      opens_at_ms: new Date(OPENING_AT).getTime(),
      expires_at_ms: new Date(EXPIRES_AT).getTime(),
      refund_account_id: CREATOR_ID,
    },
    funding_reference: FUNDING_REFERENCE,
    funding_deadline_ms: new Date("2026-07-24T20:05:00.000Z").getTime(),
  });
}

function campaign(status: Campaign["status"] = "FUNDING"): Campaign {
  return {
    id: CAMPAIGN_ID,
    slug: "direct-receipt-campaign",
    creatorId: "creator-user-id",
    creatorAccountId: CREATOR_ID,
    title: "Direct receipt campaign",
    description: null,
    sponsorName: "Sponsor",
    sponsorUrl: null,
    visibility: "PUBLIC",
    status,
    puzzle: {
      width: 3,
      height: 3,
      clues: [
        {
          number: 1,
          clue: "Test",
          row: 0,
          column: 0,
          direction: "across",
          length: 3,
        },
      ],
    },
    contentHash: CONTENT_HASH,
    solutionPublicKey: SOLUTION_PUBLIC_KEY,
    reward: {
      type: "TOKEN_PRIZE",
      assetId: `nep141:${TOKEN_ID}`,
      amountAtomic: "1000000",
      decimals: 6,
      symbol: "USDC",
    },
    contractId: CONTRACT_ID,
    openingAt: OPENING_AT,
    expiresAt: EXPIRES_AT,
    refundAccount: CREATOR_ID,
    fundingReference: null,
    chainCampaignId: null,
    aiGenerationReceipt: null,
    version: 1,
    createdAt: "2026-07-24T19:50:00.000Z",
    updatedAt: "2026-07-24T19:50:00.000Z",
  };
}

function fundingOrder(): FundingOrder {
  const msg = directMessage();
  return {
    id: "9a48b3ad-a7ab-49f4-98b7-6587b02146ea",
    campaignId: CAMPAIGN_ID,
    creatorId: "creator-user-id",
    rail: "DIRECT_NEAR",
    status: "AWAITING_DEPOSIT",
    idempotencyKey: "direct-receipt-request",
    originAssetId: `nep141:${TOKEN_ID}`,
    destinationAssetId: `nep141:${TOKEN_ID}`,
    principalAmountAtomic: "1000000",
    inputAmountAtomic: "1000000",
    routingFeeAtomic: "0",
    platformFeeAtomic: "0",
    refundTo: CREATOR_ID,
    quote: {
      rail: "DIRECT_NEAR",
      origin: {
        assetId: `nep141:${TOKEN_ID}`,
        amountAtomic: "1000000",
      },
      principal: {
        assetId: `nep141:${TOKEN_ID}`,
        amountAtomic: "1000000",
      },
      routingFee: {
        assetId: `nep141:${TOKEN_ID}`,
        amountAtomic: "0",
      },
      platformFee: {
        assetId: `nep141:${TOKEN_ID}`,
        amountAtomic: "0",
      },
      depositAddress: CONTRACT_ID,
      depositMemo: msg,
      deadline: "2026-07-24T20:05:00.000Z",
      providerQuoteId: FUNDING_REFERENCE,
      providerStatus: "AWAITING_FT_TRANSFER_CALL",
      rawDigest: "direct-quote-digest",
      instructions: {
        method: "ft_transfer_call",
        signerId: CREATOR_ID,
        tokenContract: TOKEN_ID,
        receiverId: CONTRACT_ID,
        amount: "1000000",
        msg,
        attachedDeposit: "1",
      },
    },
    providerReference: FUNDING_REFERENCE,
    depositAddress: CONTRACT_ID,
    depositTxHash: null,
    settlementTxHash: null,
    fundingReference: null,
    evidence: { quoteDigest: "direct-quote-digest" },
    expiresAt: "2026-07-24T20:05:00.000Z",
    version: 1,
    createdAt: "2026-07-24T19:50:00.000Z",
    updatedAt: "2026-07-24T19:50:00.000Z",
  };
}

function onChainCampaign(): OnChainCampaign {
  return {
    campaignId: CAMPAIGN_ID,
    creatorId: CREATOR_ID,
    controllerId: CREATOR_ID,
    sponsorId: CREATOR_ID,
    contentHash: Buffer.from(CONTENT_HASH, "hex").toString("base64"),
    solutionPublicKey: SOLUTION_PUBLIC_KEY,
    amount: "1000000",
    opensAtMs: String(new Date(OPENING_AT).getTime()),
    expiresAtMs: String(new Date(EXPIRES_AT).getTime()),
    refundAccountId: CREATOR_ID,
    claimNonce: "0",
    fundingReference: FUNDING_REFERENCE,
    fundingRail: "direct_usdc",
    status: { state: "active" },
  };
}

function transactionOutcome(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const args = {
    receiver_id: CONTRACT_ID,
    amount: "1000000",
    msg: directMessage(),
  };
  return {
    final_execution_status: "FINAL",
    status: { SuccessValue: Buffer.from("\"0\"").toString("base64") },
    transaction: {
      hash: TX_HASH,
      signer_id: CREATOR_ID,
      receiver_id: TOKEN_ID,
      actions: [
        {
          FunctionCall: {
            method_name: "ft_transfer_call",
            args: Buffer.from(JSON.stringify(args)).toString("base64"),
            gas: "100000000000000",
            deposit: "1",
          },
        },
      ],
    },
    transaction_outcome: { block_hash: "5".repeat(44) },
    ...overrides,
  };
}

describe("direct funding receipts", () => {
  it("accepts only a final exact transfer that produced the pinned campaign", async () => {
    const receipt = await verifyDirectFundingReceipt(
      fundingOrder(),
      campaign(),
      TX_HASH,
      {
        fetchOutcome: async (hash, signerId) => {
          assert.equal(hash, TX_HASH);
          assert.equal(signerId, CREATOR_ID);
          return transactionOutcome();
        },
        readCampaign: async (campaignId, contractId) => {
          assert.equal(campaignId, CAMPAIGN_ID);
          assert.equal(contractId, CONTRACT_ID);
          return onChainCampaign();
        },
      },
    );
    assert.deepEqual(receipt, {
      txHash: TX_HASH,
      blockHash: "5".repeat(44),
      fundingReference: FUNDING_REFERENCE,
      contractState: "active",
    });
  });

  it("rejects a successful transaction whose transfer arguments were substituted", async () => {
    const outcome = transactionOutcome();
    const transaction = outcome.transaction as Record<string, unknown>;
    const actions = transaction.actions as Array<Record<string, unknown>>;
    const call = actions[0].FunctionCall as Record<string, unknown>;
    call.args = Buffer.from(
      JSON.stringify({
        receiver_id: CONTRACT_ID,
        amount: "999999",
        msg: directMessage(),
      }),
    ).toString("base64");
    await assert.rejects(
      verifyDirectFundingReceipt(
        fundingOrder(),
        campaign(),
        TX_HASH,
        {
          fetchOutcome: async () => outcome,
          readCampaign: async () => onChainCampaign(),
        },
      ),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "DIRECT_FUNDING_RECEIPT_MISMATCH",
    );
  });

  it("rejects a receipt when the resulting contract campaign differs", async () => {
    await assert.rejects(
      verifyDirectFundingReceipt(
        fundingOrder(),
        campaign(),
        TX_HASH,
        {
          fetchOutcome: async () => transactionOutcome(),
          readCampaign: async () => ({
            ...onChainCampaign(),
            refundAccountId: "attacker.testnet",
          }),
        },
      ),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "DIRECT_FUNDING_NOT_ACCEPTED",
    );
  });

  it("persists a verified hash, wakes reconciliation, and replays idempotently", async () => {
    const repository = new MemoryRepository();
    const sourceCampaign = campaign();
    await repository.createCampaign({
      ...sourceCampaign,
      id: sourceCampaign.id,
    });
    const sourceOrder = fundingOrder();
    await repository.createFundingOrderIdempotent({
      ...sourceOrder,
      id: sourceOrder.id,
    });
    const options = {
      fetchOutcome: async () => transactionOutcome(),
      readCampaign: async () => onChainCampaign(),
    };
    const recorded = await recordDirectFundingReceipt(
      repository,
      { id: "creator-user-id", email: null, demo: false },
      sourceOrder.id,
      { txHash: TX_HASH },
      options,
    );
    assert.equal(recorded.status, "DEPOSIT_DETECTED");
    assert.equal(recorded.depositTxHash, TX_HASH);
    assert.equal(recorded.fundingReference, FUNDING_REFERENCE);
    const jobs = await repository.leaseJobs(
      "receipt-test",
      10,
      "2030-01-01T01:00:00.000Z",
      "2030-01-01T00:00:00.000Z",
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].type, "RECONCILE_FUNDING_ORDER");

    const replayed = await recordDirectFundingReceipt(
      repository,
      { id: "creator-user-id", email: null, demo: false },
      sourceOrder.id,
      { txHash: TX_HASH },
      {
        fetchOutcome: async () => {
          throw new Error("idempotent replay should not re-fetch");
        },
      },
    );
    assert.equal(replayed.depositTxHash, TX_HASH);
    await assert.rejects(
      recordDirectFundingReceipt(
        repository,
        { id: "creator-user-id", email: null, demo: false },
        sourceOrder.id,
        { txHash: OTHER_TX_HASH },
      ),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "DIRECT_FUNDING_RECEIPT_CONFLICT",
    );
  });
});
