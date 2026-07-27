"use client";

export interface X402BrowserPaymentRequest {
  paymentRequired: Record<string, unknown>;
  paymentIdentifier: string;
  request: {
    method: "POST";
    url: string;
    body: string;
    headers: Record<string, string>;
  };
}

/**
 * Deliberately narrow browser boundary for a wallet-owned x402 payer.
 *
 * The application never accepts a secret key. A host wallet can inject this
 * object and use its own x402 client to return the standard PAYMENT-SIGNATURE
 * header for the supplied, payment-identifier-enriched requirement.
 */
export interface X402BrowserPayer {
  createPaymentHeaders(
    request: X402BrowserPaymentRequest,
  ): Promise<Record<string, string>>;
}

declare global {
  interface Window {
    crosswordCampaignsX402Payer?: X402BrowserPayer;
  }
}

let registeredPayer: X402BrowserPayer | null = null;

export function registerX402BrowserPayer(
  payer: X402BrowserPayer | null,
): void {
  registeredPayer = payer;
}

export function getX402BrowserPayer(): X402BrowserPayer | null {
  if (registeredPayer) return registeredPayer;
  if (typeof window === "undefined") return null;
  return window.crosswordCampaignsX402Payer ?? null;
}

function objectValue(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function decodeBase64Json(value: string): unknown {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("The x402 payment challenge could not be decoded.");
  }
}

export async function paymentRequiredFromResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const header = response.headers.get("payment-required");
  if (header) {
    return objectValue(decodeBase64Json(header), "x402 payment challenge");
  }

  const body = await response
    .clone()
    .json()
    .catch(() => null);
  const envelope = objectValue(body, "x402 payment response");
  return objectValue(
    envelope.paymentRequired ?? envelope,
    "x402 payment challenge",
  );
}

export function attachPaymentIdentifier(
  requirement: Record<string, unknown>,
  paymentIdentifier: string,
): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(paymentIdentifier)) {
    throw new Error("The x402 payment identifier is invalid.");
  }
  const accepts = requirement.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new Error(
      "This deployment exposes a non-settling x402 preview; no payable route is available.",
    );
  }
  const extensions = objectValue(
    requirement.extensions,
    "x402 payment extensions",
  );
  const declaration = objectValue(
    extensions["payment-identifier"],
    "x402 payment-identifier extension",
  );
  const info = objectValue(
    declaration.info,
    "x402 payment-identifier declaration",
  );
  if (typeof info.required !== "boolean") {
    throw new Error("The x402 payment-identifier declaration is invalid.");
  }

  return {
    ...requirement,
    extensions: {
      ...extensions,
      "payment-identifier": {
        ...declaration,
        info: {
          ...info,
          id: paymentIdentifier,
        },
      },
    },
  };
}

function standardPaymentSignature(
  headers: Record<string, string>,
): string {
  const entry = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "payment-signature",
  );
  if (!entry?.[1]?.trim()) {
    throw new Error(
      "The connected payer did not return a standard PAYMENT-SIGNATURE header.",
    );
  }
  return entry[1].trim();
}

export interface X402PaidRequestOptions {
  url: string;
  body: string;
  paymentIdentifier: string;
  payer: X402BrowserPayer | null;
  fetcher?: typeof fetch;
}

/**
 * Performs the protocol's unpaid request followed by one standard paid retry.
 * If the paid response is lost or returns a transient server error, the exact
 * same signed header and payment identifier are retried once so the server can
 * replay its durable response without another settlement.
 */
export async function executeX402PaidRequest({
  url,
  body,
  paymentIdentifier,
  payer,
  fetcher = fetch,
}: X402PaidRequestOptions): Promise<Response> {
  const baseHeaders = {
    accept: "application/json",
    "content-type": "application/json",
    "idempotency-key": paymentIdentifier,
  };
  const initial = await fetcher(url, {
    method: "POST",
    headers: baseHeaders,
    body,
  });
  if (initial.status !== 402) return initial;

  const challenge = attachPaymentIdentifier(
    await paymentRequiredFromResponse(initial),
    paymentIdentifier,
  );
  if (!payer) {
    throw new Error(
      "An x402 payment is required, but no compatible browser payer is connected.",
    );
  }
  const suppliedHeaders = await payer.createPaymentHeaders({
    paymentRequired: challenge,
    paymentIdentifier,
    request: {
      method: "POST",
      url,
      body,
      headers: baseHeaders,
    },
  });
  const paymentSignature = standardPaymentSignature(suppliedHeaders);
  const paidHeaders = {
    ...baseHeaders,
    "payment-signature": paymentSignature,
  };
  const sendPaidRequest = () =>
    fetcher(url, {
      method: "POST",
      headers: paidHeaders,
      body,
    });

  try {
    const paid = await sendPaidRequest();
    if (paid.status < 500) return paid;
  } catch {
    // A response can be lost after settlement. Reuse the exact signature below.
  }
  return sendPaidRequest();
}
