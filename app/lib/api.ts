import { demoCampaigns, getDemoCampaign } from "./demo-data";
import type {
  AuthorizedFundingDeposit,
  Campaign,
  CampaignClaim,
  CampaignDraft,
  CampaignFundingOrder,
  CampaignFundingQuoteResult,
  CampaignLifecycleStatus,
  AiGenerationReceiptHandle,
  EscrowAsset,
  FundingAuthorizationConfirmation,
  SupportedToken,
} from "./types";
import {
  executeX402PaidRequest,
  getX402BrowserPayer,
} from "./x402-browser";

interface ServerFetchOptions {
  cookie?: string;
  mine?: boolean;
}

function demoIdentityHeaders(): Record<string, string> {
  const demoUserId = process.env.NEXT_PUBLIC_V2_DEMO_USER_ID;
  return demoUserId ? { "x-demo-user-id": demoUserId } : {};
}

function appOrigin(): string | null {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return null;
}

function formatAtomic(amount: string, decimals: number): string {
  if (!/^\d+$/.test(amount) || decimals < 0) return amount;
  const padded = amount.padStart(decimals + 1, "0");
  const whole = decimals ? padded.slice(0, -decimals) : padded;
  const fraction = decimals
    ? padded.slice(-decimals).replace(/0+$/, "").slice(0, 2)
    : "";
  return fraction ? `${whole}.${fraction.padEnd(2, "0")}` : `${whole}.00`;
}

function sponsorMark(name: string) {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (words.length > 1
    ? `${words[0][0]}${words[words.length - 1][0]}`
    : words[0]?.slice(0, 2) || "CC"
  ).toUpperCase();
}

function normalizeStatus(status: unknown): Campaign["state"] {
  const statuses: Record<string, Campaign["state"]> = {
    DRAFT: "draft",
    FUNDING: "awaiting_funding",
    SCHEDULED: "scheduled",
    ACTIVE: "active",
    CLAIMING: "claiming",
    CLAIMED: "claimed",
    REFUNDING: "refunding",
    REFUNDED: "refunded",
    CANCELLED: "expired",
  };
  return statuses[String(status).toUpperCase()] ?? "draft";
}

function normalizeCampaign(payload: unknown): Campaign | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;

  // Already in the presentation shape (including the explicit demo fixtures).
  if (
    typeof value.state === "string" &&
    value.puzzle &&
    typeof value.puzzle === "object" &&
    Array.isArray((value.puzzle as { entries?: unknown }).entries)
  ) {
    return value as unknown as Campaign;
  }

  if (!value.id || !value.slug || !value.title || !value.puzzle) return null;
  const puzzle = value.puzzle as Record<string, unknown>;
  const clues = Array.isArray(puzzle.clues) ? puzzle.clues : [];
  const reward = (value.reward ?? {}) as Record<string, unknown>;
  const decimals = Number(reward.decimals ?? 6);
  const amountAtomic = String(reward.amountAtomic ?? "0");
  const sponsorName = String(value.sponsorName || "Independent sponsor");
  const createdAt = String(value.createdAt ?? new Date().toISOString());
  const opensAt = String(value.openingAt ?? createdAt);
  const expiresAt = String(
    value.expiresAt ??
      new Date(new Date(opensAt).getTime() + 7 * 86_400_000).toISOString(),
  );
  const amount = formatAtomic(amountAtomic, decimals);
  const state = normalizeStatus(value.status);
  const aiGenerationReceipt =
    value.aiGenerationReceipt &&
    typeof value.aiGenerationReceipt === "object" &&
    !Array.isArray(value.aiGenerationReceipt)
      ? (value.aiGenerationReceipt as Record<string, unknown>)
      : null;
  const hasAiGenerationReceipt =
    typeof aiGenerationReceipt?.paymentIdentifier === "string" &&
    typeof aiGenerationReceipt.receiptDigest === "string" &&
    typeof aiGenerationReceipt.network === "string" &&
    typeof aiGenerationReceipt.settlementReference === "string";
  const escrowEvidence = ["draft", "awaiting_funding"].includes(state)
    ? `${amount} USDC not yet reserved`
    : `${amount} USDC · contract verification pending`;

  return {
    id: String(value.id),
    slug: String(value.slug),
    title: String(value.title),
    description: String(
      value.description ||
        "A sponsor-funded crossword with a prize locked before play.",
    ),
    sponsorName,
    sponsorMark: sponsorMark(sponsorName),
    theme: "Community puzzle",
    state,
    visibility: value.visibility === "UNLISTED" ? "unlisted" : "public",
    opensAt,
    expiresAt,
    createdAt,
    reward: {
      type: "token",
      amount,
      symbol: "USDC",
      decimals: 6,
      escrowAccount: String(value.contractId ?? "Awaiting allocation"),
      fundingRail: "direct",
      originLabel: "Funding rail shown after receipt verification",
    },
    puzzle: {
      rows: Number(puzzle.height ?? puzzle.rows ?? 5),
      columns: Number(puzzle.width ?? puzzle.columns ?? 5),
      entries: clues.map((clue) => {
        const entry = clue as Record<string, unknown>;
        return {
          number: Number(entry.number),
          row: Number(entry.row),
          column: Number(entry.column ?? entry.col),
          length: Number(entry.length),
          direction: entry.direction === "down" ? "down" : "across",
          clue: String(entry.clue ?? ""),
        };
      }),
    },
    rules: [
      "Free to play. No purchase is required.",
      "The first valid completed solution wins.",
      "Payout is bound to a short-lived quote and cannot be redirected.",
    ],
    solverCount: Number(value.solverCount ?? 0),
    evidence: [
      {
        label: "Escrow",
        value: escrowEvidence,
      },
      ...(value.fundingReference
        ? [
            {
              label: "Funding",
              value: String(value.fundingReference),
            },
          ]
        : []),
      ...(value.contentHash
        ? [
            {
              label: "Content",
              value: `sha256:${String(value.contentHash)}`,
            },
          ]
        : []),
      ...(hasAiGenerationReceipt
        ? [
            {
              label: "x402 AI creation",
              value: `${String(aiGenerationReceipt.network)} · ${String(
                aiGenerationReceipt.settlementReference,
              )}`,
            },
            {
              label: "AI receipt digest",
              value: `sha256:${String(aiGenerationReceipt.receiptDigest)}`,
            },
          ]
        : []),
    ],
    verification: {
      status: "unavailable",
      fundedAndLocked: false,
      contractMatchesLedger: false,
      contractState: null,
      contractExplorerUrl: null,
      fundingTransactionExplorerUrl: null,
    },
    contentHash: String(value.contentHash ?? ""),
    contractId: String(value.contractId ?? "Awaiting chain allocation"),
  };
}

function verifiedCampaign(
  campaign: Campaign,
  payload: unknown,
): Campaign {
  if (!payload || typeof payload !== "object") return campaign;
  const envelope = payload as Record<string, unknown>;
  const raw =
    envelope.evidence && typeof envelope.evidence === "object"
      ? (envelope.evidence as Record<string, unknown>)
      : envelope;
  const contract =
    raw.contract && typeof raw.contract === "object"
      ? (raw.contract as Record<string, unknown>)
      : null;
  const funding =
    raw.funding && typeof raw.funding === "object"
      ? (raw.funding as Record<string, unknown>)
      : null;
  if (!contract) return campaign;

  const contractMatchesLedger = contract.evidenceMatchesLedger === true;
  const fundedAndLocked =
    funding?.fundedAndLocked === true && contractMatchesLedger;
  const fundingRail =
    funding?.rail === "ONE_CLICK"
      ? "intents"
      : funding?.rail === "DIRECT_NEAR"
        ? "direct"
        : campaign.reward.type === "token"
          ? campaign.reward.fundingRail
          : null;
  const origin =
    funding?.origin && typeof funding.origin === "object"
      ? (funding.origin as Record<string, unknown>)
      : null;
  const contractState =
    typeof contract.state === "string" ? contract.state : null;
  const contractExplorerUrl =
    typeof contract.explorerUrl === "string" ? contract.explorerUrl : null;
  const fundingTransactionExplorerUrl =
    typeof funding?.allocationExplorerUrl === "string"
      ? funding.allocationExplorerUrl
      : typeof funding?.directDepositExplorerUrl === "string"
        ? funding.directDepositExplorerUrl
        : null;
  const prizeDisplay =
    campaign.reward.type === "token"
      ? `${campaign.reward.amount} ${campaign.reward.symbol}`
      : campaign.reward.title;
  const escrowValue =
    contractMatchesLedger && contractState === "claimed"
      ? `${prizeDisplay} · released from escrow`
      : contractMatchesLedger && contractState === "refunded"
        ? `${prizeDisplay} · refunded`
        : fundedAndLocked && campaign.reward.type === "token"
          ? `${campaign.reward.amount} ${campaign.reward.symbol} reserved`
          : campaign.evidence.find((item) => item.label === "Escrow")?.value ??
            "Contract verification pending";
  const nextEvidence = [
    ...campaign.evidence.filter((item) => item.label !== "Escrow"),
    { label: "Escrow", value: escrowValue },
  ];
  if (fundingTransactionExplorerUrl) {
    nextEvidence.push({
      label: "Funding transaction",
      value:
        typeof funding?.allocationTxHash === "string"
          ? funding.allocationTxHash
          : typeof funding?.depositTxHash === "string"
            ? funding.depositTxHash
            : "Open receipt",
      href: fundingTransactionExplorerUrl,
    });
  }
  if (contractExplorerUrl) {
    nextEvidence.push({
      label: "Escrow contract",
      value:
        typeof contract.accountId === "string"
          ? contract.accountId
          : campaign.contractId,
      href: contractExplorerUrl,
    });
  }
  return {
    ...campaign,
    reward:
      campaign.reward.type === "token" && fundingRail
        ? {
            ...campaign.reward,
            fundingRail,
            originLabel:
              typeof origin?.assetId === "string"
                ? `Funded from ${origin.assetId}`
                : fundingRail === "intents"
                  ? "Funded through NEAR Intents"
                  : "Funded with native USDC on NEAR",
          }
        : campaign.reward,
    evidence: nextEvidence,
    verification: {
      status: "verified",
      fundedAndLocked,
      contractMatchesLedger,
      contractState,
      contractExplorerUrl,
      fundingTransactionExplorerUrl,
    },
  };
}

function normalizeCampaigns(payload: unknown): Campaign[] {
  if (Array.isArray(payload)) {
    return payload
      .map(normalizeCampaign)
      .filter((campaign): campaign is Campaign => campaign !== null);
  }
  if (
    payload &&
    typeof payload === "object" &&
    "campaigns" in payload &&
    Array.isArray((payload as { campaigns: unknown }).campaigns)
  ) {
    return (payload as { campaigns: unknown[] }).campaigns
      .map(normalizeCampaign)
      .filter((campaign): campaign is Campaign => campaign !== null);
  }
  return [];
}

export async function listCampaigns(
  options: ServerFetchOptions = {},
): Promise<Campaign[]> {
  const origin = appOrigin();
  if (!origin) return demoCampaigns;

  try {
    const query = options.mine ? "?mine=true" : "";
    const response = await fetch(`${origin}/api/v2/campaigns${query}`, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...demoIdentityHeaders(),
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
    });
    if (!response.ok) return demoCampaigns;
    const campaigns = normalizeCampaigns(await response.json());
    return campaigns.length ? campaigns : demoCampaigns;
  } catch {
    return demoCampaigns;
  }
}

export async function getCampaign(
  slug: string,
  options: ServerFetchOptions = {},
): Promise<Campaign | null> {
  const origin = appOrigin();
  if (!origin) return getDemoCampaign(slug);

  try {
    const response = await fetch(
      `${origin}/api/v2/campaigns/${encodeURIComponent(slug)}`,
      {
        cache: "no-store",
        headers: {
          accept: "application/json",
          ...demoIdentityHeaders(),
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
      },
    );
    if (!response.ok) return getDemoCampaign(slug);
    const payload = (await response.json()) as
      | Record<string, unknown>
      | { campaign: unknown };
    const normalized = normalizeCampaign(
      "campaign" in payload ? payload.campaign : payload,
    );
    if (!normalized) return getDemoCampaign(slug);
    if (normalized.isDemo) return normalized;
    try {
      const evidenceResponse = await fetch(
        `${origin}/api/v2/campaigns/${encodeURIComponent(
          normalized.id,
        )}/evidence`,
        {
          cache: "no-store",
          headers: {
            accept: "application/json",
            ...demoIdentityHeaders(),
            ...(options.cookie ? { cookie: options.cookie } : {}),
          },
        },
      );
      if (!evidenceResponse.ok) return normalized;
      return verifiedCampaign(normalized, await evidenceResponse.json());
    } catch {
      return normalized;
    }
  } catch {
    return getDemoCampaign(slug);
  }
}

export async function createCampaign(
  draft: CampaignDraft,
): Promise<{ campaign: Campaign; demo: boolean }> {
  const response = await fetch("/api/v2/campaigns", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...demoIdentityHeaders(),
    },
    body: JSON.stringify(draft),
  });

  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Sign in as a creator before saving this campaign."
        : "The campaign service is unavailable. Your work is still in this tab.",
    );
  }

  const payload = (await response.json()) as Campaign | { campaign: unknown };
  const campaign = normalizeCampaign(
    "campaign" in payload ? payload.campaign : payload,
  );
  if (!campaign) {
    throw new Error("The campaign service returned an incomplete draft.");
  }
  return {
    campaign,
    demo: false,
  };
}

export async function requestFundingQuote(input: {
  campaignId: string;
  rail: "direct" | "intents";
  originAssetId: string;
  refundTo: string;
}): Promise<CampaignFundingQuoteResult> {
  const response = await fetch(
    `/api/v2/campaigns/${encodeURIComponent(
      input.campaignId,
    )}/funding-quotes`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...demoIdentityHeaders(),
      },
      body: JSON.stringify({
        rail: input.rail,
        originAssetId: input.originAssetId,
        refundTo: input.refundTo,
        idempotencyKey: crypto.randomUUID(),
      }),
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | {
        fundingOrder?: CampaignFundingOrder;
        authorizationRequired?: unknown;
        error?: { message?: string };
      }
    | null;
  if (!response.ok || !payload?.fundingOrder) {
    throw new Error(
      payload?.error?.message ??
        "A live funding quote is not available. No funds were moved.",
    );
  }
  return {
    fundingOrder: payload.fundingOrder,
    authorizationRequired: payload.authorizationRequired === true,
  };
}

export async function getCampaignLifecycleStatus(
  campaignId: string,
): Promise<CampaignLifecycleStatus> {
  const response = await fetch(
    `/api/v2/campaigns/${encodeURIComponent(campaignId)}/status`,
    {
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...demoIdentityHeaders(),
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | (Partial<CampaignLifecycleStatus> & {
        error?: { message?: string };
      })
    | null;
  if (
    !response.ok ||
    !payload?.campaign ||
    typeof payload.campaign.id !== "string" ||
    typeof payload.campaign.status !== "string" ||
    typeof payload.campaign.version !== "number"
  ) {
    throw new Error(
      payload?.error?.message ??
        "The creator funding status is temporarily unavailable.",
    );
  }
  return {
    campaign: payload.campaign as CampaignLifecycleStatus["campaign"],
    fundingOrder: payload.fundingOrder ?? null,
    onChain: payload.onChain ?? null,
    chainUnavailable: payload.chainUnavailable === true,
    authorizationRequired: payload.authorizationRequired === true,
    quoteExpired: payload.quoteExpired === true,
  };
}

export async function refreshFundingOrder(
  fundingOrderId: string,
): Promise<{
  fundingOrder: CampaignFundingOrder;
  authorizationRequired: boolean;
  quoteExpired: boolean;
}> {
  const response = await fetch(
    `/api/v2/funding-orders/${encodeURIComponent(
      fundingOrderId,
    )}?refresh=true`,
    {
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...demoIdentityHeaders(),
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | {
        fundingOrder?: CampaignFundingOrder;
        authorizationRequired?: unknown;
        quoteExpired?: unknown;
        error?: { message?: string };
      }
    | null;
  if (!response.ok || !payload?.fundingOrder) {
    throw new Error(
      payload?.error?.message ??
        "The funding receipt could not be refreshed.",
    );
  }
  return {
    fundingOrder: payload.fundingOrder,
    authorizationRequired: payload.authorizationRequired === true,
    quoteExpired: payload.quoteExpired === true,
  };
}

function authorizedDeposit(value: unknown): AuthorizedFundingDeposit | null {
  if (!value || typeof value !== "object") return null;
  const deposit = value as Record<string, unknown>;
  const deadline =
    typeof deposit.deadline === "string" ? deposit.deadline : "";
  if (
    typeof deposit.depositAddress !== "string" ||
    !deposit.depositAddress ||
    typeof deposit.originAssetId !== "string" ||
    !deposit.originAssetId ||
    typeof deposit.inputAmountAtomic !== "string" ||
    !/^[1-9]\d*$/.test(deposit.inputAmountAtomic) ||
    !Number.isFinite(new Date(deadline).getTime()) ||
    new Date(deadline).getTime() <= Date.now() ||
    !(
      deposit.depositMemo === null ||
      typeof deposit.depositMemo === "string"
    ) ||
    !(
      deposit.providerQuoteId === null ||
      typeof deposit.providerQuoteId === "string"
    )
  ) {
    return null;
  }
  return {
    depositAddress: deposit.depositAddress,
    depositMemo: deposit.depositMemo,
    originAssetId: deposit.originAssetId,
    inputAmountAtomic: deposit.inputAmountAtomic,
    deadline,
    providerQuoteId: deposit.providerQuoteId,
  };
}

export async function confirmFundingAuthorization(
  fundingOrderId: string,
): Promise<FundingAuthorizationConfirmation> {
  const response = await fetch(
    `/api/v2/funding-orders/${encodeURIComponent(
      fundingOrderId,
    )}/authorization`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        ...demoIdentityHeaders(),
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | {
        fundingOrder?: Record<string, unknown>;
        authorization?: Record<string, unknown>;
        deposit?: unknown;
        error?: { message?: string };
      }
    | null;
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ??
        "The creator authorization is not finalized yet. Retry verification in a moment.",
    );
  }

  const fundingOrder = payload?.fundingOrder;
  const authorization = payload?.authorization;
  const deposit = authorizedDeposit(payload?.deposit);
  if (
    !fundingOrder ||
    typeof fundingOrder.id !== "string" ||
    fundingOrder.id !== fundingOrderId ||
    typeof fundingOrder.campaignId !== "string" ||
    typeof fundingOrder.status !== "string" ||
    typeof fundingOrder.version !== "number" ||
    !authorization ||
    typeof authorization.contractId !== "string" ||
    typeof authorization.campaignId !== "string" ||
    authorization.campaignId !== fundingOrder.campaignId ||
    typeof authorization.fundingReference !== "string" ||
    typeof authorization.fundingDeadlineMs !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/.test(authorization.fundingDeadlineMs) ||
    typeof authorization.verifiedAt !== "string" ||
    !Number.isFinite(new Date(authorization.verifiedAt).getTime()) ||
    !deposit
  ) {
    throw new Error(
      "The authorization service returned incomplete deposit evidence. No deposit instructions were revealed.",
    );
  }

  return {
    fundingOrder: {
      id: fundingOrder.id,
      campaignId: fundingOrder.campaignId,
      status: fundingOrder.status,
      version: fundingOrder.version,
    },
    authorization: {
      contractId: authorization.contractId,
      campaignId: authorization.campaignId,
      fundingReference: authorization.fundingReference,
      fundingDeadlineMs: authorization.fundingDeadlineMs,
      verifiedAt: authorization.verifiedAt,
    },
    deposit,
  };
}

export async function recordDirectFundingTransaction(
  fundingOrderId: string,
  txHash: string,
): Promise<CampaignFundingOrder> {
  const response = await fetch(
    `/api/v2/funding-orders/${encodeURIComponent(
      fundingOrderId,
    )}/deposit-receipt`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...demoIdentityHeaders(),
      },
      body: JSON.stringify({ txHash }),
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | {
        fundingOrder?: CampaignFundingOrder;
        error?: { message?: string };
      }
    | null;
  if (!response.ok || !payload?.fundingOrder) {
    throw new Error(
      payload?.error?.message ??
        "The final direct funding receipt is not available yet.",
    );
  }
  return payload.fundingOrder;
}

export async function getClaimStatus(claimId: string): Promise<CampaignClaim> {
  const response = await fetch(
    `/api/v2/claims/${encodeURIComponent(claimId)}`,
    {
      headers: { accept: "application/json" },
      cache: "no-store",
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | { claim?: CampaignClaim; error?: { message?: string } }
    | null;
  if (!response.ok || !payload?.claim) {
    throw new Error(
      payload?.error?.message ?? "The payout receipt is not available yet.",
    );
  }
  return payload.claim;
}

// Kept only in this tab. If a paid response is lost, a second click reuses the
// same payment identifier so the server can replay its durable result.
const pendingAiPayments = new Map<string, string>();

export async function requestAiDraft(input: {
  topic: string;
  tone: string;
  count: number;
}): Promise<{
  entries: Array<{ clue: string; answer: string }>;
  receiptHandle: AiGenerationReceiptHandle;
  cached: boolean;
}> {
  const body = JSON.stringify(input);
  const paymentIdentifier =
    pendingAiPayments.get(body) ??
    `ai_${crypto.randomUUID().replace(/-/g, "")}`;
  pendingAiPayments.set(body, paymentIdentifier);
  let response: Response;
  try {
    response = await executeX402PaidRequest({
      url: "/api/v2/ai/generate",
      body,
      paymentIdentifier,
      payer: getX402BrowserPayer(),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("no compatible browser payer") ||
        error.message.includes("non-settling x402 preview"))
    ) {
      pendingAiPayments.delete(body);
    }
    throw error;
  }

  if (response.status === 402) {
    throw new Error(
      "The connected payer did not satisfy this x402 payment request. No AI draft was returned.",
    );
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(
      payload?.error?.message ??
        "AI drafting is unavailable. You can keep building manually.",
    );
  }

  const payload = (await response.json()) as {
    entries?: Array<{ clue: string; answer: string }>;
    clues?: Array<{ clue: string; answer: string }>;
    payment?: {
      rail?: unknown;
      paymentIdentifier?: unknown;
    };
    receiptHandle?: {
      version?: unknown;
      paymentIdentifier?: unknown;
    };
    cached?: unknown;
  };
  const candidate =
    payload.receiptHandle ??
    (payload.payment?.rail === "x402"
      ? {
          version: "x402-ai-generation-receipt:v1",
          paymentIdentifier: payload.payment.paymentIdentifier,
        }
      : null);
  if (
    candidate?.version !== "x402-ai-generation-receipt:v1" ||
    candidate.paymentIdentifier !== paymentIdentifier
  ) {
    // Keep the payment identifier in memory: a retry can recover the durable
    // paid result without creating a second settlement.
    throw new Error(
      "The paid AI result did not include a verifiable receipt handle. Retry safely with the same payment.",
    );
  }
  pendingAiPayments.delete(body);
  return {
    entries: payload.entries ?? payload.clues ?? [],
    receiptHandle: {
      version: "x402-ai-generation-receipt:v1",
      paymentIdentifier: candidate.paymentIdentifier,
    },
    cached: payload.cached === true,
  };
}

export async function getTokenCatalog(): Promise<{
  escrowAsset: EscrowAsset;
  tokens: SupportedToken[];
}> {
  const response = await fetch("/api/v2/tokens", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("Prize funding is not configured on this deployment.");
  }
  const payload = (await response.json()) as {
    escrowAsset?: EscrowAsset;
    tokens?: Array<
      SupportedToken & {
        blockchain?: string;
      }
    >;
  };
  if (
    !payload.escrowAsset?.assetId ||
    !payload.escrowAsset.contractId ||
    payload.escrowAsset.symbol !== "USDC" ||
    payload.escrowAsset.decimals !== 6
  ) {
    throw new Error("The USDC escrow configuration is incomplete.");
  }
  return {
    escrowAsset: payload.escrowAsset,
    tokens: Array.isArray(payload.tokens)
      ? payload.tokens.map((token) => ({
          assetId: token.assetId,
          symbol: token.symbol,
          decimals: token.decimals,
          network: token.network ?? token.blockchain ?? "supported network",
          label:
            token.label ??
            `${token.symbol} on ${
              token.network ?? token.blockchain ?? "supported network"
            }`,
        }))
      : [],
  };
}
