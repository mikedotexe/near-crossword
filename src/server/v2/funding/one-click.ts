import {
  verifyQuoteSignature,
  type OneClickQuoteResponse,
} from "@defuse-protocol/one-click-sdk-typescript";
import { AppError } from "../errors";
import { campaignContractId, escrowAsset, oneClickJwt, ONE_CLICK_BASE_URL } from "../config";
import { digestJson, jsonValue } from "../validation";
import type {
  FundingOrder,
  FundingOrderStatus,
  FundingQuote,
} from "../types";
import type {
  AdapterQuoteRequest,
  FinalizationDecision,
  FundingAdapter,
  FundingObservation,
} from "./types";

type ProviderObject = Record<string, unknown>;
type QuoteVerifier = (response: OneClickQuoteResponse) => boolean;

export interface OneClickObservationOptions {
  depositMemo?: string | null;
  expectedAmountOut?: string | null;
  expectedQuote?: FundingQuote | null;
  verifyQuote?: QuoteVerifier;
}

function providerObject(value: unknown): ProviderObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(502, "INVALID_PROVIDER_RESPONSE", "1Click response is invalid");
  }
  return value as ProviderObject;
}

function objectField(
  object: ProviderObject,
  name: string,
): ProviderObject {
  return providerObject(object[name]);
}

function directString(
  object: ProviderObject,
  names: string[],
  required = true,
): string | null {
  for (const name of names) {
    const value = object[name];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  if (required) {
    throw new AppError(
      502,
      "INVALID_PROVIDER_RESPONSE",
      `1Click response is missing ${names[0]}`,
    );
  }
  return null;
}

function atomicAmount(value: string | null, label: string): string {
  if (!value || !/^(?:0|[1-9][0-9]*)$/.test(value) || BigInt(value) <= 0n) {
    throw new AppError(502, "INVALID_PROVIDER_RESPONSE", `${label} is invalid`);
  }
  return value;
}

function sameAtomicAmount(left: string, right: string): boolean {
  return BigInt(left) === BigInt(right);
}

function assertSignedQuote(
  response: ProviderObject,
  verify: QuoteVerifier,
): asserts response is OneClickQuoteResponse & ProviderObject {
  directString(response, ["correlationId"]);
  directString(response, ["timestamp"]);
  directString(response, ["signature"]);
  objectField(response, "quoteRequest");
  objectField(response, "quote");
  if (!verify(response as OneClickQuoteResponse)) {
    throw new AppError(
      502,
      "INVALID_PROVIDER_SIGNATURE",
      "1Click quote signature verification failed",
    );
  }
}

function assertQuoteRequestMatches(
  response: ProviderObject,
  requested: ProviderObject,
): void {
  const echoed = objectField(response, "quoteRequest");
  for (const field of [
    "dry",
    "swapType",
    "slippageTolerance",
    "originAsset",
    "depositType",
    "destinationAsset",
    "amount",
    "recipient",
    "recipientType",
    "refundTo",
    "refundType",
    "deadline",
  ]) {
    if (echoed[field] !== requested[field]) {
      throw new AppError(
        502,
        "INVALID_PROVIDER_QUOTE",
        `1Click signed quote does not match requested ${field}`,
      );
    }
  }
}

function transactionHashes(
  object: ProviderObject,
  name: string,
): string[] {
  const raw = object[name];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry === "string" && entry.length > 0) return [entry];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const hash = (entry as ProviderObject).hash;
      if (typeof hash === "string" && hash.length > 0) return [hash];
    }
    return [];
  });
}

function nestedValue(
  object: ProviderObject,
  names: string[],
): unknown {
  for (const name of names) {
    if (object[name] !== undefined) return object[name];
  }
  const quote = object.quote;
  if (quote && typeof quote === "object" && !Array.isArray(quote)) {
    for (const name of names) {
      if ((quote as ProviderObject)[name] !== undefined) return (quote as ProviderObject)[name];
    }
  }
  return undefined;
}

function providerString(
  object: ProviderObject,
  names: string[],
  required = true,
): string | null {
  const value = nestedValue(object, names);
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (required) {
    throw new AppError(
      502,
      "INVALID_PROVIDER_RESPONSE",
      `1Click response is missing ${names[0]}`,
    );
  }
  return null;
}

function mapStatus(status: string): FundingOrderStatus {
  switch (status.toUpperCase()) {
    case "PENDING_DEPOSIT":
      return "AWAITING_DEPOSIT";
    case "KNOWN_DEPOSIT_TX":
      return "DEPOSIT_DETECTED";
    case "PROCESSING":
      return "PROCESSING";
    case "SUCCESS":
      return "SETTLED";
    case "INCOMPLETE_DEPOSIT":
      return "INCOMPLETE";
    case "REFUNDED":
      return "REFUNDED";
    case "FAILED":
      return "FAILED";
    default:
      return "PROCESSING";
  }
}

export async function observeOneClickTransfer(
  depositAddress: string,
  fetcher: typeof fetch = fetch,
  baseUrl = ONE_CLICK_BASE_URL,
  options: OneClickObservationOptions = {},
): Promise<FundingObservation> {
  const query = new URLSearchParams({ depositAddress });
  if (options.depositMemo) query.set("depositMemo", options.depositMemo);
  const url = `${baseUrl}/status?${query.toString()}`;
  const headers: Record<string, string> = { accept: "application/json" };
  const jwt = oneClickJwt();
  if (jwt) headers.authorization = `Bearer ${jwt}`;
  let response: Response;
  try {
    response = await fetcher(url, {
      headers,
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
  } catch {
    throw new AppError(503, "STATUS_UNAVAILABLE", "1Click status is unavailable");
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AppError(
      response.status >= 500 ? 503 : 400,
      "STATUS_REJECTED",
      "1Click status request failed",
    );
  }
  const provider = providerObject(parsed);
  const status = directString(provider, ["status"])!;
  const quoteResponse = objectField(provider, "quoteResponse");
  assertSignedQuote(
    quoteResponse,
    options.verifyQuote ?? verifyQuoteSignature,
  );
  const quote = objectField(quoteResponse, "quote");
  const observedDepositAddress = directString(quote, ["depositAddress"])!;
  const observedDepositMemo = directString(quote, ["depositMemo"], false);
  if (
    observedDepositAddress !== depositAddress ||
    (options.depositMemo ?? null) !== (observedDepositMemo ?? null)
  ) {
    throw new AppError(
      502,
      "INVALID_PROVIDER_STATUS",
      "1Click status does not match the quoted deposit destination",
    );
  }
  if (options.expectedQuote) {
    if (
      quoteResponse.correlationId !== options.expectedQuote.providerQuoteId ||
      digestJson(quoteResponse) !== options.expectedQuote.rawDigest
    ) {
      throw new AppError(
        502,
        "INVALID_PROVIDER_STATUS",
        "1Click status does not match the stored signed quote",
      );
    }
  }

  const swapDetails = objectField(provider, "swapDetails");
  const originChainTxHashes = transactionHashes(
    swapDetails,
    "originChainTxHashes",
  );
  const destinationChainTxHashes = transactionHashes(
    swapDetails,
    "destinationChainTxHashes",
  );
  const depositTxHash = originChainTxHashes[0] ?? null;
  let settlementTxHash: string | null = null;
  let amountOut = directString(swapDetails, ["amountOut"], false);
  const orderStatus = mapStatus(status);
  if (orderStatus === "SETTLED") {
    amountOut = atomicAmount(amountOut, "1Click settled output amount");
    if (
      options.expectedAmountOut &&
      !sameAtomicAmount(amountOut, options.expectedAmountOut)
    ) {
      throw new AppError(
        502,
        "SETTLEMENT_AMOUNT_MISMATCH",
        "1Click settlement did not deliver the complete escrow principal",
      );
    }
    settlementTxHash = destinationChainTxHashes.at(-1) ?? null;
    if (!settlementTxHash) {
      throw new AppError(
        502,
        "SETTLEMENT_RECEIPT_MISSING",
        "1Click success has no destination-chain receipt",
      );
    }
  } else if (orderStatus === "REFUNDED") {
    const explicitRefundHashes = transactionHashes(swapDetails, "refundTxHashes");
    settlementTxHash =
      explicitRefundHashes.at(-1) ??
      (originChainTxHashes.length > 1
        ? originChainTxHashes.at(-1) ?? null
        : null);
  }
  return {
    providerStatus: status,
    orderStatus,
    depositTxHash,
    settlementTxHash,
    fundingReference: null,
    evidence: {
      provider: "1click",
      depositAddress,
      depositMemo: options.depositMemo ?? null,
      depositTxHash,
      settlementTxHash,
      amountOut,
      originReceiptCount: originChainTxHashes.length,
      destinationReceiptCount: destinationChainTxHashes.length,
      responseDigest: digestJson(provider),
    },
  };
}

export class OneClickFundingAdapter implements FundingAdapter {
  readonly rail = "ONE_CLICK" as const;

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = ONE_CLICK_BASE_URL,
    private readonly verifyQuote: QuoteVerifier = verifyQuoteSignature,
  ) {}

  async quote(request: AdapterQuoteRequest): Promise<FundingQuote> {
    if (request.campaign.reward.type !== "TOKEN_PRIZE") {
      throw new AppError(400, "UNSUPPORTED_REWARD", "Reward is not a token prize");
    }
    const escrow = escrowAsset();
    const isFunding = request.kind === "FUND_CAMPAIGN";
    const body: ProviderObject = isFunding
      ? {
          dry: false,
          swapType: "EXACT_OUTPUT",
          slippageTolerance: 100,
          originAsset: request.originAssetId,
          depositType: "ORIGIN_CHAIN",
          destinationAsset: escrow.assetId,
          amount: request.campaign.reward.amountAtomic,
          recipient: campaignContractId(),
          recipientType: "DESTINATION_CHAIN",
          refundTo: request.refundTo,
          refundType: "ORIGIN_CHAIN",
          deadline: request.deadline,
        }
      : {
          dry: false,
          swapType: "EXACT_INPUT",
          slippageTolerance: 100,
          originAsset: escrow.assetId,
          depositType: "ORIGIN_CHAIN",
          destinationAsset: request.payout.destinationAsset,
          amount: request.campaign.reward.amountAtomic,
          recipient: request.payout.recipient,
          recipientType: "DESTINATION_CHAIN",
          refundTo: request.payout.recoveryAccount,
          refundType: "ORIGIN_CHAIN",
          deadline: request.deadline,
        };
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    const jwt = oneClickJwt();
    if (jwt) headers.authorization = `Bearer ${jwt}`;
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/quote`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
    } catch {
      throw new AppError(503, "QUOTE_UNAVAILABLE", "1Click quote service is unavailable");
    }
    const parsed = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AppError(
        response.status >= 500 ? 503 : 400,
        "QUOTE_REJECTED",
        "1Click could not quote this route",
        {
          providerStatus: response.status,
          providerCode:
            parsed && typeof parsed === "object" && "code" in parsed
              ? String((parsed as ProviderObject).code)
              : null,
        },
      );
    }
    const provider = providerObject(parsed);
    assertSignedQuote(provider, this.verifyQuote);
    assertQuoteRequestMatches(provider, body);
    const quote = objectField(provider, "quote");
    const depositAddress = directString(quote, ["depositAddress"])!;
    const inputAmount = atomicAmount(
      directString(quote, ["amountIn"]),
      "1Click quoted input amount",
    );
    const outputAmount = atomicAmount(
      directString(quote, ["amountOut"]),
      "1Click quoted output amount",
    );
    const requestedPrincipal = request.campaign.reward.amountAtomic;
    if (
      (isFunding && !sameAtomicAmount(outputAmount, requestedPrincipal)) ||
      (!isFunding && !sameAtomicAmount(inputAmount, requestedPrincipal))
    ) {
      throw new AppError(
        502,
        "QUOTE_PRINCIPAL_MISMATCH",
        isFunding
          ? "1Click exact-output quote does not deliver the complete escrow principal"
          : "1Click exact-input quote does not spend the complete escrow principal",
      );
    }
    const providerDeadline = directString(quote, ["deadline"])!;
    const providerQuoteId = directString(provider, ["correlationId"])!;
    const sanitized = {
      depositAddress,
      amountIn: inputAmount,
      amountOut: outputAmount,
      deadline: providerDeadline,
      quoteId: providerQuoteId,
      signature: directString(provider, ["signature"]),
    };
    const originAsset = isFunding ? request.originAssetId : escrow.assetId;
    return {
      rail: "ONE_CLICK",
      origin: { assetId: originAsset, amountAtomic: inputAmount },
      principal: {
        assetId: escrow.assetId,
        amountAtomic: requestedPrincipal,
      },
      estimatedDelivery: {
        assetId: isFunding ? escrow.assetId : request.payout.destinationAsset,
        amountAtomic: outputAmount,
      },
      routingFee: {
        assetId: originAsset,
        amountAtomic:
          providerString(provider, ["feeAmount", "fee_amount"], false) ?? "0",
      },
      platformFee: {
        assetId: originAsset,
        amountAtomic:
          providerString(provider, ["appFeeAmount", "app_fee_amount"], false) ?? "0",
      },
      depositAddress,
      depositMemo: directString(quote, ["depositMemo"], false),
      deadline: new Date(providerDeadline).toISOString(),
      providerQuoteId,
      providerStatus: "PENDING_DEPOSIT",
      rawDigest: digestJson(provider),
      instructions: jsonValue({
        provider: "1click",
        swapType: body.swapType,
        depositAddress,
        depositAsset: originAsset,
        depositAmountAtomic: inputAmount,
        quote: sanitized,
        requiresStorageRegistration: !isFunding,
      }),
    };
  }

  async observe(order: FundingOrder): Promise<FundingObservation> {
    const observation = await observeOneClickTransfer(
      order.depositAddress,
      this.fetcher,
      this.baseUrl,
      {
        depositMemo: order.quote.depositMemo,
        expectedAmountOut: order.principalAmountAtomic,
        expectedQuote: order.quote,
        verifyQuote: this.verifyQuote,
      },
    );
    return {
      ...observation,
      fundingReference:
        observation.orderStatus === "SETTLED"
          ? order.quote.providerQuoteId ?? order.depositAddress
          : null,
    };
  }

  async finalize(order: FundingOrder): Promise<FinalizationDecision> {
    const observation = await this.observe(order);
    return {
      readyForAllocation: observation.orderStatus === "SETTLED",
      terminal: ["SETTLED", "REFUNDED", "FAILED"].includes(observation.orderStatus),
      observation,
    };
  }

  async reconcile(order: FundingOrder): Promise<FinalizationDecision> {
    return this.finalize(order);
  }
}
