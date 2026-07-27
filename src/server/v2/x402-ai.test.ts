import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import {
  decodePaymentSignatureHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { declarePaymentIdentifierExtension } from "@x402/extensions/payment-identifier";
import type { PaymentPayload } from "@x402/core/types";
import type { IdempotencyRecord } from "./types";
import {
  paidAiGeneration,
  replayResponse,
  x402PaymentIdentity,
} from "./x402-ai";
import {
  MemoryRepository,
  resetMemoryRepositoryForTests,
} from "./memory-repository";
import type { AiGenerator } from "./ai";
import { AppError } from "./errors";
import { digestJson } from "./validation";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function paymentHeader(identifier: string, signedDelegateAction: string): string {
  return encodePaymentSignatureHeader({
    x402Version: 2,
    resource: { url: "https://crossword.xyz/api/v2/ai/generate" },
    accepted: {
      scheme: "exact",
      network: "near:mainnet",
      amount: "100000",
      asset: "usdc.near",
      payTo: "crossword.near",
      maxTimeoutSeconds: 300,
      extra: {},
    },
    payload: { signedDelegateAction },
    extensions: {
      "payment-identifier": {
        ...declarePaymentIdentifierExtension(true),
        info: { required: true, id: identifier },
      },
    },
  } as PaymentPayload);
}

function completedRecord(requestHash: string): IdempotencyRecord {
  const timestamp = new Date().toISOString();
  return {
    scope: "AI_GENERATE_X402_V2",
    actorId: "x402:ai-generate",
    key: "payment_identifier_123",
    requestHash,
    state: "COMPLETED",
    responseStatus: 200,
    responseBody: { entries: [] },
    paymentReference: "transaction",
    authorizationDigest: "d".repeat(64),
    processingStage: null,
    processingOwner: null,
    processingLeaseExpiresAt: null,
    processingVersion: 4,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function headerDigest(header: string): string {
  return createHash("sha256").update(header, "utf8").digest("hex");
}

beforeEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  delete process.env.V2_FUNDING_MODE;
  process.env.X402_ENABLED = "true";
  process.env.ANTHROPIC_API_KEY = "test-only-not-used";
  resetMemoryRepositoryForTests();
});

function fakeServer(header: string, calls: { verify: number; settle: number }) {
  const requirements = {
    scheme: "exact",
    network: "near:mainnet",
    amount: "100000",
    asset: "usdc.near",
    payTo: "crossword.near",
    maxTimeoutSeconds: 300,
    extra: {},
  };
  return {
    http: {
      processHTTPRequest: async () => {
        calls.verify += 1;
        return {
          type: "payment-verified" as const,
          cancellationDispatcher: {
            cancel: async () => undefined,
          },
          paymentPayload: decodePaymentSignatureHeader(header),
          paymentRequirements: requirements,
          declaredExtensions: {
            "payment-identifier": { required: true },
          },
        };
      },
      processSettlement: async () => {
        calls.settle += 1;
        return {
          success: true as const,
          transaction: "near-settlement-transaction",
          network: "near:mainnet",
          payer: "payer.near",
          headers: { "PAYMENT-RESPONSE": "sanitized-receipt" },
          requirements,
        };
      },
    },
  };
}

function request(header: string): Request {
  return new Request("https://crossword.xyz/api/v2/ai/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "payment-signature": header,
    },
  });
}

describe("x402 AI idempotency", () => {
  it("scopes re-signed retries to the same durable payment identifier", () => {
    const id = "payment_identifier_123";
    const first = x402PaymentIdentity(paymentHeader(id, "first-signature"));
    const resigned = x402PaymentIdentity(paymentHeader(id, "second-signature"));
    assert.equal(first.paymentIdentifier, id);
    assert.equal(first.actorId, resigned.actorId);
  });

  it("returns the cached result for an identical completed request", () => {
    const replay = replayResponse(
      completedRecord("a".repeat(64)),
      "a".repeat(64),
      "d".repeat(64),
    );
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, { entries: [], cached: true });
  });

  it("rejects the same payment identifier with a different body", () => {
    assert.throws(
      () =>
        replayResponse(
          completedRecord("a".repeat(64)),
          "b".repeat(64),
          "d".repeat(64),
        ),
      /different AI request/,
    );
  });

  it("records a successful settlement before a response-path crash", async () => {
    const repository = new MemoryRepository();
    const identifier = "payment_identifier_crash_recovery";
    const header = paymentHeader(identifier, "single-signed-authorization");
    const calls = { verify: 0, settle: 0 };
    const server = fakeServer(header, calls);
    let generationCalls = 0;
    const generator: AiGenerator = {
      generate: async () => {
        generationCalls += 1;
        return [
          { clue: "A durable clue", answer: "DURABLE" },
          { clue: "A retry clue", answer: "RETRY" },
          { clue: "A payment clue", answer: "PAYMENT" },
        ];
      },
    };
    const body = { topic: "durable payments", tone: "clever", count: 3 };
    await assert.rejects(
      paidAiGeneration(
        request(header),
        body,
        body,
        repository,
        generator,
        {
          server: server as never,
          afterSettlement: () => {
            throw new Error("simulated crash after external settlement");
          },
        },
      ),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "PAYMENT_RESULT_RECORDED",
    );
    const recorded = await repository.getIdempotency(
      "AI_GENERATE_X402_V2",
      "x402:ai-generate",
      identifier,
    );
    assert.equal(recorded?.state, "COMPLETED");
    assert.equal(recorded?.processingStage, null);
    assert.match(recorded?.authorizationDigest ?? "", /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(recorded).includes(header), false);
    assert.equal(recorded?.paymentReference, "near-settlement-transaction");
    assert.equal(generationCalls, 1);
    assert.equal(calls.verify, 1);
    assert.equal(calls.settle, 1);

    const recovered = await paidAiGeneration(
      request(header),
      body,
      body,
      repository,
      generator,
      { server: server as never },
    );
    assert.equal(recovered.status, 200);
    assert.equal(recovered.headers.get("x-idempotent-replay"), "true");
    assert.equal(generationCalls, 1);
    assert.equal(calls.verify, 1);
    assert.equal(calls.settle, 1);
    const completed = await repository.getIdempotency(
      "AI_GENERATE_X402_V2",
      "x402:ai-generate",
      identifier,
    );
    assert.equal(completed?.state, "COMPLETED");
    assert.equal(completed?.processingStage, null);
    assert.equal(
      completed?.paymentReference,
      "near-settlement-transaction",
    );

    const replayed = await paidAiGeneration(
      request(header),
      body,
      body,
      repository,
      generator,
      { server: server as never },
    );
    assert.equal(replayed.headers.get("x-idempotent-replay"), "true");
    assert.equal(generationCalls, 1);
    assert.equal(calls.verify, 1);
    assert.equal(calls.settle, 1);
  });

  it("leases concurrent retries so exactly one request generates and settles", async () => {
    const repository = new MemoryRepository();
    const identifier = "payment_identifier_concurrent_barrier";
    const header = paymentHeader(identifier, "single-concurrent-authorization");
    const calls = { verify: 0, settle: 0 };
    const server = fakeServer(header, calls);
    const generationEntered = deferred();
    const releaseGeneration = deferred();
    const inProgressObserved = deferred();
    let generationCalls = 0;
    const entries = [
      { clue: "Only generated once", answer: "ONCE" },
      { clue: "Durably exclusive", answer: "LEASE" },
      { clue: "Cannot overwrite", answer: "CAS" },
    ];
    const generator: AiGenerator = {
      generate: async () => {
        generationCalls += 1;
        generationEntered.resolve();
        await releaseGeneration.promise;
        return entries;
      },
    };
    const body = { topic: "concurrency", tone: "precise", count: 3 };

    const attempt = async () => {
      try {
        return {
          response: await paidAiGeneration(
            request(header),
            body,
            body,
            repository,
            generator,
            { server: server as never },
          ),
          error: null,
        };
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === "PAYMENT_IN_PROGRESS"
        ) {
          inProgressObserved.resolve();
        }
        return { response: null, error };
      }
    };
    const outcomesPromise = Promise.all([attempt(), attempt()]);
    await Promise.all([
      generationEntered.promise,
      inProgressObserved.promise,
    ]);
    releaseGeneration.resolve();
    const outcomes = await outcomesPromise;

    assert.equal(
      outcomes.filter((outcome) => outcome.response?.status === 200).length,
      1,
    );
    assert.equal(
      outcomes.filter(
        (outcome) =>
          outcome.error instanceof AppError &&
          outcome.error.code === "PAYMENT_IN_PROGRESS",
      ).length,
      1,
    );
    assert.equal(generationCalls, 1);
    assert.equal(calls.settle, 1);

    const completed = await repository.getIdempotency(
      "AI_GENERATE_X402_V2",
      "x402:ai-generate",
      identifier,
    );
    assert.equal(completed?.state, "COMPLETED");
    assert.deepEqual(
      (completed?.responseBody as { entries?: unknown }).entries,
      entries,
    );
    assert.deepEqual(
      (
        completed?.responseBody as {
          receiptHandle?: unknown;
        }
      ).receiptHandle,
      {
        version: "x402-ai-generation-receipt:v1",
        paymentIdentifier: identifier,
      },
    );
    assert.equal(completed?.processingOwner, null);
    assert.equal(completed?.processingLeaseExpiresAt, null);
    assert.equal(
      (
        await repository.listEvents("AI_REQUEST", identifier)
      ).filter((event) => event.eventType === "X402_AI_GENERATION_SETTLED")
        .length,
      1,
    );
  });

  it("rejects a forged authorization when replaying completed paid output", async () => {
    const repository = new MemoryRepository();
    const identifier = "payment_identifier_forged_completed";
    const original = paymentHeader(identifier, "paid-authorization");
    const forged = paymentHeader(identifier, "forged-authorization");
    const calls = { verify: 0, settle: 0 };
    const server = fakeServer(original, calls);
    let generationCalls = 0;
    const generator: AiGenerator = {
      generate: async () => {
        generationCalls += 1;
        return [
          { clue: "Original paid clue", answer: "ORIGINAL" },
          { clue: "Private result", answer: "PRIVATE" },
          { clue: "Bound signature", answer: "BOUND" },
        ];
      },
    };
    const body = { topic: "authorization binding", tone: "strict", count: 3 };
    const paid = await paidAiGeneration(
      request(original),
      body,
      body,
      repository,
      generator,
      { server: server as never },
    );
    assert.equal(paid.status, 200);

    await assert.rejects(
      paidAiGeneration(
        request(forged),
        body,
        body,
        repository,
        generator,
        { server: server as never },
      ),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "PAYMENT_SIGNATURE_MISMATCH",
    );
    assert.equal(generationCalls, 1);
    assert.equal(calls.verify, 1);
    assert.equal(calls.settle, 1);
  });

  it("rejects a forged authorization when replaying a terminal failure", async () => {
    const repository = new MemoryRepository();
    const identifier = "payment_identifier_forged_failed";
    const original = paymentHeader(identifier, "failed-authorization");
    const forged = paymentHeader(identifier, "forged-failure-authorization");
    const calls = { verify: 0, settle: 0 };
    const baseServer = fakeServer(original, calls);
    const failedServer = {
      http: {
        processHTTPRequest: baseServer.http.processHTTPRequest,
        processSettlement: async () => {
          calls.settle += 1;
          return {
            success: false as const,
            errorReason: "insufficient_balance",
            errorMessage: "Payment could not settle",
            headers: {},
            response: {
              status: 402,
              headers: { "content-type": "application/json" },
              body: { error: "settlement failed" },
            },
          };
        },
      },
    };
    let generationCalls = 0;
    const generator: AiGenerator = {
      generate: async () => {
        generationCalls += 1;
        return [
          { clue: "Generated before settlement", answer: "GENERATED" },
          { clue: "Payment failed", answer: "FAILED" },
          { clue: "Still authorization-bound", answer: "BOUND" },
        ];
      },
    };
    const body = { topic: "failed binding", tone: "strict", count: 3 };
    const failed = await paidAiGeneration(
      request(original),
      body,
      body,
      repository,
      generator,
      { server: failedServer as never },
    );
    assert.equal(failed.status, 402);

    await assert.rejects(
      paidAiGeneration(
        request(forged),
        body,
        body,
        repository,
        generator,
        { server: failedServer as never },
      ),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "PAYMENT_SIGNATURE_MISMATCH",
    );
    assert.equal(generationCalls, 1);
    assert.equal(calls.verify, 1);
    assert.equal(calls.settle, 1);
  });

  it("finishes a durably settled crash record without a second settlement", async () => {
    const repository = new MemoryRepository();
    const identifier = "payment_identifier_durable_crash";
    const header = paymentHeader(identifier, "durable-crash-authorization");
    const body = { topic: "durable crash", tone: "careful", count: 3 };
    const entries = [
      { clue: "Survives a crash", answer: "DURABLE" },
      { clue: "Already settled", answer: "SETTLED" },
      { clue: "No second charge", answer: "ONCE" },
    ];
    const reservation = await repository.reserveIdempotency(
      "AI_GENERATE_X402_V2",
      "x402:ai-generate",
      identifier,
      digestJson(body),
      new Date(0).toISOString(),
      {
        authorizationDigest: headerDigest(header),
        stage: "SETTLED",
        responseBody: {
          entries,
          paymentRequirements: {},
          declaredExtensions: null,
          settlement: {
            transaction: "durable-settlement-reference",
            network: "near:mainnet",
          },
        },
      },
    );
    assert.equal(reservation.created, true);
    const crashedLease = await repository.acquireIdempotencyProcessingLease(
      "AI_GENERATE_X402_V2",
      "x402:ai-generate",
      identifier,
      digestJson(body),
      headerDigest(header),
      "crashed-process",
      new Date(0).toISOString(),
      new Date(1).toISOString(),
    );
    assert.equal(crashedLease.acquired, true);

    const calls = { verify: 0, settle: 0 };
    const server = fakeServer(header, calls);
    let generationCalls = 0;
    const generator: AiGenerator = {
      generate: async () => {
        generationCalls += 1;
        return [];
      },
    };
    const recovered = await paidAiGeneration(
      request(header),
      body,
      body,
      repository,
      generator,
      { server: server as never },
    );
    assert.equal(recovered.status, 200);
    assert.equal(recovered.headers.get("x-idempotent-recovery"), "true");
    assert.equal(generationCalls, 0);
    assert.equal(calls.verify, 0);
    assert.equal(calls.settle, 0);
    const completed = await repository.getIdempotency(
      "AI_GENERATE_X402_V2",
      "x402:ai-generate",
      identifier,
    );
    assert.equal(completed?.state, "COMPLETED");
    assert.equal(
      completed?.paymentReference,
      "durable-settlement-reference",
    );
    assert.deepEqual(
      (completed?.responseBody as { entries?: unknown }).entries,
      entries,
    );
  });

  it("fails closed when an in-flight identifier is re-signed", async () => {
    const repository = new MemoryRepository();
    const identifier = "payment_identifier_signature_lock";
    const original = paymentHeader(identifier, "original-authorization");
    const resigned = paymentHeader(identifier, "different-authorization");
    const calls = { verify: 0, settle: 0 };
    const server = fakeServer(original, calls);
    let generationCalls = 0;
    const generator: AiGenerator = {
      generate: async () => {
        generationCalls += 1;
        return [
          { clue: "First clue", answer: "FIRST" },
          { clue: "Second clue", answer: "SECOND" },
          { clue: "Third clue", answer: "THIRD" },
        ];
      },
    };
    const body = { topic: "signature locking", tone: "strict", count: 3 };
    await assert.rejects(
      paidAiGeneration(
        request(original),
        body,
        body,
        repository,
        generator,
        {
          server: server as never,
          afterSettlement: () => {
            throw new Error("leave settlement uncertain");
          },
        },
      ),
    );
    await assert.rejects(
      paidAiGeneration(
        request(resigned),
        body,
        body,
        repository,
        generator,
        { server: server as never },
      ),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "PAYMENT_SIGNATURE_MISMATCH",
    );
    assert.equal(generationCalls, 1);
    assert.equal(calls.verify, 1);
    assert.equal(calls.settle, 1);
  });

  it("keeps an uncertain settlement for manual reconciliation when replay is rejected", async () => {
    const repository = new MemoryRepository();
    const identifier = "payment_identifier_manual_reconcile";
    const header = paymentHeader(identifier, "manual-reconcile-authorization");
    const calls = { verify: 0, settle: 0 };
    const baseServer = fakeServer(header, calls);
    const initialServer = {
      http: {
        processHTTPRequest: baseServer.http.processHTTPRequest,
        processSettlement: async () => {
          calls.settle += 1;
          throw new Error("facilitator response was lost");
        },
      },
    };
    const generator: AiGenerator = {
      generate: async () => [
        { clue: "First clue", answer: "FIRST" },
        { clue: "Second clue", answer: "SECOND" },
        { clue: "Third clue", answer: "THIRD" },
      ],
    };
    const body = { topic: "manual reconcile", tone: "careful", count: 3 };
    await assert.rejects(
      paidAiGeneration(
        request(header),
        body,
        body,
        repository,
        generator,
        { server: initialServer as never },
      ),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "PAYMENT_SETTLEMENT_UNKNOWN",
    );
    const rejectedReplayServer = {
      http: {
        processHTTPRequest: baseServer.http.processHTTPRequest,
        processSettlement: async () => {
          calls.settle += 1;
          return {
            success: false as const,
            errorReason: "authorization_already_used",
            errorMessage: "The authorization nonce is no longer available",
            headers: {},
            response: {
              status: 402,
              headers: { "content-type": "application/json" },
              body: { error: "settlement failed" },
            },
          };
        },
      },
    };
    await assert.rejects(
      paidAiGeneration(
        request(header),
        body,
        body,
        repository,
        generator,
        { server: rejectedReplayServer as never },
      ),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "PAYMENT_RECONCILIATION_REQUIRED",
    );
    const preserved = await repository.getIdempotency(
      "AI_GENERATE_X402_V2",
      "x402:ai-generate",
      identifier,
    );
    assert.equal(preserved?.state, "PROCESSING");
    assert.equal(preserved?.processingStage, "SETTLEMENT_UNKNOWN");
    assert.equal(preserved?.paymentReference, null);
    assert.equal(calls.verify, 1);
    assert.equal(calls.settle, 2);
  });

  it("retains expired PROCESSING payment records for reconciliation", async () => {
    const repository = new MemoryRepository();
    const first = await repository.reserveIdempotency(
      "AI_GENERATE_X402_V2",
      "x402:ai-generate",
      "expired-processing-payment",
      "a".repeat(64),
      new Date(0).toISOString(),
      {
        authorizationDigest: "b".repeat(64),
        stage: "SETTLEMENT_UNKNOWN",
        responseBody: {
          entries: [],
          paymentRequirements: {},
          declaredExtensions: null,
        },
      },
    );
    assert.equal(first.created, true);
    const attemptedReplacement = await repository.reserveIdempotency(
      "AI_GENERATE_X402_V2",
      "x402:ai-generate",
      "expired-processing-payment",
      "c".repeat(64),
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.equal(attemptedReplacement.created, false);
    assert.equal(attemptedReplacement.record.requestHash, "a".repeat(64));
    assert.equal(
      (
        await repository.getIdempotency(
          "AI_GENERATE_X402_V2",
          "x402:ai-generate",
          "expired-processing-payment",
        )
      )?.processingStage,
      "SETTLEMENT_UNKNOWN",
    );
  });

  it("retains completed payment identifiers past expiry to prevent recharge", async () => {
    const repository = new MemoryRepository();
    const key = "expired-completed-payment";
    await repository.reserveIdempotency(
      "AI_GENERATE_X402_V2",
      "x402:ai-generate",
      key,
      "a".repeat(64),
      new Date(0).toISOString(),
    );
    await repository.completeIdempotency(
      "AI_GENERATE_X402_V2",
      "x402:ai-generate",
      key,
      200,
      { entries: [] },
      "settlement-reference",
    );
    const replacement = await repository.reserveIdempotency(
      "AI_GENERATE_X402_V2",
      "x402:ai-generate",
      key,
      "b".repeat(64),
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.equal(replacement.created, false);
    assert.equal(replacement.record.state, "COMPLETED");
    assert.equal(replacement.record.requestHash, "a".repeat(64));
    assert.equal(
      (
        await repository.getIdempotency(
          "AI_GENERATE_X402_V2",
          "x402:ai-generate",
          key,
        )
      )?.paymentReference,
      "settlement-reference",
    );
  });
});
