import { createHash, randomUUID } from "node:crypto";
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
} from "@x402/core/server";
import {
  decodePaymentSignatureHeader,
  x402HTTPResourceServer,
} from "@x402/core/http";
import type {
  HTTPAdapter,
  HTTPProcessResult,
  HTTPRequestContext,
} from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequirements,
} from "@x402/core/types";
import { ExactNearScheme } from "@x402/near/exact/server";
import {
  AI_GENERATION_IDEMPOTENCY_SCOPE,
  AI_GENERATION_RECEIPT_VERSION,
} from "./ai-receipt";
import {
  PAYMENT_IDENTIFIER,
  declarePaymentIdentifierExtension,
  extractAndValidatePaymentIdentifier,
  paymentIdentifierResourceServerExtension,
} from "@x402/extensions/payment-identifier";
import { AppError } from "./errors";
import { isExplicitMockMode } from "./config";
import type { Repository } from "./repository";
import { digestJson, jsonValue } from "./validation";
import type {
  AiGenerator,
  AiGenerationInput,
  GeneratedClue,
} from "./ai";
import { json } from "./http";
import type { IdempotencyRecord, JsonValue } from "./types";

const routePath = "/api/v2/ai/generate";
const idempotencyScope = AI_GENERATION_IDEMPOTENCY_SCOPE;
const processingLeaseMs = 10 * 60 * 1000;

interface ServerBundle {
  http: Pick<
    x402HTTPResourceServer,
    "processHTTPRequest" | "processSettlement"
  >;
}

let serverPromise: Promise<ServerBundle> | null = null;

export interface PaidAiGenerationOptions {
  server?: ServerBundle;
  now?: () => number;
  /**
   * Test-only crash seam after an external settlement succeeds but before the
   * workflow ledger is completed.
   */
  afterSettlement?: () => void | Promise<void>;
}

interface DurableAiProcessingState {
  entries: GeneratedClue[] | null;
  paymentRequirements: PaymentRequirements;
  declaredExtensions: Record<string, unknown> | null;
  settlement: {
    transaction: string;
    network: string;
  } | null;
}

type VerifiedPayment = Extract<
  HTTPProcessResult,
  { type: "payment-verified" }
>;

class RequestAdapter implements HTTPAdapter {
  constructor(
    private readonly request: Request,
    private readonly body: unknown,
  ) {}

  getHeader(name: string): string | undefined {
    return this.request.headers.get(name) ?? undefined;
  }
  getMethod(): string {
    return this.request.method;
  }
  getPath(): string {
    return new URL(this.request.url).pathname;
  }
  getUrl(): string {
    return this.request.url;
  }
  getAcceptHeader(): string {
    return this.request.headers.get("accept") ?? "application/json";
  }
  getUserAgent(): string {
    return this.request.headers.get("user-agent") ?? "";
  }
  getBody(): unknown {
    return this.body;
  }
}

function facilitatorConfiguration() {
  const facilitatorUrl = process.env.X402_FACILITATOR_URL;
  const payTo = process.env.X402_PAY_TO;
  const network = process.env.X402_NETWORK;
  const asset = process.env.X402_ASSET || process.env.V2_USDC_CONTRACT_ID;
  const amount = process.env.X402_AI_PRICE_ATOMIC || "100000";
  const missing = [
    !facilitatorUrl && "X402_FACILITATOR_URL",
    !payTo && "X402_PAY_TO",
    !network && "X402_NETWORK",
    !asset && "X402_ASSET or V2_USDC_CONTRACT_ID",
  ].filter(Boolean);
  if (missing.length) {
    throw new AppError(
      503,
      "X402_NOT_CONFIGURED",
      `x402 is missing required configuration: ${missing.join(", ")}`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(facilitatorUrl!);
  } catch {
    throw new AppError(503, "X402_NOT_CONFIGURED", "X402_FACILITATOR_URL is invalid");
  }
  if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new AppError(503, "X402_NOT_CONFIGURED", "x402 facilitator must use HTTPS");
  }
  if (!/^near:(?:mainnet|testnet)$/.test(network!)) {
    throw new AppError(503, "X402_NOT_CONFIGURED", "X402_NETWORK must be a NEAR CAIP-2 id");
  }
  const browserNetwork = process.env.NEXT_PUBLIC_NEAR_NETWORK;
  if (
    browserNetwork &&
    network !== `near:${browserNetwork}`
  ) {
    throw new AppError(
      503,
      "X402_NOT_CONFIGURED",
      "X402_NETWORK must match NEXT_PUBLIC_NEAR_NETWORK",
    );
  }
  if (!/^[1-9][0-9]*$/.test(amount)) {
    throw new AppError(503, "X402_NOT_CONFIGURED", "X402_AI_PRICE_ATOMIC is invalid");
  }
  return {
    facilitatorUrl: parsed.toString().replace(/\/$/, ""),
    payTo: payTo!,
    network: network! as `near:${"mainnet" | "testnet"}`,
    asset: asset!,
    amount,
  };
}

async function getServer(): Promise<ServerBundle> {
  if (serverPromise) return serverPromise;
  serverPromise = (async () => {
    const config = facilitatorConfiguration();
    const bearer = process.env.X402_FACILITATOR_BEARER_TOKEN;
    const facilitator = new HTTPFacilitatorClient({
      url: config.facilitatorUrl,
      ...(bearer
        ? {
            createAuthHeaders: async () => {
              const authorization = { authorization: `Bearer ${bearer}` };
              return {
                verify: authorization,
                settle: authorization,
                supported: authorization,
              };
            },
          }
        : {}),
    });
    const resource = new x402ResourceServer(facilitator)
      .register(config.network, new ExactNearScheme())
      .registerExtension(paymentIdentifierResourceServerExtension);
    const http = new x402HTTPResourceServer(resource, {
      [`POST ${routePath}`]: {
        accepts: {
          scheme: "exact",
          network: config.network,
          payTo: config.payTo,
          price: { asset: config.asset, amount: config.amount },
          maxTimeoutSeconds: 300,
        },
        description: "Generate an editable crossword clue draft",
        mimeType: "application/json",
        serviceName: "Crossword Campaigns",
        extensions: {
          [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(true),
        },
        unpaidResponseBody: async () => ({
          contentType: "application/json",
          body: {
            error: {
              code: "PAYMENT_REQUIRED",
              message: "One x402 payment purchases one AI clue draft",
            },
          },
        }),
      },
    });
    await http.initialize();
    return { http };
  })().catch((error) => {
    serverPromise = null;
    if (error instanceof AppError) throw error;
    throw new AppError(503, "X402_UNAVAILABLE", "x402 facilitator is unavailable");
  });
  return serverPromise;
}

export function x402PaymentIdentity(header: string): {
  paymentIdentifier: string;
  actorId: string;
} {
  let payload;
  try {
    payload = decodePaymentSignatureHeader(header);
  } catch {
    throw new AppError(400, "INVALID_PAYMENT_SIGNATURE", "PAYMENT-SIGNATURE is invalid");
  }
  const extracted = extractAndValidatePaymentIdentifier(payload);
  if (!extracted.validation.valid || !extracted.id) {
    throw new AppError(
      400,
      "PAYMENT_IDENTIFIER_REQUIRED",
      "A valid payment-identifier extension is required",
      extracted.validation.errors,
    );
  }
  return {
    paymentIdentifier: extracted.id,
    // payment-identifier is globally unique for this paid resource. It must not
    // be scoped to the signature bytes: a client may legitimately re-sign a
    // retry, and doing so must never create a second settlement opportunity.
    actorId: "x402:ai-generate",
  };
}

function authorizationDigest(header: string): string {
  return createHash("sha256").update(header, "utf8").digest("hex");
}

function decodedPaymentPayload(header: string): PaymentPayload {
  try {
    return decodePaymentSignatureHeader(header);
  } catch {
    throw new AppError(
      400,
      "INVALID_PAYMENT_SIGNATURE",
      "PAYMENT-SIGNATURE is invalid",
    );
  }
}

function assertStoredIdentity(
  record: IdempotencyRecord,
  requestHash: string,
  signatureDigest: string,
): void {
  if (record.requestHash !== requestHash) {
    throw new AppError(
      409,
      "PAYMENT_IDENTIFIER_REUSED",
      "Payment identifier was used for a different AI request",
    );
  }
  if (
    record.authorizationDigest === null ||
    (record.state === "PROCESSING" && record.processingStage === null)
  ) {
    throw new AppError(
      409,
      "PAYMENT_RECONCILIATION_REQUIRED",
      "This in-flight payment predates crash-safe recovery and requires manual reconciliation",
    );
  }
  if (record.authorizationDigest !== signatureDigest) {
    throw new AppError(
      409,
      "PAYMENT_SIGNATURE_MISMATCH",
      "A payment identifier must use the exact original PAYMENT-SIGNATURE",
    );
  }
}

function durableProcessingState(
  record: IdempotencyRecord,
): DurableAiProcessingState {
  if (
    !record.responseBody ||
    typeof record.responseBody !== "object" ||
    Array.isArray(record.responseBody)
  ) {
    throw new AppError(
      409,
      "PAYMENT_RECONCILIATION_REQUIRED",
      "Durable payment settlement context is unavailable",
    );
  }
  const body = record.responseBody;
  if (
    !body.paymentRequirements ||
    typeof body.paymentRequirements !== "object" ||
    Array.isArray(body.paymentRequirements)
  ) {
    throw new AppError(
      409,
      "PAYMENT_RECONCILIATION_REQUIRED",
      "Durable payment requirements are unavailable",
    );
  }
  const entries =
    body.entries === null
      ? null
      : Array.isArray(body.entries) &&
          body.entries.every(
            (entry) =>
              entry !== null &&
              typeof entry === "object" &&
              !Array.isArray(entry) &&
              typeof entry.clue === "string" &&
              typeof entry.answer === "string",
          )
        ? (body.entries as unknown as GeneratedClue[])
        : undefined;
  if (entries === undefined) {
    throw new AppError(
      409,
      "PAYMENT_RECONCILIATION_REQUIRED",
      "Durable AI generation result is invalid",
    );
  }
  const declaredExtensions =
    body.declaredExtensions === null
      ? null
      : body.declaredExtensions &&
          typeof body.declaredExtensions === "object" &&
          !Array.isArray(body.declaredExtensions)
        ? (body.declaredExtensions as Record<string, unknown>)
        : undefined;
  if (declaredExtensions === undefined) {
    throw new AppError(
      409,
      "PAYMENT_RECONCILIATION_REQUIRED",
      "Durable payment extension context is invalid",
    );
  }
  const settlementValue = body.settlement;
  const settlement =
    settlementValue === undefined || settlementValue === null
      ? null
      : settlementValue &&
          typeof settlementValue === "object" &&
          !Array.isArray(settlementValue) &&
          typeof settlementValue.transaction === "string" &&
          typeof settlementValue.network === "string"
        ? {
            transaction: settlementValue.transaction,
            network: settlementValue.network,
          }
        : undefined;
  if (settlement === undefined) {
    throw new AppError(
      409,
      "PAYMENT_RECONCILIATION_REQUIRED",
      "Durable payment settlement result is invalid",
    );
  }
  return {
    entries,
    paymentRequirements:
      body.paymentRequirements as unknown as PaymentRequirements,
    declaredExtensions,
    settlement,
  };
}

function processingBody(state: DurableAiProcessingState): JsonValue {
  return jsonValue({
    entries: state.entries,
    paymentRequirements: state.paymentRequirements,
    declaredExtensions: state.declaredExtensions,
    settlement: state.settlement,
  });
}

function durableDeclaredExtensions(
  extensions: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!extensions || !(PAYMENT_IDENTIFIER in extensions)) return null;
  const paymentIdentifier = extensions[PAYMENT_IDENTIFIER];
  if (paymentIdentifier === undefined) return null;
  // This service declares only payment-identifier. Never persist arbitrary
  // extension payloads alongside a payment authorization.
  return {
    [PAYMENT_IDENTIFIER]: jsonValue(paymentIdentifier),
  };
}

export function replayResponse(
  previous: IdempotencyRecord,
  requestHash: string,
  signatureDigest: string,
): { body: JsonValue; status: number } {
  assertStoredIdentity(previous, requestHash, signatureDigest);
  if (previous.state !== "COMPLETED") {
    throw new AppError(
      409,
      "PAYMENT_IN_PROGRESS",
      "This payment identifier is already being processed",
    );
  }
  return {
    body:
      previous.responseBody &&
      typeof previous.responseBody === "object" &&
      !Array.isArray(previous.responseBody)
        ? { ...previous.responseBody, cached: true }
        : previous.responseBody,
    status: previous.responseStatus ?? 200,
  };
}

function leaseWindow(now: () => number): {
  acquiredAt: string;
  leaseExpiresAt: string;
} {
  const acquiredAtMs = now();
  return {
    acquiredAt: new Date(acquiredAtMs).toISOString(),
    leaseExpiresAt: new Date(acquiredAtMs + processingLeaseMs).toISOString(),
  };
}

function completedAiBody(
  durable: DurableAiProcessingState,
  paymentIdentifier: string,
) {
  if (durable.entries === null || durable.settlement === null) {
    throw new AppError(
      409,
      "PAYMENT_RECONCILIATION_REQUIRED",
      "Durable paid generation result is incomplete",
    );
  }
  return {
    entries: durable.entries,
    receiptHandle: {
      version: AI_GENERATION_RECEIPT_VERSION,
      paymentIdentifier,
    },
    payment: {
      rail: "x402",
      paymentIdentifier,
      settlementReference: durable.settlement.transaction,
      network: durable.settlement.network,
    },
    cached: false,
  };
}

function responseFromInstructions(instructions: {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}): Response {
  const headers = new Headers(instructions.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  const body =
    instructions.body === undefined
      ? null
      : typeof instructions.body === "string"
        ? instructions.body
        : JSON.stringify(instructions.body);
  return new Response(body, { status: instructions.status, headers });
}

export function mockPaymentChallenge(request: Request): Response {
  const requirement = {
    x402Version: 2,
    resource: {
      url: request.url,
      description: "Local mock challenge; no payment will be accepted or settled",
      mimeType: "application/json",
    },
    accepts: [],
    extensions: {
      [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(true),
    },
    error: "Mock mode never treats a header as payment",
  };
  return json(
    {
      error: {
        code: "MOCK_PAYMENT_REQUIRED",
        message: "Mock mode exposes the x402 challenge but never settles funds",
      },
      paymentRequired: requirement,
    },
    402,
    {
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(requirement)).toString("base64"),
    },
  );
}

export async function paidAiGeneration(
  request: Request,
  rawBody: unknown,
  input: AiGenerationInput,
  repository: Repository,
  generator: AiGenerator,
  options: PaidAiGenerationOptions = {},
): Promise<Response> {
  if (isExplicitMockMode()) return mockPaymentChallenge(request);
  if (process.env.X402_ENABLED !== "true") {
    throw new AppError(503, "X402_DISABLED", "x402 AI generation is not enabled");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AppError(503, "AI_NOT_CONFIGURED", "AI generation is not configured");
  }

  const bundle = options.server ?? (await getServer());
  const now = options.now ?? Date.now;
  const paymentHeader = request.headers.get("payment-signature");
  const identity = paymentHeader ? x402PaymentIdentity(paymentHeader) : null;
  const signatureDigest = paymentHeader
    ? authorizationDigest(paymentHeader)
    : null;
  const requestHash = digestJson(rawBody);
  let existing: IdempotencyRecord | null = null;

  if (identity) {
    existing = await repository.getIdempotency(
      idempotencyScope,
      identity.actorId,
      identity.paymentIdentifier,
    );
    if (existing?.state === "COMPLETED") {
      const replay = replayResponse(existing, requestHash, signatureDigest!);
      return json(replay.body, replay.status, { "x-idempotent-replay": "true" });
    }
    if (existing?.state === "FAILED") {
      assertStoredIdentity(existing, requestHash, signatureDigest!);
      return json(
        existing.responseBody,
        existing.responseStatus ?? 409,
        { "x-idempotent-replay": "true" },
      );
    }
    if (existing && signatureDigest) {
      assertStoredIdentity(existing, requestHash, signatureDigest);
    }
  }

  const adapter = new RequestAdapter(request, rawBody);
  const context: HTTPRequestContext = {
    adapter,
    path: routePath,
    method: "POST",
    paymentHeader: paymentHeader ?? undefined,
    routePattern: `POST ${routePath}`,
  };
  let paymentPayload: PaymentPayload;
  let processingRecord: IdempotencyRecord;
  let cancellationDispatcher:
    | VerifiedPayment["cancellationDispatcher"]
    | null = null;

  if (existing && identity && paymentHeader && signatureDigest) {
    processingRecord = existing;
    paymentPayload = decodedPaymentPayload(paymentHeader);
  } else {
    const payment = await bundle.http.processHTTPRequest(context);
    if (payment.type === "payment-error") {
      return responseFromInstructions(payment.response);
    }
    if (
      payment.type !== "payment-verified" ||
      !identity ||
      !paymentHeader ||
      !signatureDigest
    ) {
      throw new AppError(
        402,
        "PAYMENT_REQUIRED",
        "A verified x402 payment is required",
      );
    }
    cancellationDispatcher = payment.cancellationDispatcher;
    const initialState: DurableAiProcessingState = {
      entries: null,
      paymentRequirements: payment.paymentRequirements,
      declaredExtensions: durableDeclaredExtensions(
        payment.declaredExtensions,
      ),
      settlement: null,
    };
    const reservation = await repository.reserveIdempotency(
      idempotencyScope,
      identity.actorId,
      identity.paymentIdentifier,
      requestHash,
      new Date(
        now() + 24 * 60 * 60 * 1000,
      ).toISOString(),
      {
        authorizationDigest: signatureDigest,
        stage: "AUTHORIZED",
        responseBody: processingBody(initialState),
      },
    );
    if (!reservation.created) {
      if (reservation.record.state === "COMPLETED") {
        await payment.cancellationDispatcher
          .cancel({ reason: "handler_failed" })
          .catch(() => undefined);
        const replay = replayResponse(
          reservation.record,
          requestHash,
          signatureDigest,
        );
        return json(replay.body, replay.status, {
          "x-idempotent-replay": "true",
        });
      }
      if (reservation.record.state === "FAILED") {
        await payment.cancellationDispatcher
          .cancel({ reason: "handler_failed" })
          .catch(() => undefined);
        assertStoredIdentity(
          reservation.record,
          requestHash,
          signatureDigest,
        );
        return json(
          reservation.record.responseBody,
          reservation.record.responseStatus ?? 409,
          { "x-idempotent-replay": "true" },
        );
      }
      assertStoredIdentity(
        reservation.record,
        requestHash,
        signatureDigest,
      );
      processingRecord = reservation.record;
      paymentPayload = decodedPaymentPayload(paymentHeader);
    } else {
      processingRecord = reservation.record;
      paymentPayload = payment.paymentPayload;
    }
  }

  if (!identity || !paymentHeader || !signatureDigest) {
    throw new AppError(
      402,
      "PAYMENT_REQUIRED",
      "A verified x402 payment is required",
    );
  }

  const ownerId = randomUUID();
  const lease = leaseWindow(now);
  const ownership = await repository.acquireIdempotencyProcessingLease(
    idempotencyScope,
    identity.actorId,
    identity.paymentIdentifier,
    requestHash,
    signatureDigest,
    ownerId,
    lease.acquiredAt,
    lease.leaseExpiresAt,
  );
  if (!ownership.acquired) {
    await cancellationDispatcher
      ?.cancel({ reason: "handler_failed" })
      .catch(() => undefined);
    if (ownership.record.state === "COMPLETED") {
      const replay = replayResponse(
        ownership.record,
        requestHash,
        signatureDigest,
      );
      return json(replay.body, replay.status, {
        "x-idempotent-replay": "true",
      });
    }
    assertStoredIdentity(ownership.record, requestHash, signatureDigest);
    if (ownership.record.state === "FAILED") {
      return json(
        ownership.record.responseBody,
        ownership.record.responseStatus ?? 409,
        { "x-idempotent-replay": "true" },
      );
    }
    throw new AppError(
      409,
      "PAYMENT_IN_PROGRESS",
      "This payment identifier is already being processed",
    );
  }

  processingRecord = ownership.record;
  let durable = durableProcessingState(processingRecord);

  // If a process disappeared while a facilitator request was outstanding, the
  // first lease recovery records that uncertainty without starting a second
  // settlement. A subsequent exact-authorization retry may reconcile it.
  if (processingRecord.processingStage === "SETTLING") {
    const uncertain = await repository.advanceIdempotencyProcessing(
      idempotencyScope,
      identity.actorId,
      identity.paymentIdentifier,
      requestHash,
      signatureDigest,
      ownerId,
      processingRecord.processingVersion,
      "SETTLING",
      "SETTLEMENT_UNKNOWN",
      processingBody(durable),
      null,
    );
    if (!uncertain) {
      throw new AppError(
        409,
        "PAYMENT_IN_PROGRESS",
        "Payment recovery state changed; retry safely",
      );
    }
    throw new AppError(
      503,
      "PAYMENT_SETTLEMENT_UNKNOWN",
      "Payment settlement may have completed; retry with the exact same PAYMENT-SIGNATURE",
    );
  }

  let settlementStarted = false;
  let settlementMarkedUnknown = false;
  try {
    let entries = durable.entries;
    if (entries === null) {
      if (processingRecord.processingStage !== "AUTHORIZED") {
        throw new AppError(
          409,
          "PAYMENT_RECONCILIATION_REQUIRED",
          "Settlement recovery is missing its durable AI result",
        );
      }
      entries = await generator.generate(input);
      durable = { ...durable, entries };
      const generated = await repository.advanceIdempotencyProcessing(
        idempotencyScope,
        identity.actorId,
        identity.paymentIdentifier,
        requestHash,
        signatureDigest,
        ownerId,
        processingRecord.processingVersion,
        "AUTHORIZED",
        "GENERATED",
        processingBody(durable),
        leaseWindow(now).leaseExpiresAt,
      );
      if (!generated) {
        throw new AppError(
          409,
          "PAYMENT_IN_PROGRESS",
          "Payment generation state changed; retry safely",
        );
      }
      processingRecord = generated;
    }

    if (processingRecord.processingStage === "SETTLED") {
      const recoveredBody = completedAiBody(
        durable,
        identity.paymentIdentifier,
      );
      const recovered = await repository.finishOwnedIdempotency(
        idempotencyScope,
        identity.actorId,
        identity.paymentIdentifier,
        ownerId,
        processingRecord.processingVersion,
        "SETTLED",
        "COMPLETED",
        200,
        jsonValue(recoveredBody),
        durable.settlement!.transaction,
      );
      if (!recovered) {
        const current = await repository.getIdempotency(
          idempotencyScope,
          identity.actorId,
          identity.paymentIdentifier,
        );
        if (current?.state === "COMPLETED") {
          const replay = replayResponse(
            current,
            requestHash,
            signatureDigest,
          );
          return json(replay.body, replay.status, {
            "x-idempotent-replay": "true",
          });
        }
        throw new AppError(
          409,
          "PAYMENT_IN_PROGRESS",
          "Durable settlement completion changed; retry safely",
        );
      }
      return json(recoveredBody, 200, {
        "x-idempotent-recovery": "true",
      });
    }

    const settlementFrom = processingRecord.processingStage;
    if (
      settlementFrom !== "GENERATED" &&
      settlementFrom !== "SETTLEMENT_UNKNOWN"
    ) {
      throw new AppError(
        409,
        "PAYMENT_RECONCILIATION_REQUIRED",
        "Payment settlement stage requires manual reconciliation",
      );
    }
    const recoveringUnknownSettlement =
      settlementFrom === "SETTLEMENT_UNKNOWN";
    const settling = await repository.advanceIdempotencyProcessing(
      idempotencyScope,
      identity.actorId,
      identity.paymentIdentifier,
      requestHash,
      signatureDigest,
      ownerId,
      processingRecord.processingVersion,
      settlementFrom,
      "SETTLING",
      processingBody(durable),
      leaseWindow(now).leaseExpiresAt,
    );
    if (!settling) {
      throw new AppError(
        409,
        "PAYMENT_IN_PROGRESS",
        "Payment settlement state changed; retry safely",
      );
    }
    processingRecord = settling;
    settlementStarted = true;

    const settlement = await bundle.http.processSettlement(
      paymentPayload,
      durable.paymentRequirements,
      durable.declaredExtensions ?? undefined,
      {
        request: context,
        responseBody: Buffer.from(JSON.stringify({ entries })),
        responseHeaders: { "content-type": "application/json" },
      },
    );
    if (!settlement.success) {
      if (recoveringUnknownSettlement) {
        const uncertain = await repository.advanceIdempotencyProcessing(
          idempotencyScope,
          identity.actorId,
          identity.paymentIdentifier,
          requestHash,
          signatureDigest,
          ownerId,
          processingRecord.processingVersion,
          "SETTLING",
          "SETTLEMENT_UNKNOWN",
          processingBody(durable),
          null,
        );
        if (uncertain) processingRecord = uncertain;
        settlementMarkedUnknown = true;
        throw new AppError(
          503,
          "PAYMENT_RECONCILIATION_REQUIRED",
          "Settlement may already have completed and requires reconciliation",
        );
      }
      const failure = {
        error: {
          code: "PAYMENT_SETTLEMENT_FAILED",
          message: settlement.errorMessage || settlement.errorReason,
        },
      };
      const failed = await repository.finishOwnedIdempotency(
        idempotencyScope,
        identity.actorId,
        identity.paymentIdentifier,
        ownerId,
        processingRecord.processingVersion,
        "SETTLING",
        "FAILED",
        settlement.response.status,
        failure,
      );
      if (!failed) {
        throw new AppError(
          409,
          "PAYMENT_IN_PROGRESS",
          "Payment failure state changed; retry safely",
        );
      }
      return responseFromInstructions(settlement.response);
    }

    durable = {
      ...durable,
      settlement: {
        transaction: settlement.transaction,
        network: settlement.network,
      },
    };
    const settled = await repository.advanceIdempotencyProcessing(
      idempotencyScope,
      identity.actorId,
      identity.paymentIdentifier,
      requestHash,
      signatureDigest,
      ownerId,
      processingRecord.processingVersion,
      "SETTLING",
      "SETTLED",
      processingBody(durable),
      leaseWindow(now).leaseExpiresAt,
    );
    if (!settled) {
      throw new AppError(
        409,
        "PAYMENT_SETTLEMENT_UNKNOWN",
        "Settlement succeeded but its durable ledger update conflicted",
      );
    }
    processingRecord = settled;
    settlementStarted = false;

    await options.afterSettlement?.();
    const body = completedAiBody(durable, identity.paymentIdentifier);
    const completedResult = await repository.finishOwnedIdempotency(
      idempotencyScope,
      identity.actorId,
      identity.paymentIdentifier,
      ownerId,
      processingRecord.processingVersion,
      "SETTLED",
      "COMPLETED",
      200,
      jsonValue(body),
      settlement.transaction,
    );
    if (!completedResult) {
      const completed = await repository.getIdempotency(
        idempotencyScope,
        identity.actorId,
        identity.paymentIdentifier,
      );
      if (!completed || completed.state !== "COMPLETED") {
        throw new AppError(
          409,
          "IDEMPOTENCY_STATE_CONFLICT",
          "Payment completion state changed",
        );
      }
      const replay = replayResponse(
        completed,
        requestHash,
        signatureDigest,
      );
      return json(replay.body, replay.status, {
        "x-idempotent-replay": "true",
      });
    }
    await repository
      .appendEvent({
        aggregateType: "AI_REQUEST",
        aggregateId: identity.paymentIdentifier,
        eventType: "X402_AI_GENERATION_SETTLED",
        actorId: identity.actorId,
        fromState: "PROCESSING",
        toState: "COMPLETED",
        idempotencyKey: identity.paymentIdentifier,
        evidence: {
          requestHash,
          settlementReference: settlement.transaction,
          network: settlement.network,
        },
      })
      .catch(() => undefined);
    return json(body, 200, settlement.headers);
  } catch (error) {
    if (
      processingRecord.processingStage === "SETTLED" &&
      durable.settlement !== null
    ) {
      const body = completedAiBody(durable, identity.paymentIdentifier);
      await repository
        .finishOwnedIdempotency(
          idempotencyScope,
          identity.actorId,
          identity.paymentIdentifier,
          ownerId,
          processingRecord.processingVersion,
          "SETTLED",
          "COMPLETED",
          200,
          jsonValue(body),
          durable.settlement.transaction,
        )
        .catch(() => undefined);
      throw new AppError(
        503,
        "PAYMENT_RESULT_RECORDED",
        "Payment settled and the result was recorded; retry with the exact same PAYMENT-SIGNATURE",
      );
    }
    if (settlementMarkedUnknown) throw error;
    if (settlementStarted) {
      if (processingRecord.processingStage === "SETTLING") {
        await repository
          .advanceIdempotencyProcessing(
            idempotencyScope,
            identity.actorId,
            identity.paymentIdentifier,
            requestHash,
            signatureDigest,
            ownerId,
            processingRecord.processingVersion,
            "SETTLING",
            "SETTLEMENT_UNKNOWN",
            processingBody(durable),
            null,
          )
          .catch(() => undefined);
      }
      throw new AppError(
        503,
        "PAYMENT_SETTLEMENT_UNKNOWN",
        "Payment settlement may have completed; retry with the exact same PAYMENT-SIGNATURE",
      );
    }
    await cancellationDispatcher
      ?.cancel({ reason: "handler_threw", error })
      .catch(() => undefined);
    const failure = {
      error: {
        code: error instanceof AppError ? error.code : "AI_GENERATION_FAILED",
        message: error instanceof Error ? error.message : "AI generation failed",
      },
    };
    const shouldRemainRecoverable =
      error instanceof AppError &&
      ["PAYMENT_IN_PROGRESS", "PAYMENT_RECONCILIATION_REQUIRED"].includes(
        error.code,
      );
    if (!shouldRemainRecoverable && processingRecord.processingStage) {
      await repository
        .finishOwnedIdempotency(
          idempotencyScope,
          identity.actorId,
          identity.paymentIdentifier,
          ownerId,
          processingRecord.processingVersion,
          processingRecord.processingStage,
          "FAILED",
          error instanceof AppError ? error.status : 500,
          failure,
        )
        .catch(() => undefined);
    }
    throw error;
  }
}

export function resetX402ServerForTests(): void {
  serverPromise = null;
}
