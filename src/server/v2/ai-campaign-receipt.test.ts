import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  AI_GENERATION_IDEMPOTENCY_ACTOR,
  AI_GENERATION_IDEMPOTENCY_SCOPE,
  AI_GENERATION_RECEIPT_VERSION,
} from "./ai-receipt";
import {
  MemoryRepository,
  resetMemoryRepositoryForTests,
} from "./memory-repository";
import { publicCampaignView } from "./public-views";
import { createCampaign } from "./services";
import type { Actor } from "./types";
import { digestJson } from "./validation";

const actor: Actor = {
  id: "creator:ai-receipt-test",
  email: "creator@example.test",
  demo: true,
};
const paymentIdentifier = "ai_1234567890abcdef1234567890abcdef";
const settlementReference = "3Pj8QfV9hT2t7E4w6X1kLmN5sR8uY2aB4cD6eF7gH8iJ";
const paymentNetwork = "near:testnet";
const privateAnswer = "NEVERPUBLISH";
const privateAuthorization = "raw-payment-signature-must-not-escape";
const privatePrompt = "confidential launch topic";
const payerIdentity = "payer-private.testnet";

function campaignInput(id: string) {
  return {
    id,
    title: "AI-assisted campaign",
    description: "A paid draft with public receipt provenance",
    sponsorName: "Receipt test sponsor",
    creatorAccountId: "creator.testnet",
    refundAccount: "creator.testnet",
    visibility: "public",
    durationHours: 168,
    solutionPublicKey: Buffer.alloc(32, 7).toString("base64"),
    puzzle: {
      rows: 5,
      columns: 5,
      entries: [
        {
          number: 1,
          row: 0,
          column: 0,
          length: 5,
          direction: "across",
          clue: "Public clue one",
        },
        {
          number: 2,
          row: 0,
          column: 0,
          length: 5,
          direction: "down",
          clue: "Public clue two",
        },
        {
          number: 3,
          row: 4,
          column: 0,
          length: 5,
          direction: "across",
          clue: "Public clue three",
        },
      ],
    },
    reward: {
      type: "TOKEN_PRIZE",
      assetId: "nep141:mock-usdc.testnet",
      amountAtomic: "1000000",
      decimals: 6,
      symbol: "USDC",
    },
  };
}

function receiptHandle() {
  return {
    version: AI_GENERATION_RECEIPT_VERSION,
    paymentIdentifier,
  };
}

async function reservePaidGeneration(
  repository: MemoryRepository,
  options: { complete?: boolean; settlement?: string } = {},
) {
  const entries = [
    { clue: "Private generated clue one", answer: privateAnswer },
    { clue: "Private generated clue two", answer: "SECOND" },
    { clue: "Private generated clue three", answer: "THIRD" },
  ];
  const requestHash = digestJson({
    topic: privatePrompt,
    tone: "clever",
    count: 3,
  });
  await repository.reserveIdempotency(
    AI_GENERATION_IDEMPOTENCY_SCOPE,
    AI_GENERATION_IDEMPOTENCY_ACTOR,
    paymentIdentifier,
    requestHash,
    new Date(Date.now() + 60_000).toISOString(),
    {
      authorizationDigest: digestJson({
        authorization: privateAuthorization,
        payer: payerIdentity,
      }),
      stage: "SETTLED",
      responseBody: {
        entries,
        paymentRequirements: {},
        declaredExtensions: null,
        settlement: {
          transaction: options.settlement ?? settlementReference,
          network: paymentNetwork,
        },
      },
    },
  );
  if (options.complete === false) return;
  await repository.completeIdempotency(
    AI_GENERATION_IDEMPOTENCY_SCOPE,
    AI_GENERATION_IDEMPOTENCY_ACTOR,
    paymentIdentifier,
    200,
    {
      entries,
      receiptHandle: receiptHandle(),
      payment: {
        rail: "x402",
        paymentIdentifier,
        settlementReference: options.settlement ?? settlementReference,
        network: paymentNetwork,
      },
      cached: false,
    },
    settlementReference,
  );
}

beforeEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  process.env.V2_FUNDING_MODE = "mock";
  delete process.env.V2_USDC_ASSET_ID;
  delete process.env.V2_USDC_CONTRACT_ID;
  delete process.env.V2_CONTRACT_ID;
  resetMemoryRepositoryForTests();
});

describe("paid AI campaign receipt linkage", () => {
  it("links a completed durable receipt using only its minimal handle", async () => {
    const repository = new MemoryRepository();
    await reservePaidGeneration(repository);

    const campaign = await createCampaign(repository, actor, {
      ...campaignInput("11111111-1111-4111-8111-111111111111"),
      aiReceiptHandle: receiptHandle(),
    });

    assert.equal(
      campaign.aiGenerationReceipt?.paymentIdentifier,
      paymentIdentifier,
    );
    assert.equal(campaign.aiGenerationReceipt?.network, paymentNetwork);
    assert.equal(
      campaign.aiGenerationReceipt?.settlementReference,
      settlementReference,
    );
    assert.match(
      campaign.aiGenerationReceipt?.receiptDigest ?? "",
      /^[0-9a-f]{64}$/,
    );
    const [created] = await repository.listEvents("CAMPAIGN", campaign.id);
    assert.deepEqual(
      (created.evidence as Record<string, unknown>).aiGenerationReceipt,
      campaign.aiGenerationReceipt,
    );
  });

  it("rejects forged, incomplete, and client-embellished handles", async () => {
    const forgedRepository = new MemoryRepository();
    await assert.rejects(
      createCampaign(
        forgedRepository,
        actor,
        {
          ...campaignInput("21111111-1111-4111-8111-111111111111"),
          aiReceiptHandle: {
            version: AI_GENERATION_RECEIPT_VERSION,
            paymentIdentifier: "ai_ffffffffffffffffffffffffffffffff",
          },
        },
      ),
      /could not be verified/,
    );

    resetMemoryRepositoryForTests();
    const incompleteRepository = new MemoryRepository();
    await reservePaidGeneration(incompleteRepository, { complete: false });
    await assert.rejects(
      createCampaign(incompleteRepository, actor, {
        ...campaignInput("31111111-1111-4111-8111-111111111111"),
        aiReceiptHandle: receiptHandle(),
      }),
      /has not reached durable settlement/,
    );

    await assert.rejects(
      createCampaign(incompleteRepository, actor, {
        ...campaignInput("41111111-1111-4111-8111-111111111111"),
        aiReceiptHandle: {
          ...receiptHandle(),
          settlementReference: "client-supplied-claim",
        },
      }),
      /aiReceiptHandle is invalid/,
    );
  });

  it("consumes one paid generation at most once while manual campaigns remain valid", async () => {
    const repository = new MemoryRepository();
    await reservePaidGeneration(repository);
    await createCampaign(repository, actor, {
      ...campaignInput("51111111-1111-4111-8111-111111111111"),
      aiReceiptHandle: receiptHandle(),
    });

    await assert.rejects(
      createCampaign(repository, actor, {
        ...campaignInput("61111111-1111-4111-8111-111111111111"),
        aiReceiptHandle: receiptHandle(),
      }),
      /already linked to a campaign/,
    );

    const manual = await createCampaign(
      repository,
      actor,
      campaignInput("71111111-1111-4111-8111-111111111111"),
    );
    assert.equal(manual.aiGenerationReceipt, null);
  });

  it("publishes only sanitized receipt evidence", async () => {
    const repository = new MemoryRepository();
    await reservePaidGeneration(repository);
    const campaign = await createCampaign(repository, actor, {
      ...campaignInput("81111111-1111-4111-8111-111111111111"),
      aiReceiptHandle: receiptHandle(),
    });
    const events = await repository.listEvents("CAMPAIGN", campaign.id);
    const serialized = JSON.stringify({
      campaign,
      publicCampaign: publicCampaignView(campaign),
      events,
    });

    for (const secret of [
      privateAnswer,
      privateAuthorization,
      privatePrompt,
      payerIdentity,
      '"authorizationDigest"',
      '"requestHash"',
      '"entries"',
      '"answer"',
    ]) {
      assert.equal(serialized.includes(secret), false);
    }
    for (const publicReceiptPart of [
      paymentIdentifier,
      settlementReference,
      paymentNetwork,
      campaign.aiGenerationReceipt!.receiptDigest,
    ]) {
      assert.equal(serialized.includes(publicReceiptPart), true);
    }
  });

  it("rejects durable settlement evidence that disagrees with the payment record", async () => {
    const repository = new MemoryRepository();
    await reservePaidGeneration(repository, {
      settlement: "different-settlement-reference",
    });
    await assert.rejects(
      createCampaign(repository, actor, {
        ...campaignInput("91111111-1111-4111-8111-111111111111"),
        aiReceiptHandle: receiptHandle(),
      }),
      /does not match its durable record/,
    );
  });
});
