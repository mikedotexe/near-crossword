import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  MemoryRepository,
  resetMemoryRepositoryForTests,
} from "./memory-repository";
import type { Repository } from "./repository";
import type { Campaign, FundingOrder, FundingQuote } from "./types";
import type { OnChainCampaign } from "./chain/types";
import { getCampaignEvidence, reconcileSolvency } from "./transparency";

const CAMPAIGN_ID = "99999999-9999-4999-8999-999999999999";
const CONTRACT_ID = "crossword-campaigns-v2.testnet";
const USDC_ID = "mock-usdc.testnet";
const CONTENT_HASH = "ab".repeat(32);

beforeEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  process.env.V2_FUNDING_MODE = "mock";
  process.env.NEAR_NETWORK = "testnet";
  delete process.env.NEXT_PUBLIC_NEAR_NETWORK;
  delete process.env.V2_CONTRACT_ID;
  delete process.env.V2_USDC_ASSET_ID;
  delete process.env.V2_USDC_CONTRACT_ID;
  resetMemoryRepositoryForTests();
});

async function createActiveCampaign(repository: Repository): Promise<Campaign> {
  return repository.createCampaign({
    id: CAMPAIGN_ID,
    slug: "public-evidence",
    creatorId: "creator:private-ledger-id",
    creatorAccountId: "creator.testnet",
    title: "Public evidence crossword",
    description: null,
    sponsorName: "Evidence sponsor",
    sponsorUrl: null,
    visibility: "PUBLIC",
    status: "ACTIVE",
    puzzle: {
      width: 3,
      height: 3,
      clues: [
        {
          number: 1,
          clue: "Visible clue",
          row: 0,
          column: 0,
          direction: "across",
          length: 3,
        },
      ],
    },
    contentHash: CONTENT_HASH,
    solutionPublicKey: Buffer.alloc(32, 7).toString("base64"),
    reward: {
      type: "TOKEN_PRIZE",
      assetId: `nep141:${USDC_ID}`,
      amountAtomic: "1000000",
      decimals: 6,
      symbol: "USDC",
    },
    contractId: CONTRACT_ID,
    openingAt: "2026-07-24T19:00:00.000Z",
    expiresAt: "2026-07-31T19:00:00.000Z",
    refundAccount: "creator.testnet",
    fundingReference: "funding:public-reference",
    chainCampaignId: CAMPAIGN_ID,
  });
}

function quote(): FundingQuote {
  return {
    rail: "ONE_CLICK",
    origin: { assetId: "eth:usdc", amountAtomic: "1005000" },
    principal: {
      assetId: `nep141:${USDC_ID}`,
      amountAtomic: "1000000",
    },
    routingFee: { assetId: "eth:usdc", amountAtomic: "5000" },
    platformFee: { assetId: "eth:usdc", amountAtomic: "0" },
    depositAddress: "secret-deposit.testnet",
    depositMemo: null,
    deadline: "2026-07-24T20:05:00.000Z",
    providerQuoteId: "provider-private-reference",
    providerStatus: "SUCCESS",
    rawDigest: "quote-public-digest",
    instructions: { authorization: "must-never-be-public" },
  };
}

async function createAllocatedOrder(
  repository: Repository,
): Promise<FundingOrder> {
  return (
    await repository.createFundingOrderIdempotent({
      campaignId: CAMPAIGN_ID,
      creatorId: "creator:private-ledger-id",
      rail: "ONE_CLICK",
      status: "ALLOCATED",
      idempotencyKey: "private-idempotency-key",
      originAssetId: "eth:usdc",
      destinationAssetId: `nep141:${USDC_ID}`,
      principalAmountAtomic: "1000000",
      inputAmountAtomic: "1005000",
      routingFeeAtomic: "5000",
      platformFeeAtomic: "0",
      refundTo: "private-refund-destination",
      quote: quote(),
      providerReference: "provider-private-reference",
      depositAddress: "secret-deposit.testnet",
      depositTxHash: "origin-chain-deposit-hash",
      settlementTxHash: "intents-settlement-hash",
      fundingReference: "funding:public-reference",
      evidence: {
        quoteDigest: "quote-public-digest",
        allocationTxHash: "near-allocation-transaction",
      },
      expiresAt: "2026-07-24T20:05:00.000Z",
    })
  ).fundingOrder;
}

function onChainCampaign(): OnChainCampaign {
  return {
    campaignId: CAMPAIGN_ID,
    creatorId: "creator.testnet",
    controllerId: "creator.testnet",
    sponsorId: "creator.testnet",
    contentHash: Buffer.from(CONTENT_HASH, "hex").toString("base64"),
    solutionPublicKey: Buffer.alloc(32, 7).toString("base64"),
    amount: "1000000",
    opensAtMs: String(Date.parse("2026-07-24T19:00:00.000Z")),
    expiresAtMs: String(Date.parse("2026-07-31T19:00:00.000Z")),
    refundAccountId: "creator.testnet",
    claimNonce: "0",
    fundingReference: "funding:public-reference",
    fundingRail: "intents",
    status: { state: "active" },
  };
}

describe("public campaign evidence and solvency", () => {
  it("publishes matched chain evidence without leaking quote instructions or recovery data", async () => {
    const repository = new MemoryRepository();
    await createActiveCampaign(repository);
    await createAllocatedOrder(repository);
    const evidence = await getCampaignEvidence(repository, CAMPAIGN_ID, {
      readCampaign: async () => onChainCampaign(),
    });
    assert.equal(evidence.funding?.fundedAndLocked, true);
    assert.equal(evidence.contract.evidenceMatchesLedger, true);
    assert.match(
      evidence.contract.explorerUrl,
      /^https:\/\/testnet\.nearblocks\.io\/address\//,
    );
    assert.match(
      evidence.funding?.allocationExplorerUrl ?? "",
      /^https:\/\/testnet\.nearblocks\.io\/txns\//,
    );
    const serialized = JSON.stringify(evidence);
    assert.equal(serialized.includes("must-never-be-public"), false);
    assert.equal(serialized.includes("secret-deposit.testnet"), false);
    assert.equal(serialized.includes("private-refund-destination"), false);
    assert.equal(serialized.includes("private-idempotency-key"), false);
    assert.equal(serialized.includes("provider-private-reference"), false);
  });

  it("fails closed when any prize-critical contract term or lifecycle differs", async () => {
    const repository = new MemoryRepository();
    await createActiveCampaign(repository);
    await createAllocatedOrder(repository);
    const mutations: Array<
      [string, (campaign: OnChainCampaign) => void]
    > = [
      ["creator", (campaign) => { campaign.creatorId = "other.testnet"; }],
      ["controller", (campaign) => { campaign.controllerId = "other.testnet"; }],
      ["sponsor", (campaign) => { campaign.sponsorId = "other.testnet"; }],
      ["refund", (campaign) => { campaign.refundAccountId = "other.testnet"; }],
      ["content", (campaign) => { campaign.contentHash = Buffer.alloc(32, 9).toString("base64"); }],
      ["solution", (campaign) => { campaign.solutionPublicKey = Buffer.alloc(32, 9).toString("base64"); }],
      ["amount", (campaign) => { campaign.amount = "999999"; }],
      ["opening", (campaign) => { campaign.opensAtMs = "1"; }],
      ["expiry", (campaign) => { campaign.expiresAtMs = "2"; }],
      ["reference", (campaign) => { campaign.fundingReference = "different"; }],
      ["rail", (campaign) => { campaign.fundingRail = "direct_usdc"; }],
      ["lifecycle", (campaign) => { campaign.status = { state: "refunded" }; }],
    ];

    for (const [label, mutate] of mutations) {
      const onChain = structuredClone(onChainCampaign());
      mutate(onChain);
      const evidence = await getCampaignEvidence(repository, CAMPAIGN_ID, {
        readCampaign: async () => onChain,
      });
      assert.equal(
        evidence.contract.evidenceMatchesLedger,
        false,
        `${label} mismatch must fail verification`,
      );
      assert.equal(
        evidence.funding?.fundedAndLocked,
        false,
        `${label} mismatch must not claim locked funding`,
      );
    }
  });

  it("matches terminal receipts without calling released principal locked", async () => {
    const repository = new MemoryRepository();
    const active = await createActiveCampaign(repository);
    await createAllocatedOrder(repository);
    const claiming = await repository.transitionCampaign(
      active.id,
      ["ACTIVE"],
      "CLAIMING",
      active.version,
    );
    assert.ok(claiming);
    const claimed = await repository.transitionCampaign(
      active.id,
      ["CLAIMING"],
      "CLAIMED",
      claiming.version,
    );
    assert.ok(claimed);
    const terminal = onChainCampaign();
    terminal.status = {
      state: "claimed",
      receiverId: "winner.testnet",
      payoutDigest: Buffer.alloc(32, 4).toString("base64"),
      nonce: "0",
      deadlineMs: String(Date.parse("2026-07-25T00:00:00.000Z")),
      claimedAtMs: String(Date.parse("2026-07-24T21:00:00.000Z")),
    };
    const evidence = await getCampaignEvidence(repository, CAMPAIGN_ID, {
      readCampaign: async () => terminal,
    });
    assert.equal(evidence.contract.evidenceMatchesLedger, true);
    assert.equal(evidence.funding?.fundedAndLocked, false);
    assert.equal(evidence.funding?.principalStillReserved, false);
  });

  it("reports a healthy read-only reconciliation when all three ledgers agree", async () => {
    const repository = new MemoryRepository();
    await createActiveCampaign(repository);
    const result = await reconcileSolvency(repository, {
      now: () => new Date("2026-07-24T20:00:00.000Z"),
      viewCall: async (_accountId, methodName) =>
        methodName === "get_accounting"
          ? {
              total_reserved: "1000000",
              computed_liabilities: "1000000",
              invariant_holds: true,
            }
          : "1000000",
    });
    assert.equal(result.healthy, true);
    assert.equal(result.readOnly, true);
    assert.equal(result.workflowLedger.liveCampaignCount, 1);
    assert.equal(result.deltas.contractMinusLedgerAtomic, "0");
    assert.equal(result.deltas.tokenBalanceMinusReservedAtomic, "0");
  });

  it("separates contract escrow from a cross-chain payout already in routing", async () => {
    const repository = new MemoryRepository();
    const active = await createActiveCampaign(repository);
    const claiming = await repository.transitionCampaign(
      active.id,
      ["ACTIVE"],
      "CLAIMING",
      active.version,
    );
    assert.ok(claiming);
    await repository.createClaimIdempotent({
      id: "88888888-8888-4888-8888-888888888888",
      campaignId: active.id,
      claimantId: null,
      status: "PAYING",
      idempotencyKey: "routing-claim",
      payout: {
        kind: "ONE_CLICK",
        destinationAsset: "eth:usdc",
        recipient: "0x1111111111111111111111111111111111111111",
        recoveryAccount: "winner.testnet",
      },
      payoutQuote: quote(),
      solutionProofDigest: null,
      solutionProof: null,
      contractTxHash: "contract-deposit-tx",
      settlementTxHash: null,
      evidence: {
        contractState: "claimed",
        downstreamStatus: "AWAITING_PROVIDER_TERMINAL",
      },
      expiresAt: "2026-07-25T00:00:00.000Z",
    });

    const result = await reconcileSolvency(repository, {
      viewCall: async (_accountId, methodName) =>
        methodName === "get_accounting"
          ? {
              total_reserved: "0",
              computed_liabilities: "0",
              invariant_holds: true,
            }
          : "0",
    });
    assert.equal(result.healthy, true);
    assert.equal(result.workflowLedger.escrowLiabilitiesAtomic, "0");
    assert.equal(result.workflowLedger.escrowCampaignCount, 0);
    assert.equal(result.workflowLedger.routingInFlightAmountAtomic, "1000000");
    assert.equal(result.workflowLedger.routingInFlightCampaignCount, 1);
  });

  it("surfaces contract, token-balance, and workflow-ledger divergence", async () => {
    const repository = new MemoryRepository();
    await createActiveCampaign(repository);
    const result = await reconcileSolvency(repository, {
      viewCall: async (_accountId, methodName) =>
        methodName === "get_accounting"
          ? {
              total_reserved: "2000000",
              computed_liabilities: "1900000",
              invariant_holds: false,
            }
          : "1500000",
    });
    assert.equal(result.healthy, false);
    assert.equal(result.checks.contractInvariant, false);
    assert.equal(result.checks.tokenBalanceCoversReserved, false);
    assert.equal(result.checks.ledgerMatchesContract, false);
    assert.equal(result.deltas.contractMinusLedgerAtomic, "1000000");
    assert.equal(result.deltas.tokenBalanceMinusReservedAtomic, "-500000");
  });
});
