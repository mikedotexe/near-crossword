import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  OneClickFundingAdapter,
} from "./funding/one-click";
import { DirectNearFundingAdapter } from "./funding/direct-near";
import type { Campaign, FundingOrder, FundingQuote } from "./types";

const campaign: Campaign = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "test-campaign",
  creatorId: "creator",
  creatorAccountId: "creator.near",
  title: "Test",
  description: null,
  sponsorName: null,
  sponsorUrl: null,
  visibility: "PUBLIC",
  status: "DRAFT",
  puzzle: { width: 3, height: 3, clues: [] },
  contentHash: "a".repeat(64),
  solutionPublicKey: Buffer.alloc(32, 1).toString("base64"),
  reward: {
    type: "TOKEN_PRIZE",
    assetId: "nep141:usdc.example",
    amountAtomic: "1000000",
    decimals: 6,
    symbol: "USDC",
  },
  contractId: "campaigns.near",
  openingAt: null,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  refundAccount: "creator.near",
  fundingReference: null,
  chainCampaignId: null,
  aiGenerationReceipt: null,
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  process.env.V2_USDC_ASSET_ID = "nep141:usdc.example";
  process.env.V2_USDC_CONTRACT_ID = "usdc.example";
  process.env.V2_CONTRACT_ID = "campaigns.near";
  process.env.ONE_CLICK_JWT = "configured-test-jwt";
});

function signedQuote(
  quoteRequest: Record<string, unknown>,
  quoteOverrides: Record<string, unknown> = {},
) {
  return {
    correlationId: "quote-1",
    timestamp: "2026-07-24T20:00:00.000Z",
    signature: "test-signature",
    quoteRequest,
    quote: {
      depositAddress: "0xdeposit",
      depositMemo: "memo-7",
      amountIn: "2200000",
      amountOut: "1000000",
      deadline: quoteRequest.deadline,
      ...quoteOverrides,
    },
    unrelatedPrivateField: "must-not-be-persisted",
  };
}

function scenario(
  status: string,
  swapDetails: Record<string, unknown>,
  quoteOverrides: Record<string, unknown> = {},
  mutateStatusQuote?: (quote: ReturnType<typeof signedQuote>) => void,
) {
  let responseQuote: ReturnType<typeof signedQuote> | null = null;
  let quoteRequest: Record<string, unknown> | null = null;
  let statusUrl = "";
  let statusAuthorization = "";
  const fetcher = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (init?.method === "POST") {
      quoteRequest = JSON.parse(String(init.body));
      responseQuote = signedQuote(quoteRequest!, quoteOverrides);
      return new Response(JSON.stringify(responseQuote), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    assert.ok(responseQuote);
    statusUrl = String(input);
    statusAuthorization =
      new Headers(init?.headers).get("authorization") ?? "";
    const echoedQuote = structuredClone(responseQuote);
    mutateStatusQuote?.(echoedQuote);
    return new Response(
      JSON.stringify({
        correlationId: "status-1",
        quoteResponse: echoedQuote,
        status,
        updatedAt: "2026-07-24T20:01:00.000Z",
        swapDetails,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return {
    fetcher: fetcher as typeof fetch,
    quoteRequest: () => quoteRequest,
    statusUrl: () => statusUrl,
    statusAuthorization: () => statusAuthorization,
  };
}

function fundingOrder(quote: FundingQuote): FundingOrder {
  return {
    id: "order",
    campaignId: campaign.id,
    creatorId: "creator",
    rail: "ONE_CLICK",
    status: "PROCESSING",
    idempotencyKey: "funding_request_0001",
    originAssetId: quote.origin.assetId,
    destinationAssetId: quote.principal.assetId,
    principalAmountAtomic: quote.principal.amountAtomic,
    inputAmountAtomic: quote.origin.amountAtomic,
    routingFeeAtomic: quote.routingFee.amountAtomic,
    platformFeeAtomic: quote.platformFee.amountAtomic,
    refundTo: "creator.near",
    quote,
    providerReference: quote.providerQuoteId,
    depositAddress: quote.depositAddress,
    depositTxHash: null,
    settlementTxHash: null,
    fundingReference: null,
    evidence: {},
    expiresAt: quote.deadline,
    version: 1,
    createdAt: "2026-07-24T20:00:00.000Z",
    updatedAt: "2026-07-24T20:00:00.000Z",
  };
}

async function createFundingScenarioQuote(
  adapter: OneClickFundingAdapter,
  deadline = "2026-07-24T20:05:00.000Z",
): Promise<FundingQuote> {
  return adapter.quote({
    kind: "FUND_CAMPAIGN",
    campaign,
    originAssetId: "nep141:wrap.near",
    refundTo: "creator.near",
    fundingReference: "campaign:test:funding",
    deadline,
  });
}

describe("1Click adapter", () => {
  it("verifies an exact-output signed quote and stores only sanitized quote data", async () => {
    const provider = scenario("PENDING_DEPOSIT", {
      originChainTxHashes: [],
      destinationChainTxHashes: [],
    });
    const adapter = new OneClickFundingAdapter(
      provider.fetcher,
      "https://example.test/v0",
      () => true,
    );
    const quote = await createFundingScenarioQuote(adapter);
    const sent = provider.quoteRequest();
    assert.ok(sent);
    assert.equal(sent.swapType, "EXACT_OUTPUT");
    assert.equal(sent.amount, "1000000");
    assert.equal(quote.origin.amountAtomic, "2200000");
    assert.equal(quote.principal.amountAtomic, "1000000");
    assert.equal(quote.estimatedDelivery?.amountAtomic, "1000000");
    assert.equal(JSON.stringify(quote.instructions).includes("unrelatedPrivateField"), false);
  });

  it("fails closed when the official signature verifier rejects a quote", async () => {
    const provider = scenario("PENDING_DEPOSIT", {
      originChainTxHashes: [],
      destinationChainTxHashes: [],
    });
    const adapter = new OneClickFundingAdapter(
      provider.fetcher,
      "https://example.test/v0",
      () => false,
    );
    await assert.rejects(
      createFundingScenarioQuote(adapter),
      /signature verification failed/,
    );
  });

  it("rejects an exact-output quote that does not deliver the full principal", async () => {
    const provider = scenario(
      "PENDING_DEPOSIT",
      { originChainTxHashes: [], destinationChainTxHashes: [] },
      { amountOut: "999999" },
    );
    const adapter = new OneClickFundingAdapter(
      provider.fetcher,
      "https://example.test/v0",
      () => true,
    );
    await assert.rejects(
      createFundingScenarioQuote(adapter),
      /does not deliver the complete escrow principal/,
    );
  });

  it("rejects an exact-input payout quote that does not spend the full principal", async () => {
    const provider = scenario(
      "PENDING_DEPOSIT",
      { originChainTxHashes: [], destinationChainTxHashes: [] },
      { amountIn: "999999", amountOut: "500000" },
    );
    const adapter = new OneClickFundingAdapter(
      provider.fetcher,
      "https://example.test/v0",
      () => true,
    );
    await assert.rejects(
      adapter.quote({
        kind: "PAYOUT_WINNER",
        campaign,
        payout: {
          kind: "ONE_CLICK",
          destinationAsset: "nep141:base-usdc.example",
          recipient: "0xwinner",
          recoveryAccount: "winner.near",
        },
        deadline: "2026-07-24T20:05:00.000Z",
      }),
      /does not spend the complete escrow principal/,
    );
  });

  it("requires exact settled output, nested signed quote binding, receipts, memo, and auth", async () => {
    const provider = scenario("SUCCESS", {
      amountOut: "1000000",
      originChainTxHashes: [
        { hash: "deposit-hash", explorerUrl: "https://origin.test/tx" },
      ],
      destinationChainTxHashes: [
        { hash: "settlement-hash", explorerUrl: "https://destination.test/tx" },
      ],
    });
    const adapter = new OneClickFundingAdapter(
      provider.fetcher,
      "https://example.test/v0",
      () => true,
    );
    const quote = await createFundingScenarioQuote(adapter);
    const observation = await adapter.observe(fundingOrder(quote));
    assert.equal(observation.orderStatus, "SETTLED");
    assert.equal(observation.depositTxHash, "deposit-hash");
    assert.equal(observation.settlementTxHash, "settlement-hash");
    assert.match(provider.statusUrl(), /depositMemo=memo-7/);
    assert.equal(
      provider.statusAuthorization(),
      "Bearer configured-test-jwt",
    );
  });

  it("keeps an incomplete provider deposit nonterminal and non-allocatable", async () => {
    const provider = scenario("INCOMPLETE_DEPOSIT", {
      depositedAmount: "500000",
      originChainTxHashes: [{ hash: "partial-deposit-hash" }],
      destinationChainTxHashes: [],
    });
    const adapter = new OneClickFundingAdapter(
      provider.fetcher,
      "https://example.test/v0",
      () => true,
    );
    const quote = await createFundingScenarioQuote(adapter);
    const decision = await adapter.finalize(fundingOrder(quote));
    assert.equal(decision.observation.orderStatus, "INCOMPLETE");
    assert.equal(decision.observation.depositTxHash, "partial-deposit-hash");
    assert.equal(decision.observation.fundingReference, null);
    assert.equal(decision.readyForAllocation, false);
    assert.equal(decision.terminal, false);
  });

  it("rejects provider SUCCESS with a mismatched output amount", async () => {
    const provider = scenario("SUCCESS", {
      amountOut: "500000",
      originChainTxHashes: [{ hash: "deposit-hash" }],
      destinationChainTxHashes: [{ hash: "settlement-hash" }],
    });
    const adapter = new OneClickFundingAdapter(
      provider.fetcher,
      "https://example.test/v0",
      () => true,
    );
    const quote = await createFundingScenarioQuote(adapter);
    await assert.rejects(
      adapter.observe(fundingOrder(quote)),
      /did not deliver the complete escrow principal/,
    );
  });

  it("rejects provider SUCCESS without a destination receipt", async () => {
    const provider = scenario("SUCCESS", {
      amountOut: "1000000",
      originChainTxHashes: [{ hash: "deposit-hash" }],
      destinationChainTxHashes: [],
    });
    const adapter = new OneClickFundingAdapter(
      provider.fetcher,
      "https://example.test/v0",
      () => true,
    );
    const quote = await createFundingScenarioQuote(adapter);
    await assert.rejects(
      adapter.observe(fundingOrder(quote)),
      /no destination-chain receipt/,
    );
  });

  it("rejects status whose nested quote no longer matches the stored signed quote", async () => {
    const provider = scenario(
      "SUCCESS",
      {
        amountOut: "1000000",
        originChainTxHashes: [{ hash: "deposit-hash" }],
        destinationChainTxHashes: [{ hash: "settlement-hash" }],
      },
      {},
      (quote) => {
        quote.correlationId = "tampered-correlation";
      },
    );
    const adapter = new OneClickFundingAdapter(
      provider.fetcher,
      "https://example.test/v0",
      () => true,
    );
    const quote = await createFundingScenarioQuote(adapter);
    await assert.rejects(
      adapter.observe(fundingOrder(quote)),
      /does not match the stored signed quote/,
    );
  });

  it("exposes a distinct origin-chain refund receipt for winner recovery", async () => {
    const provider = scenario("REFUNDED", {
      refundedAmount: "1000000",
      refundReason: "PARTIAL_DEPOSIT",
      originChainTxHashes: [
        { hash: "escrow-deposit-hash" },
        { hash: "recovery-refund-hash" },
      ],
      destinationChainTxHashes: [],
    });
    const adapter = new OneClickFundingAdapter(
      provider.fetcher,
      "https://example.test/v0",
      () => true,
    );
    const quote = await createFundingScenarioQuote(adapter);
    const observation = await adapter.observe(fundingOrder(quote));
    assert.equal(observation.orderStatus, "REFUNDED");
    assert.equal(observation.depositTxHash, "escrow-deposit-hash");
    assert.equal(observation.settlementTxHash, "recovery-refund-hash");
    assert.equal(observation.evidence.depositAddress, "0xdeposit");
  });
});

describe("direct NEAR adapter", () => {
  it("emits the contract-v2 tagged ft_on_transfer message", async () => {
    const deadline = new Date(Date.now() + 60_000).toISOString();
    const quote = await new DirectNearFundingAdapter().quote({
      kind: "FUND_CAMPAIGN",
      campaign,
      originAssetId: "nep141:usdc.example",
      refundTo: "creator.near",
      fundingReference: "campaign:test:direct",
      deadline,
    });
    const message = JSON.parse(quote.depositMemo!);
    assert.equal(message.action, "create_campaign");
    assert.equal(message.funding_reference, "campaign:test:direct");
    assert.equal(message.funding_deadline_ms, new Date(deadline).getTime());
    assert.equal(message.campaign.creator_id, "creator.near");
    assert.equal(message.campaign.refund_account_id, "creator.near");
    assert.equal(
      (quote.instructions as Record<string, unknown>).signerId,
      "creator.near",
    );
    assert.equal(
      message.campaign.content_hash,
      Buffer.from("a".repeat(64), "hex").toString("base64"),
    );
    assert.equal(message.campaign.solution_public_key, campaign.solutionPublicKey);
  });
});
