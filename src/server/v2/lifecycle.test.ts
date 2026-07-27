import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { POST as postExpiredRefund } from "../../../app/api/v2/campaigns/[id]/refund/route";
import { MemoryRepository, resetMemoryRepositoryForTests } from "./memory-repository";
import { resetRepositorySingletonForTests } from "./repository-factory";
import {
  getCampaignLifecycleStatus,
  requestCampaignCancellation,
  requestExpiredCampaignRefund,
} from "./services";
import type { Campaign, FundingOrder, FundingQuote } from "./types";
import type { OnChainCampaign } from "./chain/types";

const creator = { id: "creator-actor", email: "creator@example.test", demo: false };
const anonymousRelay = {
  id: "anonymous:7c04a1f021ac99f7",
  email: null,
  demo: false,
};
const nowMs = new Date("2026-07-24T20:00:00.000Z").getTime();

async function fundedCampaign(
  repository: MemoryRepository,
  status: Campaign["status"],
  overrides: Partial<Parameters<MemoryRepository["createCampaign"]>[0]> = {},
): Promise<{ campaign: Campaign; order: FundingOrder }> {
  const campaign = await repository.createCampaign({
    id: "campaign-lifecycle",
    slug: "campaign-lifecycle",
    creatorId: creator.id,
    creatorAccountId: "creator.testnet",
    title: "Lifecycle campaign",
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
          clue: "Across",
          row: 0,
          column: 0,
          direction: "across",
          length: 3,
        },
      ],
    },
    contentHash: "ab".repeat(32),
    solutionPublicKey: Buffer.alloc(32, 7).toString("base64"),
    reward: {
      type: "TOKEN_PRIZE",
      assetId: "nep141:usdc.testnet",
      amountAtomic: "1000000",
      decimals: 6,
      symbol: "USDC",
    },
    contractId: "campaigns.testnet",
    openingAt: "2026-07-24T21:00:00.000Z",
    expiresAt: "2026-07-31T21:00:00.000Z",
    refundAccount: "creator.testnet",
    fundingReference: "intents:settlement-1",
    chainCampaignId: "campaign-lifecycle",
    ...overrides,
  });
  const quote: FundingQuote = {
    rail: "ONE_CLICK",
    origin: { assetId: "eth:usdc", amountAtomic: "1001000" },
    principal: {
      assetId: "nep141:usdc.testnet",
      amountAtomic: "1000000",
    },
    routingFee: { assetId: "eth:usdc", amountAtomic: "1000" },
    platformFee: { assetId: "eth:usdc", amountAtomic: "0" },
    depositAddress: "deposit.testnet",
    depositMemo: null,
    deadline: "2026-07-24T20:05:00.000Z",
    providerQuoteId: "quote-1",
    providerStatus: "SUCCESS",
    rawDigest: "quote-digest",
    instructions: {},
  };
  const result = await repository.createFundingOrderIdempotent({
    id: "funding-lifecycle",
    campaignId: campaign.id,
    creatorId: creator.id,
    rail: "ONE_CLICK",
    status: "ALLOCATED",
    idempotencyKey: "funding-lifecycle-key",
    originAssetId: "eth:usdc",
    destinationAssetId: "nep141:usdc.testnet",
    principalAmountAtomic: "1000000",
    inputAmountAtomic: "1001000",
    routingFeeAtomic: "1000",
    platformFeeAtomic: "0",
    refundTo: "0x0000000000000000000000000000000000000001",
    quote,
    providerReference: "quote-1",
    depositAddress: "deposit.testnet",
    depositTxHash: "deposit-hash",
    settlementTxHash: "settlement-hash",
    fundingReference: "intents:settlement-1",
    evidence: {},
    expiresAt: quote.deadline,
  });
  return { campaign, order: result.fundingOrder };
}

function chainCampaign(campaign: Campaign): OnChainCampaign {
  return {
    campaignId: campaign.id,
    creatorId: "creator.testnet",
    controllerId: "creator.testnet",
    sponsorId: "creator.testnet",
    contentHash: Buffer.from(campaign.contentHash!, "hex").toString("base64"),
    solutionPublicKey: campaign.solutionPublicKey!,
    amount: "1000000",
    opensAtMs: String(new Date(campaign.openingAt!).getTime()),
    expiresAtMs: String(new Date(campaign.expiresAt!).getTime()),
    refundAccountId: "creator.testnet",
    claimNonce: "0",
    fundingReference: "intents:settlement-1",
    fundingRail: "intents",
    status: { state: "scheduled" },
  };
}

beforeEach(() => {
  resetMemoryRepositoryForTests();
  resetRepositorySingletonForTests();
});

describe("v2 campaign lifecycle services", () => {
  it("records an authenticated creator cancellation and enqueues its refund", async () => {
    const repository = new MemoryRepository();
    const { campaign } = await fundedCampaign(repository, "SCHEDULED");

    await assert.rejects(
      requestCampaignCancellation(
        repository,
        { id: "other", email: null, demo: false },
        campaign.id,
        { expectedVersion: campaign.version },
        nowMs,
      ),
      /Only the creator/,
    );
    const cancelled = await requestCampaignCancellation(
      repository,
      creator,
      campaign.id,
      { expectedVersion: campaign.version },
      nowMs,
    );
    assert.equal(cancelled.status, "REFUNDING");
    const jobs = await repository.leaseJobs(
      "refund-worker",
      10,
      "2026-07-24T21:00:00.000Z",
      "2026-07-24T20:00:00.000Z",
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].type, "REFUND_CAMPAIGN");
    assert.equal(
      (jobs[0].payload as Record<string, unknown>).reason,
      "CREATOR_CANCEL",
    );
  });

  it("allows an anonymous expiry relay and records only sanitized immutable evidence", async () => {
    const repository = new MemoryRepository();
    const { campaign, order } = await fundedCampaign(repository, "ACTIVE", {
      openingAt: "2026-07-24T18:00:00.000Z",
      expiresAt: "2026-07-24T19:00:00.000Z",
    });
    const refunding = await requestExpiredCampaignRefund(
      repository,
      anonymousRelay,
      campaign.id,
      { expectedVersion: campaign.version },
      nowMs,
    );
    assert.equal(refunding.status, "REFUNDING");
    const [event] = await repository.listEvents("CAMPAIGN", campaign.id);
    assert.equal(event.eventType, "EXPIRY_REFUND_REQUESTED");
    assert.equal(event.actorId, anonymousRelay.id);
    assert.equal(event.idempotencyKey, `expired:${campaign.id}:${campaign.version}`);
    assert.deepEqual(event.evidence, {
      fundingOrderId: order.id,
      relay: "permissionless",
    });
    const [job] = await repository.leaseJobs(
      "refund-worker",
      10,
      "2026-07-24T21:00:00.000Z",
      "2026-07-24T20:00:00.000Z",
    );
    assert.deepEqual(job.payload, {
      campaignId: campaign.id,
      fundingOrderId: order.id,
      reason: "EXPIRED",
    });
  });

  it("accepts the public refund endpoint without a creator session", async () => {
    const priorFundingMode = process.env.V2_FUNDING_MODE;
    const priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.V2_FUNDING_MODE = "mock";
    delete process.env.DATABASE_URL;
    resetRepositorySingletonForTests();
    try {
      const repository = new MemoryRepository();
      const { campaign } = await fundedCampaign(repository, "ACTIVE", {
        openingAt: "2026-07-24T18:00:00.000Z",
        expiresAt: "2026-07-24T19:00:00.000Z",
      });
      const response = await postExpiredRefund(
        new Request(
          `http://localhost/api/v2/campaigns/${campaign.id}/refund`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "user-agent": "anonymous-refund-test",
            },
            body: JSON.stringify({ expectedVersion: campaign.version }),
          },
        ),
        { params: Promise.resolve({ id: campaign.id }) },
      );
      assert.equal(response.status, 202);
      const [event] = await repository.listEvents("CAMPAIGN", campaign.id);
      assert.match(event.actorId ?? "", /^anonymous:[a-f0-9]{24}$/);
    } finally {
      if (priorFundingMode === undefined) {
        delete process.env.V2_FUNDING_MODE;
      } else {
        process.env.V2_FUNDING_MODE = priorFundingMode;
      }
      if (priorDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = priorDatabaseUrl;
      }
      resetRepositorySingletonForTests();
    }
  });

  it("rejects an anonymous expiry relay before the immutable deadline", async () => {
    const repository = new MemoryRepository();
    const { campaign } = await fundedCampaign(repository, "ACTIVE", {
      openingAt: "2026-07-24T18:00:00.000Z",
      expiresAt: "2026-07-24T21:00:00.000Z",
    });
    await assert.rejects(
      requestExpiredCampaignRefund(
        repository,
        anonymousRelay,
        campaign.id,
        { expectedVersion: campaign.version },
        nowMs,
      ),
      /not eligible for expiry refund/,
    );
    assert.equal((await repository.getCampaign(campaign.id))?.status, "ACTIVE");
    assert.deepEqual(
      await repository.listEvents("CAMPAIGN", campaign.id),
      [],
    );
  });

  it("rejects every caller-provided refund or payout destination", async () => {
    const repository = new MemoryRepository();
    const { campaign } = await fundedCampaign(repository, "ACTIVE", {
      openingAt: "2026-07-24T18:00:00.000Z",
      expiresAt: "2026-07-24T19:00:00.000Z",
    });
    await assert.rejects(
      requestExpiredCampaignRefund(
        repository,
        anonymousRelay,
        campaign.id,
        {
          expectedVersion: campaign.version,
          refundAccount: "attacker.testnet",
          recipient: "attacker.testnet",
        },
        nowMs,
      ),
      /accept only expectedVersion/,
    );
    assert.equal((await repository.getCampaign(campaign.id))?.status, "ACTIVE");
    assert.deepEqual(
      await repository.listEvents("CAMPAIGN", campaign.id),
      [],
    );
  });

  it("coalesces an exact concurrent expiry relay and safely replays it", async () => {
    const repository = new MemoryRepository();
    const { campaign } = await fundedCampaign(repository, "ACTIVE", {
      openingAt: "2026-07-24T18:00:00.000Z",
      expiresAt: "2026-07-24T19:00:00.000Z",
    });
    const request = () =>
      requestExpiredCampaignRefund(
        repository,
        anonymousRelay,
        campaign.id,
        { expectedVersion: campaign.version },
        nowMs,
      );
    const [first, concurrent] = await Promise.all([request(), request()]);
    const replay = await request();
    assert.equal(first.status, "REFUNDING");
    assert.equal(concurrent.status, "REFUNDING");
    assert.equal(replay.status, "REFUNDING");
    assert.equal(
      (await repository.listEvents("CAMPAIGN", campaign.id)).length,
      1,
    );
    const jobs = await repository.leaseJobs(
      "refund-worker",
      10,
      "2026-07-24T21:00:00.000Z",
      "2026-07-24T20:00:00.000Z",
    );
    assert.equal(jobs.length, 1);
    await assert.rejects(
      requestExpiredCampaignRefund(
        repository,
        anonymousRelay,
        campaign.id,
        { expectedVersion: campaign.version + 10 },
        nowMs,
      ),
      /Campaign changed before the refund request/,
    );
  });

  it("reactivates the exact dead refund job only on an authenticated retry", async () => {
    const repository = new MemoryRepository();
    const { campaign, order } = await fundedCampaign(repository, "REFUNDING");
    const deadCandidate = await repository.enqueueJob({
      type: "REFUND_CAMPAIGN",
      aggregateType: "CAMPAIGN",
      aggregateId: campaign.id,
      deduplicationKey: `campaign-refund:${campaign.id}:creator_cancel`,
      payload: {
        campaignId: campaign.id,
        fundingOrderId: order.id,
        reason: "CREATOR_CANCEL",
      },
      maxAttempts: 1,
      runAfter: "2026-07-24T19:59:00.000Z",
    });
    const [leased] = await repository.leaseJobs(
      "failed-worker",
      1,
      "2026-07-24T20:01:00.000Z",
      "2026-07-24T20:00:00.000Z",
    );
    assert.equal(leased.id, deadCandidate.job.id);
    const dead = await repository.failJob(
      leased.id,
      "failed-worker",
      "simulated terminal failure",
      "2026-07-24T20:00:05.000Z",
    );
    assert.equal(dead?.status, "DEAD");

    await requestCampaignCancellation(
      repository,
      creator,
      campaign.id,
      { expectedVersion: campaign.version },
      nowMs,
    );
    const [revived] = await repository.leaseJobs(
      "recovery-worker",
      1,
      "2026-07-24T20:02:00.000Z",
      "2026-07-24T20:00:00.000Z",
    );
    assert.equal(revived.id, deadCandidate.job.id);
    assert.equal(revived.attempts, 1);
    assert.equal(revived.lastError, null);
  });

  it("returns creator-only ledger and final-chain status", async () => {
    const repository = new MemoryRepository();
    const { campaign, order } = await fundedCampaign(repository, "SCHEDULED");
    const onChain = chainCampaign(campaign);
    const status = await getCampaignLifecycleStatus(
      repository,
      creator,
      campaign.id,
      async () => onChain,
    );
    assert.equal(status.fundingOrder?.id, order.id);
    assert.deepEqual(status.onChain, onChain);
    assert.equal(status.chainUnavailable, false);
    await assert.rejects(
      getCampaignLifecycleStatus(
        repository,
        { id: "other", email: null, demo: false },
        campaign.id,
        async () => onChain,
      ),
      /Only the creator/,
    );
  });

  it("returns the durable creator ledger while final chain state is unavailable", async () => {
    const repository = new MemoryRepository();
    const { campaign, order } = await fundedCampaign(repository, "SCHEDULED");
    const status = await getCampaignLifecycleStatus(
      repository,
      creator,
      campaign.id,
      async () => {
        throw new Error("RPC unavailable");
      },
    );
    assert.equal(status.fundingOrder?.id, order.id);
    assert.equal(status.onChain, null);
    assert.equal(status.chainUnavailable, true);
  });

  it("includes scheduled and active campaigns in public discovery", async () => {
    const repository = new MemoryRepository();
    await fundedCampaign(repository, "SCHEDULED");
    await repository.createCampaign({
      ...(await repository.getCampaign("campaign-lifecycle"))!,
      id: "campaign-active",
      slug: "campaign-active",
      status: "ACTIVE",
    });
    await repository.createCampaign({
      ...(await repository.getCampaign("campaign-lifecycle"))!,
      id: "campaign-draft",
      slug: "campaign-draft",
      status: "DRAFT",
    });
    const result = await repository.listCampaigns({
      statuses: ["SCHEDULED", "ACTIVE"],
      visibility: "PUBLIC",
      limit: 20,
      offset: 0,
    });
    assert.deepEqual(
      result.campaigns.map((campaign) => campaign.status).sort(),
      ["ACTIVE", "SCHEDULED"],
    );
  });
});
