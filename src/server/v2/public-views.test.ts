import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicCampaignView, publicClaimView } from "./public-views";
import type { Campaign, Claim } from "./types";

describe("public claim view", () => {
  it("publishes lifecycle receipts without payout or proof secrets", () => {
    const claim: Claim = {
      id: "claim-1",
      campaignId: "campaign-1",
      claimantId: "private-claimant",
      status: "PAYING",
      idempotencyKey: "private-key",
      payout: {
        kind: "ONE_CLICK",
        destinationAsset: "eth:usdc",
        recipient: "private-destination",
        recoveryAccount: "private-recovery.testnet",
      },
      payoutQuote: null,
      solutionProofDigest: "proof-digest",
      solutionProof: {
        signature: "private-signature",
        nonce: "0",
        deadlineMs: "1785000000000",
        payoutDigest: "private-payout-digest",
      },
      contractTxHash: "near-contract-receipt",
      settlementTxHash: null,
      evidence: {
        contractState: "claimed",
        downstreamStatus: "AWAITING_PROVIDER_TERMINAL",
        oneClickDepositAddress: "private-deposit",
        winnerRecoveryAccount: "private-recovery.testnet",
        destinationTxHash: "public-destination-receipt",
        nestedSecret: { value: "private" },
      },
      expiresAt: "2026-07-25T00:00:00.000Z",
      version: 3,
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:01:00.000Z",
    };

    const view = publicClaimView(claim);
    assert.deepEqual(view.evidence, {
      contractState: "claimed",
      downstreamStatus: "AWAITING_PROVIDER_TERMINAL",
      destinationTxHash: "public-destination-receipt",
    });
    const serialized = JSON.stringify(view);
    for (const secret of [
      "private-claimant",
      "private-key",
      "private-destination",
      "private-recovery",
      "private-signature",
      "private-payout-digest",
      "private-deposit",
      "nestedSecret",
    ]) {
      assert.equal(serialized.includes(secret), false);
    }
  });
});

describe("public campaign view", () => {
  it("omits creator identity and recovery fields", () => {
    const campaign = {
      id: "campaign-1",
      slug: "public-campaign",
      title: "Public campaign",
      description: null,
      sponsorName: "Sponsor",
      sponsorUrl: null,
      visibility: "PUBLIC",
      status: "ACTIVE",
      puzzle: { width: 3, height: 3, clues: [] },
      contentHash: "a".repeat(64),
      solutionPublicKey: Buffer.alloc(32, 1).toString("base64"),
      reward: {
        type: "TOKEN_PRIZE",
        assetId: "nep141:usdc.testnet",
        amountAtomic: "1000000",
        decimals: 6,
        symbol: "USDC",
      },
      contractId: "campaigns.testnet",
      openingAt: "2026-07-24T00:00:00.000Z",
      expiresAt: "2026-07-31T00:00:00.000Z",
      fundingReference: "public-funding-reference",
      chainCampaignId: "campaign-1",
      aiGenerationReceipt: null,
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z",
      creatorId: "private-database-user",
      creatorAccountId: "creator-private.testnet",
      refundAccount: "recovery-private.testnet",
      version: 7,
    } satisfies Campaign;
    const serialized = JSON.stringify(publicCampaignView(campaign));
    assert.equal(serialized.includes("private-database-user"), false);
    assert.equal(serialized.includes("creator-private.testnet"), false);
    assert.equal(serialized.includes("recovery-private.testnet"), false);
    assert.equal(serialized.includes('"version"'), false);
    assert.equal(serialized.includes(campaign.solutionPublicKey!), true);
  });
});
