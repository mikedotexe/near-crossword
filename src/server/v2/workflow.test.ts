import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import { MemoryRepository, resetMemoryRepositoryForTests } from "./memory-repository";
import {
  createCampaign,
  createClaimQuote,
  createFundingQuote,
  refreshFundingOrder,
  submitClaim,
} from "./services";
import type { Actor } from "./types";
import { buildClaimMessage } from "./claim-proof";
import type { FundingAdapter } from "./funding";
import { DeterministicMockFundingAdapter } from "./funding/mock";

const actor: Actor = { id: "demo:creator", email: null, demo: true };
const campaignId = "11111111-1111-4111-8111-111111111111";
const solutionPublicKey = Buffer.alloc(32, 7).toString("base64");

function campaignInput() {
  return {
    id: campaignId,
    title: "Intentional crossword",
    description: "A complete, public-puzzle-only campaign",
    sponsorName: "Test sponsor",
    creatorAccountId: "creator.testnet",
    refundAccount: "creator.testnet",
    visibility: "public",
    durationHours: 168,
    solutionPublicKey,
    puzzle: {
      rows: 8,
      columns: 8,
      entries: [
        { number: 1, row: 0, column: 0, length: 4, direction: "across", clue: "One" },
        { number: 2, row: 0, column: 0, length: 4, direction: "down", clue: "Two" },
        { number: 3, row: 4, column: 1, length: 5, direction: "across", clue: "Three" },
      ],
    },
    reward: {
      type: "TOKEN_PRIZE",
      assetId: "nep141:mock-usdc.testnet",
      amountAtomic: "25000000",
      decimals: 6,
      symbol: "USDC",
    },
  };
}

beforeEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  process.env.V2_FUNDING_MODE = "mock";
  delete process.env.V2_USDC_ASSET_ID;
  delete process.env.V2_USDC_CONTRACT_ID;
  delete process.env.V2_CONTRACT_ID;
  resetMemoryRepositoryForTests();
});

describe("v2 workflow ledger", () => {
  it("creates a sanitized draft with a client-selected campaign id", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, actor, campaignInput());
    assert.equal(campaign.id, campaignId);
    assert.equal(campaign.status, "DRAFT");
    assert.equal(campaign.puzzle.width, 8);
    assert.equal(campaign.puzzle.clues.length, 3);
    assert.equal("answer" in campaign.puzzle.clues[0], false);
    assert.match(campaign.contentHash!, /^[0-9a-f]{64}$/);
  });

  it("accepts an exact one-hour campaign window", async () => {
    const repository = new MemoryRepository();
    const body = campaignInput();
    body.durationHours = 1;
    const campaign = await createCampaign(repository, actor, body);
    assert.equal(
      new Date(campaign.expiresAt!).getTime() -
        new Date(campaign.openingAt!).getTime(),
      60 * 60 * 1000,
    );
  });

  it("rejects answer material in public puzzle data", async () => {
    const repository = new MemoryRepository();
    const body = campaignInput();
    (body.puzzle.entries[0] as Record<string, unknown>).answer = "LEAK";
    await assert.rejects(
      createCampaign(repository, actor, body),
      (error: unknown) =>
        error instanceof Error && error.message.includes("cannot contain answer"),
    );
  });

  it("rejects a creator-supplied hash that does not match canonical content", async () => {
    const repository = new MemoryRepository();
    await assert.rejects(
      createCampaign(repository, actor, {
        ...campaignInput(),
        contentHash: "a".repeat(64),
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes("does not match the canonical campaign content"),
    );
  });

  it("separates prize principal and fees in an idempotent funding order", async () => {
    const repository = new MemoryRepository();
    await createCampaign(repository, actor, campaignInput());
    const delegate = new DeterministicMockFundingAdapter();
    let quoteCalls = 0;
    const adapter: FundingAdapter = {
      rail: "MOCK",
      quote: async (input) => {
        quoteCalls += 1;
        return delegate.quote(input);
      },
      observe: () => delegate.observe(),
      finalize: () => delegate.finalize(),
      reconcile: () => delegate.reconcile(),
    };
    const request = {
      rail: "intents",
      originAssetId: "nep141:wrap.testnet",
      refundTo: "creator.testnet",
      idempotencyKey: "funding_request_0001",
    };
    const options = { adapterForRail: () => adapter };
    const first = await createFundingQuote(
      repository,
      actor,
      campaignId,
      request,
      options,
    );
    const second = await createFundingQuote(
      repository,
      actor,
      campaignId,
      request,
      options,
    );
    assert.equal(first.id, second.id);
    assert.equal(quoteCalls, 1);
    assert.equal(first.principalAmountAtomic, "25000000");
    assert.equal(first.routingFeeAtomic, "0");
    assert.equal(first.platformFeeAtomic, "0");
    assert.equal((await repository.getCampaign(campaignId))?.status, "FUNDING");
  });

  it("binds a live external quote to the creator wallet before deposit", async () => {
    const repository = new MemoryRepository();
    await createCampaign(repository, actor, campaignInput());
    const delegate = new DeterministicMockFundingAdapter();
    const order = await createFundingQuote(
      repository,
      actor,
      campaignId,
      {
        rail: "intents",
        originAssetId: "nep141:wrap.testnet",
        refundTo: "creator.testnet",
        idempotencyKey: "funding_creator_authorization",
      },
      {
        adapterForRail: () => ({
          rail: "ONE_CLICK",
          quote: async (request) => ({
            ...(await delegate.quote(request)),
            rail: "ONE_CLICK",
            providerQuoteId: "one-click-correlation-1",
            instructions: { provider: "1click" },
          }),
          observe: () => delegate.observe(),
          finalize: () => delegate.finalize(),
          reconcile: () => delegate.reconcile(),
        }),
      },
    );
    const instructions = order.quote.instructions as Record<string, unknown>;
    const authorization = instructions.creatorAuthorization as Record<
      string,
      unknown
    >;
    assert.equal(authorization.authorizedCreatorAccountId, "creator.testnet");
    assert.equal(authorization.fundingReference, "one-click-correlation-1");
    assert.equal(instructions.provider, "1click");
  });

  it("refuses a funding quote without time for finality and allocation", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, actor, {
      ...campaignInput(),
      durationHours: 1,
    });
    const nowNearExpiry =
      new Date(campaign.expiresAt!).getTime() - 10 * 60 * 1000;
    await assert.rejects(
      createFundingQuote(
        repository,
        actor,
        campaign.id,
        {
          rail: "intents",
          originAssetId: "nep141:wrap.testnet",
          refundTo: "creator.testnet",
          idempotencyKey: "funding_too_close_to_expiry",
        },
        { now: () => nowNearExpiry },
      ),
      /too close to expiry/,
    );
  });

  it("requires one creator-controlled NEAR account before external quoting", async () => {
    const repository = new MemoryRepository();
    await createCampaign(repository, actor, {
      ...campaignInput(),
      refundAccount: "different-recovery.testnet",
    });
    let quoteCalls = 0;
    const delegate = new DeterministicMockFundingAdapter();
    await assert.rejects(
      createFundingQuote(
        repository,
        actor,
        campaignId,
        {
          rail: "intents",
          originAssetId: "nep141:wrap.testnet",
          refundTo: "creator.testnet",
          idempotencyKey: "funding_mismatched_authorizer",
        },
        {
          adapterForRail: () => ({
            rail: "MOCK",
            quote: async (request) => {
              quoteCalls += 1;
              return delegate.quote(request);
            },
            observe: () => delegate.observe(),
            finalize: () => delegate.finalize(),
            reconcile: () => delegate.reconcile(),
          }),
        },
      ),
      /creator and NEAR recovery account to be the same/,
    );
    assert.equal(quoteCalls, 0);
  });

  it("rejects mismatched funding key reuse before creating another provider quote", async () => {
    const repository = new MemoryRepository();
    await createCampaign(repository, actor, campaignInput());
    const delegate = new DeterministicMockFundingAdapter();
    let quoteCalls = 0;
    const adapter: FundingAdapter = {
      rail: "MOCK",
      quote: async (input) => {
        quoteCalls += 1;
        return delegate.quote(input);
      },
      observe: () => delegate.observe(),
      finalize: () => delegate.finalize(),
      reconcile: () => delegate.reconcile(),
    };
    const options = { adapterForRail: () => adapter };
    const request = {
      rail: "intents",
      originAssetId: "nep141:wrap.testnet",
      refundTo: "creator.testnet",
      idempotencyKey: "funding_request_mismatch",
    };
    await createFundingQuote(repository, actor, campaignId, request, options);
    await assert.rejects(
      createFundingQuote(
        repository,
        actor,
        campaignId,
        { ...request, refundTo: "other.testnet" },
        options,
      ),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes("different funding request"),
    );
    assert.equal(quoteCalls, 1);
  });

  it("recovers a durable funding quote after an event-write crash without requoting", async () => {
    const repository = new MemoryRepository();
    await createCampaign(repository, actor, campaignInput());
    const delegate = new DeterministicMockFundingAdapter();
    let quoteCalls = 0;
    const adapter: FundingAdapter = {
      rail: "MOCK",
      quote: async (input) => {
        quoteCalls += 1;
        return delegate.quote(input);
      },
      observe: () => delegate.observe(),
      finalize: () => delegate.finalize(),
      reconcile: () => delegate.reconcile(),
    };
    const originalAppendEvent = repository.appendEvent.bind(repository);
    let failOnce = true;
    repository.appendEvent = async (input) => {
      if (failOnce && input.aggregateType === "FUNDING_ORDER") {
        failOnce = false;
        throw new Error("simulated event store interruption");
      }
      return originalAppendEvent(input);
    };
    const request = {
      rail: "intents",
      originAssetId: "nep141:wrap.testnet",
      refundTo: "creator.testnet",
      idempotencyKey: "funding_request_crash",
    };
    const options = { adapterForRail: () => adapter };
    await assert.rejects(
      createFundingQuote(repository, actor, campaignId, request, options),
      /simulated event store interruption/,
    );
    const recovered = await createFundingQuote(
      repository,
      actor,
      campaignId,
      request,
      options,
    );
    assert.equal(quoteCalls, 1);
    assert.equal(recovered.status, "AWAITING_DEPOSIT");
    assert.equal((await repository.getCampaign(campaignId))?.status, "FUNDING");
    assert.equal(
      (await repository.listEvents("FUNDING_ORDER", recovered.id)).length,
      1,
    );
  });

  it("repairs a settled funding transition whose allocation job was not enqueued", async () => {
    const repository = new MemoryRepository();
    await createCampaign(repository, actor, campaignInput());
    const quoted = await createFundingQuote(repository, actor, campaignId, {
      rail: "intents",
      originAssetId: "nep141:wrap.testnet",
      refundTo: "creator.testnet",
      idempotencyKey: "funding_settled_job_repair",
    });
    const settled = await repository.transitionFundingOrder(
      quoted.id,
      ["AWAITING_DEPOSIT"],
      "SETTLED",
      quoted.version,
      { fundingReference: "settled:reference" },
    );
    assert.ok(settled);
    const initialAllocation = await repository.enqueueJob({
      type: "ALLOCATE_EXTERNAL_FUNDING",
      aggregateType: "FUNDING_ORDER",
      aggregateId: quoted.id,
      deduplicationKey: `allocate:${quoted.id}`,
      payload: {
        fundingOrderId: quoted.id,
        campaignId,
        expectedAmountAtomic: quoted.principalAmountAtomic,
      },
      maxAttempts: 1,
      runAfter: new Date(0).toISOString(),
    });
    const initiallyLeased = await repository.leaseJobs(
      "failed-allocation-worker",
      20,
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.ok(
      initiallyLeased.some((job) => job.id === initialAllocation.job.id),
    );
    const dead = await repository.failJob(
      initialAllocation.job.id,
      "failed-allocation-worker",
      "simulated terminal allocation failure",
      new Date().toISOString(),
    );
    assert.equal(dead?.status, "DEAD");
    const refreshed = await refreshFundingOrder(repository, actor, quoted.id);
    assert.equal(refreshed.status, "SETTLED");
    const jobs = await repository.leaseJobs(
      "repair-worker",
      20,
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.ok(
      jobs.some(
        (job) =>
          job.type === "ALLOCATE_EXTERNAL_FUNDING" &&
          job.aggregateId === quoted.id,
      ),
    );
  });

  it("reserves a full claim intent and never requotes mismatched key reuse", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, actor, campaignInput());
    const active = await repository.transitionCampaign(
      campaign.id,
      ["DRAFT"],
      "ACTIVE",
      campaign.version,
    );
    assert.ok(active);
    const delegate = new DeterministicMockFundingAdapter();
    let quoteCalls = 0;
    const adapter: FundingAdapter = {
      rail: "MOCK",
      quote: async (input) => {
        quoteCalls += 1;
        return delegate.quote(input);
      },
      observe: () => delegate.observe(),
      finalize: () => delegate.finalize(),
      reconcile: () => delegate.reconcile(),
    };
    const options = {
      adapterForRail: () => adapter,
      getClaimNonce: async () => "0",
    };
    const request = {
      payout: {
        kind: "one_click",
        destinationAsset: "nep141:mock-usdc.testnet",
        recipient: "winner.testnet",
        recoveryAccount: "winner.testnet",
      },
      idempotencyKey: "claim_quote_one_click",
    };
    const first = await createClaimQuote(
      repository,
      "solver:quote",
      campaign.id,
      request,
      options,
    );
    const replay = await createClaimQuote(
      repository,
      "solver:quote",
      campaign.id,
      request,
      options,
    );
    assert.equal(replay.claim.id, first.claim.id);
    await assert.rejects(
      createClaimQuote(
        repository,
        "solver:quote",
        campaign.id,
        {
          ...request,
          payout: { ...request.payout, recipient: "someone-else.testnet" },
        },
        options,
      ),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes("different claim quote"),
    );
    assert.equal(quoteCalls, 1);
  });

  it("binds a 1Click claim permit to the earlier provider deadline and estimated output", async () => {
    const repository = new MemoryRepository();
    const campaign = await createCampaign(repository, actor, campaignInput());
    const active = await repository.transitionCampaign(
      campaign.id,
      ["DRAFT"],
      "ACTIVE",
      campaign.version,
    );
    assert.ok(active);
    const nowMs = Date.now();
    const providerDeadline = new Date(nowMs + 45_000).toISOString();
    const delegate = new DeterministicMockFundingAdapter();
    const adapter: FundingAdapter = {
      rail: "MOCK",
      quote: async (input) => {
        const quoted = await delegate.quote(input);
        return {
          ...quoted,
          deadline: providerDeadline,
          estimatedDelivery: {
            assetId: "nep141:mock-usdc.testnet",
            amountAtomic: "24750000",
          },
        };
      },
      observe: () => delegate.observe(),
      finalize: () => delegate.finalize(),
      reconcile: () => delegate.reconcile(),
    };

    const view = await createClaimQuote(
      repository,
      "solver:deadline",
      campaign.id,
      {
        payout: {
          kind: "one_click",
          destinationAsset: "nep141:mock-usdc.testnet",
          recipient: "winner.testnet",
          recoveryAccount: "winner.testnet",
        },
        idempotencyKey: "claim_quote_provider_deadline",
      },
      {
        adapterForRail: () => adapter,
        getClaimNonce: async () => "0",
        now: () => nowMs,
      },
    );

    assert.equal(view.deadlineMs, String(new Date(providerDeadline).getTime()));
    assert.equal(view.claim.expiresAt, providerDeadline);
    assert.equal(
      (view.claim.evidence as Record<string, unknown>).deadlineMs,
      view.deadlineMs,
    );
    assert.equal(view.escrowPrincipalAmount, "25000000");
    assert.equal(view.estimatedDeliveryAmount, "24750000");
    assert.equal(
      view.estimatedDeliveryAsset,
      "nep141:mock-usdc.testnet",
    );
  });

  it("allows parallel quotes but only one atomic claim submission", async () => {
    const repository = new MemoryRepository();
    const keys = generateKeyPairSync("ed25519");
    const rawPublicKey = (
      keys.publicKey.export({ format: "der", type: "spki" }) as Buffer
    ).subarray(-32);
    const input = campaignInput();
    input.solutionPublicKey = rawPublicKey.toString("base64");
    const campaign = await createCampaign(repository, actor, input);
    const active = await repository.transitionCampaign(
      campaign.id,
      ["DRAFT"],
      "ACTIVE",
      campaign.version,
    );
    assert.ok(active);
    const first = await createClaimQuote(repository, "solver:a", campaign.id, {
      payout: {
        kind: "direct_near",
        destinationAsset: "ignored-by-direct",
        recipient: "winner.testnet",
        recoveryAccount: "winner.testnet",
      },
      idempotencyKey: "claim_quote_solver_a",
    }, { getClaimNonce: async () => "0" });
    const second = await createClaimQuote(repository, "solver:b", campaign.id, {
      payout: {
        kind: "direct_near",
        destinationAsset: "ignored-by-direct",
        recipient: "second.testnet",
        recoveryAccount: "second.testnet",
      },
      idempotencyKey: "claim_quote_solver_b",
    }, { getClaimNonce: async () => "0" });
    const proofBody = {
      payoutDigest: first.payoutDigest,
      nonce: first.nonce,
      deadlineMs: first.deadlineMs,
    };
    const proof = {
      ...proofBody,
      signature: sign(
        null,
        buildClaimMessage({
          contractId: campaign.contractId!,
          campaignId: campaign.id,
          receiverId: first.receiverId,
          ...proofBody,
        }),
        keys.privateKey,
      ).toString("base64"),
    };
    const originalEnqueueJob = repository.enqueueJob.bind(repository);
    let failClaimEnqueue = true;
    repository.enqueueJob = async (input) => {
      if (failClaimEnqueue && input.type === "SUBMIT_CONTRACT_CLAIM") {
        failClaimEnqueue = false;
        throw new Error("simulated claim job interruption");
      }
      return originalEnqueueJob(input);
    };
    await assert.rejects(
      submitClaim(repository, campaign.id, {
        claimId: first.claim.id,
        proof,
      }),
      /simulated claim job interruption/,
    );
    repository.enqueueJob = originalEnqueueJob;
    const submitted = await submitClaim(repository, campaign.id, {
      claimId: first.claim.id,
      proof,
    });
    assert.equal(submitted.status, "SUBMITTED");
    const replayedSubmission = await submitClaim(repository, campaign.id, {
      claimId: first.claim.id,
      proof,
    });
    assert.equal(replayedSubmission.id, submitted.id);
    const secondProofBody = {
      payoutDigest: second.payoutDigest,
      nonce: second.nonce,
      deadlineMs: second.deadlineMs,
    };
    const secondProof = {
      ...secondProofBody,
      signature: sign(
        null,
        buildClaimMessage({
          contractId: campaign.contractId!,
          campaignId: campaign.id,
          receiverId: second.receiverId,
          ...secondProofBody,
        }),
        keys.privateKey,
      ).toString("base64"),
    };
    await assert.rejects(
      submitClaim(repository, campaign.id, {
        claimId: second.claim.id,
        proof: secondProof,
      }),
      (error: unknown) =>
        error instanceof Error && error.message.includes("another solver"),
    );
  });

  it("deduplicates jobs and leases each job once", async () => {
    const repository = new MemoryRepository();
    const input = {
      type: "RECONCILE",
      aggregateType: "FUNDING_ORDER",
      aggregateId: "order-1",
      deduplicationKey: "reconcile:order-1",
      payload: {},
      maxAttempts: 3,
      runAfter: new Date(0).toISOString(),
    };
    const first = await repository.enqueueJob(input);
    const second = await repository.enqueueJob(input);
    assert.equal(first.job.id, second.job.id);
    const jobs = await repository.leaseJobs(
      "worker-a",
      5,
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].attempts, 1);
  });

  it("revives a DEAD job only for an explicit recovery enqueue", async () => {
    const repository = new MemoryRepository();
    const input = {
      type: "RECONCILE",
      aggregateType: "FUNDING_ORDER",
      aggregateId: "order-dead",
      deduplicationKey: "reconcile:order-dead",
      payload: { attempt: "original" },
      maxAttempts: 1,
      runAfter: new Date(0).toISOString(),
    };
    const created = await repository.enqueueJob(input);
    const [leased] = await repository.leaseJobs(
      "worker-dead",
      1,
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.ok(leased);
    const dead = await repository.failJob(
      created.job.id,
      "worker-dead",
      "terminal failure",
      new Date().toISOString(),
    );
    assert.equal(dead?.status, "DEAD");
    const ordinaryReplay = await repository.enqueueJob(input);
    assert.equal(ordinaryReplay.job.status, "DEAD");
    const recovered = await repository.enqueueJob({
      ...input,
      payload: { attempt: "operator-recovery" },
      reactivateDead: true,
    });
    assert.equal(recovered.created, false);
    assert.equal(recovered.job.status, "PENDING");
    assert.equal(recovered.job.attempts, 0);
    assert.deepEqual(recovered.job.payload, { attempt: "operator-recovery" });
  });

  it("durably rejects an idempotency key reused with another request hash", async () => {
    const repository = new MemoryRepository();
    const first = await repository.reserveIdempotency(
      "AI",
      "payer",
      "payment_identifier_1",
      "a".repeat(64),
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.equal(first.created, true);
    const replay = await repository.reserveIdempotency(
      "AI",
      "payer",
      "payment_identifier_1",
      "b".repeat(64),
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.equal(replay.created, false);
    assert.equal(replay.record.requestHash, "a".repeat(64));
  });
});
