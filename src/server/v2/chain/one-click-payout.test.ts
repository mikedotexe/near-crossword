import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FundingObservation } from "../funding/types";
import { MemoryRepository } from "../memory-repository";
import {
  classifyOneClickPayout,
  reconcileOneClickPayout,
  repairTerminalOneClickPayout,
} from "./one-click-payout";

function observation(
  orderStatus: FundingObservation["orderStatus"],
  settlementTxHash: string | null,
): FundingObservation {
  return {
    providerStatus: orderStatus,
    orderStatus,
    depositTxHash: "deposit",
    settlementTxHash,
    fundingReference: null,
    evidence: {
      provider: "1click",
      depositAddress: "route.near",
      depositTxHash: "deposit",
      settlementTxHash,
      responseDigest: "a".repeat(64),
    },
  };
}

describe("1Click winner payout decisions", () => {
  it("requires a downstream receipt before reporting successful delivery", () => {
    assert.equal(classifyOneClickPayout(observation("SETTLED", null)), "MISSING_RECEIPT");
    assert.equal(
      classifyOneClickPayout(observation("SETTLED", "destination-tx")),
      "SETTLED",
    );
  });

  it("distinguishes winner-controlled refund recovery from delivery", () => {
    assert.equal(
      classifyOneClickPayout(observation("REFUNDED", "refund-tx")),
      "RECOVERED",
    );
    assert.equal(classifyOneClickPayout(observation("FAILED", null)), "FAILED");
  });

  it("keeps the campaign claiming until a downstream receipt is recorded", async () => {
    const repository = new MemoryRepository();
    const campaign = await repository.createCampaign({
      id: "90111111-1111-4111-8111-111111111111",
      slug: "payout-receipt-test",
      creatorId: "creator",
      creatorAccountId: "creator.near",
      title: "Receipt test",
      description: null,
      sponsorName: null,
      sponsorUrl: null,
      visibility: "PUBLIC",
      status: "CLAIMING",
      puzzle: { width: 3, height: 3, clues: [] },
      contentHash: "a".repeat(64),
      solutionPublicKey: Buffer.alloc(32, 1).toString("base64"),
      reward: {
        type: "TOKEN_PRIZE",
        assetId: "nep141:usdc.near",
        amountAtomic: "1000000",
        decimals: 6,
        symbol: "USDC",
      },
      contractId: "campaigns.near",
      openingAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      refundAccount: "creator.near",
      fundingReference: "funding-reference",
      chainCampaignId: "90111111-1111-4111-8111-111111111111",
    });
    const { claim } = await repository.createClaimIdempotent({
      id: "90222222-2222-4222-8222-222222222222",
      campaignId: campaign.id,
      claimantId: "anonymous",
      status: "PAYING",
      idempotencyKey: "claim_idempotency_1234",
      payout: {
        kind: "ONE_CLICK",
        destinationAsset: "opaque:base-usdc-route",
        recipient: "0xwinner",
        recoveryAccount: "winner.near",
      },
      payoutQuote: {
        rail: "ONE_CLICK",
        origin: { assetId: "nep141:usdc.near", amountAtomic: "1000000" },
        principal: { assetId: "nep141:usdc.near", amountAtomic: "1000000" },
        routingFee: { assetId: "nep141:usdc.near", amountAtomic: "0" },
        platformFee: { assetId: "nep141:usdc.near", amountAtomic: "0" },
        depositAddress: "route.near",
        depositMemo: null,
        deadline: new Date(Date.now() + 60_000).toISOString(),
        providerQuoteId: "quote",
        providerStatus: "PROCESSING",
        rawDigest: "b".repeat(64),
        instructions: {},
      },
      solutionProofDigest: "c".repeat(64),
      solutionProof: null,
      contractTxHash: "contract-tx",
      settlementTxHash: null,
      evidence: {
        receiverId: "route.near",
        contractState: "claimed",
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const missing = await reconcileOneClickPayout(
      repository,
      claim,
      campaign,
      observation("SETTLED", null),
    );
    assert.equal(missing.outcome, "MISSING_RECEIPT");
    assert.equal((await repository.getClaim(claim.id))?.status, "PAYING");
    assert.equal((await repository.getCampaign(campaign.id))?.status, "CLAIMING");
    assert.deepEqual(await repository.getLiveLiabilities(), {
      amountAtomic: "0",
      campaignCount: 0,
      routingInFlightAmountAtomic: "1000000",
      routingInFlightCampaignCount: 1,
    });

    const currentClaim = (await repository.getClaim(claim.id))!;
    const currentCampaign = (await repository.getCampaign(campaign.id))!;
    const settled = await reconcileOneClickPayout(
      repository,
      currentClaim,
      currentCampaign,
      observation("SETTLED", "destination-receipt"),
    );
    assert.equal(settled.claimStatus, "PAID");
    assert.equal(
      (await repository.getClaim(claim.id))?.settlementTxHash,
      "destination-receipt",
    );
    assert.equal((await repository.getCampaign(campaign.id))?.status, "CLAIMED");
    assert.deepEqual(await repository.getLiveLiabilities(), {
      amountAtomic: "0",
      campaignCount: 0,
      routingInFlightAmountAtomic: "0",
      routingInFlightCampaignCount: 0,
    });
  });

  it("repairs a terminal claim left beside CLAIMING without restoring escrow liability", async () => {
    const repository = new MemoryRepository();
    const campaign = await repository.createCampaign({
      id: "90333333-3333-4333-8333-333333333333",
      slug: "payout-ledger-repair",
      creatorId: "creator",
      creatorAccountId: "creator.near",
      title: "Ledger repair",
      description: null,
      sponsorName: null,
      sponsorUrl: null,
      visibility: "PUBLIC",
      status: "CLAIMING",
      puzzle: { width: 3, height: 3, clues: [] },
      contentHash: "d".repeat(64),
      solutionPublicKey: Buffer.alloc(32, 2).toString("base64"),
      reward: {
        type: "TOKEN_PRIZE",
        assetId: "nep141:usdc.near",
        amountAtomic: "2500000",
        decimals: 6,
        symbol: "USDC",
      },
      contractId: "campaigns.near",
      openingAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      refundAccount: "creator.near",
      fundingReference: "funding-reference-repair",
      chainCampaignId: "90333333-3333-4333-8333-333333333333",
    });
    const { claim } = await repository.createClaimIdempotent({
      id: "90444444-4444-4444-8444-444444444444",
      campaignId: campaign.id,
      claimantId: "anonymous-repair",
      status: "PAYING",
      idempotencyKey: "claim_idempotency_repair",
      payout: {
        kind: "ONE_CLICK",
        destinationAsset: "opaque:base-usdc-route",
        recipient: "0xwinner",
        recoveryAccount: "winner.near",
      },
      payoutQuote: {
        rail: "ONE_CLICK",
        origin: { assetId: "nep141:usdc.near", amountAtomic: "2500000" },
        principal: { assetId: "nep141:usdc.near", amountAtomic: "2500000" },
        routingFee: { assetId: "nep141:usdc.near", amountAtomic: "0" },
        platformFee: { assetId: "nep141:usdc.near", amountAtomic: "0" },
        depositAddress: "repair-route.near",
        depositMemo: null,
        deadline: new Date(Date.now() + 60_000).toISOString(),
        providerQuoteId: "repair-quote",
        providerStatus: "SUCCESS",
        rawDigest: "e".repeat(64),
        instructions: {},
      },
      solutionProofDigest: "f".repeat(64),
      solutionProof: null,
      contractTxHash: "contract-tx",
      settlementTxHash: null,
      evidence: {
        receiverId: "repair-route.near",
        contractState: "claimed",
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const terminalClaim = await repository.transitionClaim(
      claim.id,
      ["PAYING"],
      "RECOVERED",
      claim.version,
      {
        settlementTxHash: "winner-refund-receipt",
        evidence: {
          receiverId: "repair-route.near",
          contractState: "claimed",
          oneClickProviderStatus: "REFUNDED",
          responseDigest: "ab".repeat(32),
        },
      },
    );
    assert.ok(terminalClaim);

    // This is the historical crash window: the downstream terminal receipt was
    // durable, while the campaign row still appeared to reserve escrow.
    assert.equal((await repository.getCampaign(campaign.id))?.status, "CLAIMING");
    assert.deepEqual(await repository.getLiveLiabilities(), {
      amountAtomic: "0",
      campaignCount: 0,
      routingInFlightAmountAtomic: "0",
      routingInFlightCampaignCount: 0,
    });

    const repaired = await repairTerminalOneClickPayout(
      repository,
      terminalClaim,
      campaign,
    );
    assert.equal(repaired.claimStatus, "RECOVERED");
    assert.equal((await repository.getCampaign(campaign.id))?.status, "CLAIMED");

    const repairedAgain = await repairTerminalOneClickPayout(
      repository,
      (await repository.getClaim(claim.id))!,
      (await repository.getCampaign(campaign.id))!,
    );
    assert.equal(repairedAgain.claimStatus, "RECOVERED");
    assert.equal(
      (
        await repository.listEvents("CLAIM", claim.id)
      ).filter(
        (event) =>
          event.eventType === "ONE_CLICK_PAYOUT_REFUNDED_TO_WINNER",
      ).length,
      1,
    );
  });
});
