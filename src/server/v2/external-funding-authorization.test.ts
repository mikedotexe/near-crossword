import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  hasVerifiedExternalFundingAuthorization,
  maskFundingOrderUntilAuthorization,
  verifyExternalFundingAuthorization,
} from "./external-funding-authorization";
import {
  MemoryRepository,
  resetMemoryRepositoryForTests,
} from "./memory-repository";
import type {
  Actor,
  Campaign,
  FundingOrder,
  FundingQuote,
} from "./types";
import type { OnChainExternalFundingAuthorization } from "./chain/types";

const actor: Actor = {
  id: "creator-user",
  email: "creator@example.test",
  demo: false,
};
const campaignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const fundingOrderId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const providerReference = "one-click-quote-123";
const contractId = "crossword-campaigns-v2.testnet";
const creatorAccountId = "creator.testnet";
const contentHash = Buffer.alloc(32, 3).toString("hex");
const contentHashBase64 = Buffer.alloc(32, 3).toString("base64");
const solutionPublicKey = Buffer.alloc(32, 7).toString("base64");
const openingAt = "2026-07-25T00:00:00.000Z";
const expiresAt = "2026-08-01T00:00:00.000Z";
const verifiedAt = "2026-07-24T20:00:00.000Z";

function quote(): FundingQuote {
  return {
    rail: "ONE_CLICK",
    origin: {
      assetId: "eth:usdc",
      amountAtomic: "25125000",
    },
    principal: {
      assetId: "nep141:usdc.testnet",
      amountAtomic: "25000000",
    },
    estimatedDelivery: {
      assetId: "nep141:usdc.testnet",
      amountAtomic: "25000000",
    },
    routingFee: {
      assetId: "eth:usdc",
      amountAtomic: "125000",
    },
    platformFee: {
      assetId: "eth:usdc",
      amountAtomic: "0",
    },
    depositAddress: "0xdeposit-address-must-stay-hidden",
    depositMemo: "private-deposit-memo",
    deadline: "2026-07-24T20:30:00.000Z",
    providerQuoteId: providerReference,
    providerStatus: "PENDING_DEPOSIT",
    rawDigest: "quote-digest",
    instructions: {
      provider: "1click",
      depositAddress: "0xdeposit-address-must-stay-hidden",
      depositAmountAtomic: "25125000",
      creatorAuthorization: {
        contractId,
        methodName: "authorize_external_funding",
        args: {
          funding_reference: providerReference,
          amount: "25000000",
        },
      },
    },
  };
}

async function fixture(
  repository: MemoryRepository,
  rail: FundingOrder["rail"] = "ONE_CLICK",
): Promise<{ campaign: Campaign; order: FundingOrder }> {
  const campaign = await repository.createCampaign({
    id: campaignId,
    slug: "authorization-handshake",
    creatorId: actor.id,
    creatorAccountId,
    title: "Authorization handshake",
    description: null,
    sponsorName: "Sponsor",
    sponsorUrl: null,
    visibility: "PUBLIC",
    status: "FUNDING",
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
    contentHash,
    solutionPublicKey,
    reward: {
      type: "TOKEN_PRIZE",
      assetId: "nep141:usdc.testnet",
      amountAtomic: "25000000",
      decimals: 6,
      symbol: "USDC",
    },
    contractId,
    openingAt,
    expiresAt,
    refundAccount: creatorAccountId,
    fundingReference: null,
    chainCampaignId: null,
  });
  const created = await repository.createFundingOrderIdempotent({
    id: fundingOrderId,
    campaignId,
    creatorId: actor.id,
    rail,
    status: "AWAITING_DEPOSIT",
    idempotencyKey: "authorization-test-key",
    originAssetId: "eth:usdc",
    destinationAssetId: "nep141:usdc.testnet",
    principalAmountAtomic: "25000000",
    inputAmountAtomic: "25125000",
    routingFeeAtomic: "125000",
    platformFeeAtomic: "0",
    refundTo: creatorAccountId,
    quote: {
      ...quote(),
      rail,
    },
    providerReference,
    depositAddress: "0xdeposit-address-must-stay-hidden",
    depositTxHash: null,
    settlementTxHash: null,
    fundingReference: null,
    evidence: { quoteDigest: "quote-digest" },
    expiresAt: "2026-07-24T20:30:00.000Z",
  });
  return { campaign, order: created.fundingOrder };
}

function authorization(
  patch: Partial<OnChainExternalFundingAuthorization> = {},
): OnChainExternalFundingAuthorization {
  return {
    campaignId,
    creatorId: creatorAccountId,
    controllerId: creatorAccountId,
    sponsorId: creatorAccountId,
    contentHash: contentHashBase64,
    solutionPublicKey,
    amount: "25000000",
    opensAtMs: String(new Date(openingAt).getTime()),
    expiresAtMs: String(new Date(expiresAt).getTime()),
    refundAccountId: creatorAccountId,
    fundingReference: providerReference,
    fundingRail: "intents",
    fundingDeadlineMs: String(
      new Date("2026-07-24T20:45:00.000Z").getTime(),
    ),
    expired: false,
    pending: false,
    storageDeposit: "1230000000000000000000",
    ...patch,
  };
}

beforeEach(() => {
  resetMemoryRepositoryForTests();
});

describe("external funding creator authorization", () => {
  it("reveals the deposit only after every immutable final view field matches", async () => {
    const repository = new MemoryRepository();
    await fixture(repository);
    const reads: Array<{ reference: string; contract: string }> = [];
    const first = await verifyExternalFundingAuthorization(
      repository,
      actor,
      fundingOrderId,
      {
        readAuthorization: async (reference, contract) => {
          reads.push({ reference, contract });
          return authorization();
        },
        now: () => new Date(verifiedAt),
      },
    );

    assert.deepEqual(reads, [
      { reference: providerReference, contract: contractId },
    ]);
    assert.deepEqual(first, {
      fundingOrder: {
        id: fundingOrderId,
        campaignId,
        status: "AWAITING_DEPOSIT",
        version: 2,
      },
      authorization: {
        contractId,
        campaignId,
        fundingReference: providerReference,
        fundingDeadlineMs: String(
          new Date("2026-07-24T20:45:00.000Z").getTime(),
        ),
        verifiedAt,
      },
      deposit: {
        depositAddress: "0xdeposit-address-must-stay-hidden",
        depositMemo: "private-deposit-memo",
        originAssetId: "eth:usdc",
        inputAmountAtomic: "25125000",
        deadline: "2026-07-24T20:30:00.000Z",
        providerQuoteId: providerReference,
        instructions: quote().instructions,
      },
    });
    assert.deepEqual((await repository.getFundingOrder(fundingOrderId))?.evidence, {
      quoteDigest: "quote-digest",
      authorizationVerifiedAt: verifiedAt,
      authorizationFundingReference: providerReference,
      authorizationContractId: contractId,
    });
    const verifiedOrder = await repository.getFundingOrder(fundingOrderId);
    assert.ok(verifiedOrder);
    assert.equal(
      hasVerifiedExternalFundingAuthorization(verifiedOrder, contractId),
      true,
    );

    const replay = await verifyExternalFundingAuthorization(
      repository,
      actor,
      fundingOrderId,
      {
        readAuthorization: async () => {
          reads.push({ reference: providerReference, contract: contractId });
          return authorization();
        },
        now: () => new Date("2026-07-24T20:05:00.000Z"),
      },
    );
    assert.equal(replay.authorization.verifiedAt, verifiedAt);
    assert.equal(replay.fundingOrder.version, 2);
    assert.equal(reads.length, 2, "each request must independently read finality");
  });

  it("fails closed when final authorization is absent or any field differs", async () => {
    const repository = new MemoryRepository();
    await fixture(repository);
    await assert.rejects(
      verifyExternalFundingAuthorization(repository, actor, fundingOrderId, {
        readAuthorization: async () => null,
        now: () => new Date(verifiedAt),
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "CREATOR_AUTHORIZATION_NOT_FINAL",
    );
    await assert.rejects(
      verifyExternalFundingAuthorization(repository, actor, fundingOrderId, {
        readAuthorization: async () =>
          authorization({ refundAccountId: "attacker.testnet" }),
        now: () => new Date(verifiedAt),
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "CREATOR_AUTHORIZATION_MISMATCH",
    );
    await assert.rejects(
      verifyExternalFundingAuthorization(repository, actor, fundingOrderId, {
        readAuthorization: async () =>
          authorization({ fundingDeadlineMs: "1" }),
        now: () => new Date(verifiedAt),
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "CREATOR_AUTHORIZATION_MISMATCH",
    );
    await assert.rejects(
      verifyExternalFundingAuthorization(repository, actor, fundingOrderId, {
        readAuthorization: async () => authorization({ expired: true }),
        now: () => new Date(verifiedAt),
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "CREATOR_AUTHORIZATION_EXPIRED",
    );
    const stored = await repository.getFundingOrder(fundingOrderId);
    assert.equal(
      "authorizationVerifiedAt" in (stored?.evidence as Record<string, unknown>),
      false,
    );
  });

  it("never accepts mock orders as proof of a live 1Click authorization", async () => {
    const repository = new MemoryRepository();
    await fixture(repository, "MOCK");
    let read = false;
    await assert.rejects(
      verifyExternalFundingAuthorization(repository, actor, fundingOrderId, {
        readAuthorization: async () => {
          read = true;
          return authorization();
        },
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "FUNDING_ORDER_NOT_LIVE",
    );
    assert.equal(read, false);
  });

  it("never releases a final authorization's stale provider deposit target", async () => {
    const repository = new MemoryRepository();
    await fixture(repository);
    let read = false;
    await assert.rejects(
      verifyExternalFundingAuthorization(repository, actor, fundingOrderId, {
        readAuthorization: async () => {
          read = true;
          return authorization();
        },
        now: () => new Date("2026-07-24T20:30:00.000Z"),
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "FUNDING_ORDER_NOT_LIVE",
    );
    assert.equal(read, false);
  });

  it("masks all 1Click deposit material while preserving only the wallet call", async () => {
    const repository = new MemoryRepository();
    const { order } = await fixture(repository);
    assert.equal(
      hasVerifiedExternalFundingAuthorization(order, contractId),
      false,
    );
    const masked = maskFundingOrderUntilAuthorization(order);
    assert.equal(masked.depositAddress, null);
    assert.equal(masked.inputAmountAtomic, null);
    assert.equal(masked.quote.origin.amountAtomic, null);
    assert.equal(masked.quote.depositAddress, null);
    assert.equal(masked.quote.depositMemo, null);
    assert.deepEqual(masked.quote.instructions, {
      creatorAuthorization: (
        quote().instructions as Record<string, unknown>
      ).creatorAuthorization,
    });
    const serialized = JSON.stringify(masked);
    assert.equal(serialized.includes("0xdeposit-address-must-stay-hidden"), false);
    assert.equal(serialized.includes("private-deposit-memo"), false);
    assert.equal(serialized.includes("\"depositAmountAtomic\":\"25125000\""), false);
  });
});
