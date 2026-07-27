"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { getClaimStatus, getTokenCatalog } from "../lib/api";
import { getPuzzleCells } from "../lib/puzzle";
import type { Campaign, SupportedToken } from "../lib/types";
import {
  payoutAssetLabel,
  payoutAssetsFromCatalog,
} from "../../src/lib/v2/payout-catalog";
import { signClaimPermit } from "../../src/lib/v2/solution";
import { Countdown } from "./Countdown";
import { StatusBadge } from "./StatusBadge";

type PayoutMode = "near" | "cross_chain";

interface QuoteResult {
  id: string;
  payoutDigest: string;
  nonce: string;
  deadline: string;
  deadlineMs: string;
  receiverId: string;
  estimatedDeliveryAmount: string;
  destinationLabel: string;
}

interface ExpectedDelivery {
  assetId: string;
  symbol: string;
  decimals: number;
}

const U64_MAX = 18_446_744_073_709_551_615n;
const UNSIGNED = /^(?:0|[1-9][0-9]*)$/;

function canonicalBase64Bytes(value: string, expectedBytes: number): boolean {
  try {
    const decoded = atob(value);
    if (decoded.length !== expectedBytes) return false;
    let binary = "";
    for (let index = 0; index < decoded.length; index += 1) {
      binary += String.fromCharCode(decoded.charCodeAt(index));
    }
    return btoa(binary) === value;
  } catch {
    return false;
  }
}

function atomicDisplay(
  amountAtomic: string,
  decimals: number,
  symbol: string,
): string {
  if (!UNSIGNED.test(amountAtomic) || decimals < 0 || decimals > 30) {
    return `${amountAtomic} atomic ${symbol}`;
  }
  const padded = amountAtomic.padStart(decimals + 1, "0");
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fractional =
    decimals === 0
      ? ""
      : padded.slice(-decimals).replace(/0+$/, "").slice(0, 8);
  return `${whole}${fractional ? `.${fractional}` : ""} ${symbol}`;
}

function normalizeQuote(
  payload: unknown,
  campaign: Campaign,
  destinationLabel: string,
  expectedDelivery: ExpectedDelivery,
): QuoteResult | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as {
    claim?: Record<string, unknown>;
    id?: unknown;
    payoutDigest?: unknown;
    nonce?: unknown;
    deadline?: unknown;
    deadlineMs?: unknown;
    payoutAmount?: unknown;
    estimatedDeliveryAmount?: unknown;
    estimatedDeliveryAsset?: unknown;
    receiverId?: unknown;
    depositAddress?: unknown;
  };
  const value = (envelope.claim ?? envelope) as Record<string, unknown>;
  const id = String(value.id ?? "");
  const payoutDigest = String(
    value.payoutDigest ?? value.payout_digest ?? value.quoteDigest ?? "",
  );
  const nonce = String(value.nonce ?? "");
  const deadlineMs = String(value.deadlineMs ?? "");
  const receiverId = String(
    value.receiverId ?? value.depositAddress ?? value.recipient ?? "",
  );
  const estimatedDeliveryAmount = String(
    value.estimatedDeliveryAmount ?? value.payoutAmount ?? "",
  );
  const estimatedDeliveryAsset = String(
    value.estimatedDeliveryAsset ?? "",
  );
  if (
    !id ||
    !canonicalBase64Bytes(payoutDigest, 32) ||
    !UNSIGNED.test(nonce) ||
    BigInt(nonce) > U64_MAX ||
    !UNSIGNED.test(deadlineMs) ||
    BigInt(deadlineMs) > U64_MAX ||
    !Number.isSafeInteger(Number(deadlineMs)) ||
    Number(deadlineMs) <= Date.now() ||
    !Number.isSafeInteger(new Date(campaign.expiresAt).getTime()) ||
    Number(deadlineMs) > new Date(campaign.expiresAt).getTime() ||
    !receiverId ||
    !UNSIGNED.test(estimatedDeliveryAmount) ||
    estimatedDeliveryAsset !== expectedDelivery.assetId
  ) {
    return null;
  }
  const deadline = new Date(Number(deadlineMs)).toISOString();

  return {
    id,
    payoutDigest,
    nonce,
    deadline,
    deadlineMs,
    receiverId,
    estimatedDeliveryAmount: atomicDisplay(
      estimatedDeliveryAmount,
      expectedDelivery.decimals,
      expectedDelivery.symbol,
    ),
    destinationLabel,
  };
}

export function PuzzlePlayer({ campaign }: { campaign: Campaign }) {
  const router = useRouter();
  const cells = useMemo(() => getPuzzleCells(campaign.puzzle), [campaign.puzzle]);
  const orderedCells = useMemo(
    () =>
      [...cells.values()].sort((left, right) =>
        left.row === right.row
          ? left.column - right.column
          : left.row - right.row,
      ),
    [cells],
  );
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [stage, setStage] = useState<"solve" | "payout" | "quote" | "submitted">(
    "solve",
  );
  const [payoutMode, setPayoutMode] = useState<PayoutMode>("near");
  const [nearAccount, setNearAccount] = useState("");
  const [destination, setDestination] = useState("");
  const [escrowAssetId, setEscrowAssetId] = useState("");
  const [payoutAssets, setPayoutAssets] = useState<SupportedToken[]>([]);
  const [catalogStatus, setCatalogStatus] = useState(
    "Checking live payout routes…",
  );
  const [recipient, setRecipient] = useState("");
  const [recoveryAccount, setRecoveryAccount] = useState("");
  const [status, setStatus] = useState("");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const storageKey = `crossword:progress:${campaign.id}`;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, string>;
        setGuesses(parsed);
      }
    } catch {
      window.localStorage.removeItem(storageKey);
    } finally {
      setReady(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(storageKey, JSON.stringify(guesses));
  }, [guesses, ready, storageKey]);

  useEffect(() => {
    let active = true;
    getTokenCatalog()
      .then((catalog) => {
        if (!active) return;
        const assets = payoutAssetsFromCatalog(
          catalog.tokens,
          catalog.escrowAsset.assetId,
        );
        setEscrowAssetId(catalog.escrowAsset.assetId);
        setPayoutAssets(assets);
        setDestination((current) =>
          assets.some((asset) => asset.assetId === current)
            ? current
            : (assets[0]?.assetId ?? ""),
        );
        setCatalogStatus(
          assets.length
            ? ""
            : "No cross-chain payout routes are currently listed by 1Click.",
        );
      })
      .catch((error) => {
        if (!active) return;
        setPayoutAssets([]);
        setDestination("");
        setCatalogStatus(
          error instanceof Error
            ? error.message
            : "The live 1Click payout catalog is unavailable.",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!claimId || stage !== "submitted" || campaign.isDemo) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      try {
        const claim = await getClaimStatus(claimId);
        if (!active) return;
        if (claim.status === "PAID") {
          setStatus(
            "Payout settled at the chosen destination. The downstream receipt is recorded.",
          );
          return;
        }
        if (claim.status === "RECOVERED") {
          setStatus(
            "The cross-chain route did not complete, so 1Click returned the prize to your winner-controlled NEAR recovery account.",
          );
          return;
        }
        if (claim.status === "FAILED") {
          setStatus(
            "The route needs recovery review. The prize is not reported as delivered; use the recorded recovery account and receipts.",
          );
          return;
        }
        if (claim.status === "EXPIRED") {
          setStatus("The payout quote expired before the claim could settle.");
          return;
        }
        setStatus(
          claim.status === "PAYING"
            ? "The prize left escrow and is still routing. It is not marked delivered until 1Click reports a terminal result."
            : "The claim is queued for on-chain submission.",
        );
        timer = setTimeout(refresh, 4_000);
      } catch {
        if (!active) return;
        setStatus(
          "The claim was submitted, but the receipt tracker is temporarily unavailable.",
        );
        timer = setTimeout(refresh, 8_000);
      }
    };

    void refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [campaign.isDemo, claimId, stage]);

  const completedCells = orderedCells.filter(
    (cell) => guesses[`${cell.row}:${cell.column}`],
  ).length;
  const completion = orderedCells.length
    ? Math.round((completedCells / orderedCells.length) * 100)
    : 0;
  const puzzleIsFilled =
    orderedCells.length > 0 && completedCells === orderedCells.length;

  const updateGuess = (key: string, rawValue: string, index: number) => {
    const value = rawValue.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-1);
    setGuesses((current) => ({ ...current, [key]: value }));
    if (value) {
      const next = orderedCells[index + 1];
      if (next) inputRefs.current[`${next.row}:${next.column}`]?.focus();
    }
  };

  const handleKey = (
    event: React.KeyboardEvent<HTMLInputElement>,
    key: string,
    index: number,
  ) => {
    if (event.key === "Backspace" && !guesses[key] && index > 0) {
      const previous = orderedCells[index - 1];
      inputRefs.current[`${previous.row}:${previous.column}`]?.focus();
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = orderedCells[Math.min(orderedCells.length - 1, index + 1)];
      inputRefs.current[`${next.row}:${next.column}`]?.focus();
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const previous = orderedCells[Math.max(0, index - 1)];
      inputRefs.current[`${previous.row}:${previous.column}`]?.focus();
    }
  };

  const preparePayout = () => {
    if (!puzzleIsFilled) {
      setStatus("Complete every open square before preparing a claim.");
      return;
    }
    setStatus("");
    setStage("payout");
    window.scrollTo({ top: 300, behavior: "smooth" });
  };

  const requestQuote = async () => {
    const direct = payoutMode === "near";
    if (direct && !nearAccount.trim()) {
      setStatus("Enter the NEAR account that should receive USDC.");
      return;
    }
    if (
      !direct &&
      (!destination || !recipient.trim() || !recoveryAccount.trim())
    ) {
      setStatus(
        "Choose a live payout asset, then enter its destination address and a NEAR recovery account.",
      );
      return;
    }

    const selectedAsset = payoutAssets.find(
      (asset) => asset.assetId === destination,
    );
    if (direct && !escrowAssetId) {
      setStatus(
        "The pinned NEAR USDC escrow asset could not be verified. Refresh before requesting a payout.",
      );
      return;
    }
    if (!direct && !selectedAsset) {
      setStatus(
        "That payout route is no longer in the live 1Click catalog. Refresh and choose another route.",
      );
      return;
    }
    const destinationAsset = direct
      ? escrowAssetId || "direct-near-usdc"
      : selectedAsset!.assetId;
    const destinationLabel = direct
      ? `${nearAccount.trim()} on NEAR`
      : payoutAssetLabel(selectedAsset!);
    setStatus("Requesting a short-lived payout quote…");

    if (campaign.isDemo) {
      setQuote({
        id: "demo-claim-quote",
        payoutDigest: "demo-payout-digest",
        nonce: "0",
        deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
        deadlineMs: String(Date.now() + 10 * 60_000),
        receiverId: direct ? nearAccount.trim() : recipient.trim(),
        estimatedDeliveryAmount:
          campaign.reward.type === "token"
            ? `${campaign.reward.amount} ${campaign.reward.symbol}`
            : campaign.reward.title,
        destinationLabel,
      });
      setStatus(
        "Demo quote prepared. No prize or transaction exists for this preview.",
      );
      setStage("quote");
      return;
    }

    try {
      const response = await fetch(
        `/api/v2/campaigns/${encodeURIComponent(
          campaign.id,
        )}/claim-quotes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            payout: {
              kind: direct ? "direct_near" : "one_click",
              destinationAsset,
              recipient: direct ? nearAccount.trim() : recipient.trim(),
              recoveryAccount: direct
                ? nearAccount.trim()
                : recoveryAccount.trim(),
            },
            idempotencyKey: crypto.randomUUID(),
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        const message =
          payload?.error?.message ?? "A payout quote is not available right now.";
        throw new Error(message);
      }
      const normalized = normalizeQuote(
        payload,
        campaign,
        destinationLabel,
        direct
          ? {
              assetId: escrowAssetId,
              symbol: "USDC",
              decimals: 6,
            }
          : selectedAsset!,
      );
      if (!normalized) throw new Error("The payout quote was incomplete.");
      setQuote(normalized);
      setStatus("Quote ready. The final claim proof is created only in this tab.");
      setStage("quote");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "A payout quote is not available right now.",
      );
    }
  };

  const submitClaim = async () => {
    if (!quote || campaign.isDemo) {
      setStatus(
        "This is an illustrative campaign, so no proof was signed or submitted.",
      );
      setStage("submitted");
      return;
    }
    setStatus("Creating a claim-bound proof in your browser…");
    try {
      const solutionEntries = campaign.puzzle.entries.map((entry) => {
        let answer = "";
        for (let index = 0; index < entry.length; index += 1) {
          const row = entry.row + (entry.direction === "down" ? index : 0);
          const column =
            entry.column + (entry.direction === "across" ? index : 0);
          answer += guesses[`${row}:${column}`] ?? "";
        }
        return {
          number: entry.number,
          direction: entry.direction,
          answer,
        };
      });
      const signed = await signClaimPermit(campaign.id, solutionEntries, {
        contractId: campaign.contractId,
        campaignId: campaign.id,
        receiverId: quote.receiverId,
        payoutDigest: quote.payoutDigest,
        nonce: quote.nonce,
        deadlineMs: quote.deadlineMs,
      });
      const proof = {
        signature: signed.signature,
        nonce: quote.nonce,
        deadlineMs: quote.deadlineMs,
        payoutDigest: quote.payoutDigest,
      };
      const response = await fetch(
        `/api/v2/campaigns/${encodeURIComponent(campaign.id)}/claims`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ claimId: quote.id, proof }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ??
            "The proof did not match this puzzle, or another solver won first.",
        );
      }
      const submittedClaimId =
        payload?.claim && typeof payload.claim.id === "string"
          ? payload.claim.id
          : quote.id;
      setClaimId(submittedClaimId);
      router.replace(
        `/campaigns/${encodeURIComponent(
          campaign.slug,
        )}/play?claim=${encodeURIComponent(submittedClaimId)}`,
        { scroll: false },
      );
      window.localStorage.removeItem(storageKey);
      setStatus(
        "Claim submitted. The receipt tracker will follow it through final settlement.",
      );
      setStage("submitted");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "The claim could not be prepared in this browser.",
      );
    }
  };

  return (
    <div className="play-workspace">
      <section className="play-board" aria-labelledby="puzzle-title">
        <header className="play-board__header">
          <div>
            <StatusBadge state={campaign.state} compact />
            <p className="eyebrow">Presented by {campaign.sponsorName}</p>
            <h1 id="puzzle-title">{campaign.title}</h1>
          </div>
          <div className="play-board__prize">
            <span>First correct solve wins</span>
            <strong>
              {campaign.reward.type === "token"
                ? `${campaign.reward.amount} ${campaign.reward.symbol}`
                : campaign.reward.title}
            </strong>
            <Countdown target={campaign.expiresAt} />
          </div>
        </header>

        <div className="progress-bar" aria-label={`${completion}% complete`}>
          <span style={{ width: `${completion}%` }} />
        </div>
        <div className="play-board__progress-copy">
          <span>{completion}% complete</span>
          <span>Saved in this browser for this campaign only</span>
        </div>

        <div className="interactive-puzzle">
          <div
            className="interactive-grid"
            role="group"
            aria-label={`${campaign.title} crossword grid`}
            style={{
              gridTemplateColumns: `repeat(${campaign.puzzle.columns}, minmax(1.65rem, 2.75rem))`,
              gridTemplateRows: `repeat(${campaign.puzzle.rows}, minmax(1.65rem, 2.75rem))`,
            }}
          >
            {Array.from({
              length: campaign.puzzle.rows * campaign.puzzle.columns,
            }).map((_, gridIndex) => {
              const row = Math.floor(gridIndex / campaign.puzzle.columns);
              const column = gridIndex % campaign.puzzle.columns;
              const key = `${row}:${column}`;
              const cell = cells.get(key);
              if (!cell) {
                return <span className="interactive-grid__void" key={key} />;
              }
              const orderedIndex = orderedCells.findIndex(
                (value) => value.row === row && value.column === column,
              );
              return (
                <label className="interactive-grid__cell" key={key}>
                  {cell.number ? <small>{cell.number}</small> : null}
                  <span className="sr-only">
                    Row {row + 1}, column {column + 1}
                  </span>
                  <input
                    ref={(element) => {
                      inputRefs.current[key] = element;
                    }}
                    value={guesses[key] ?? ""}
                    onChange={(event) =>
                      updateGuess(key, event.target.value, orderedIndex)
                    }
                    onKeyDown={(event) =>
                      handleKey(event, key, orderedIndex)
                    }
                    maxLength={1}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="text"
                  />
                </label>
              );
            })}
          </div>

          <div className="clue-lists">
            {(["across", "down"] as const).map((direction) => (
              <section key={direction}>
                <h2>{direction}</h2>
                <ol>
                  {campaign.puzzle.entries
                    .filter((entry) => entry.direction === direction)
                    .sort((left, right) => left.number - right.number)
                    .map((entry) => (
                      <li key={`${direction}-${entry.number}`}>
                        <strong>{entry.number}</strong>
                        <span>{entry.clue}</span>
                      </li>
                    ))}
                </ol>
              </section>
            ))}
          </div>
        </div>

        {stage === "solve" ? (
          <div className="solve-actions">
            <p>
              Filling the grid never sends your letters anywhere. When complete,
              your browser derives a one-time solution proof.
            </p>
            <button
              className="button button--blue"
              type="button"
              disabled={!puzzleIsFilled}
              onClick={preparePayout}
            >
              Prepare prize claim
            </button>
          </div>
        ) : null}
      </section>

      {stage !== "solve" ? (
        <aside className="payout-drawer" aria-labelledby="payout-title">
          <button
            type="button"
            className="payout-drawer__back"
            onClick={() => {
              setStage("solve");
              setQuote(null);
              setStatus("");
            }}
          >
            ← Back to puzzle
          </button>
          <p className="eyebrow">Winner payout</p>
          <h2 id="payout-title">
            {stage === "submitted"
              ? "Track the result"
              : "Where should the prize land?"}
          </h2>

          {stage === "payout" ? (
            <>
              <fieldset className="payout-options">
                <legend className="sr-only">Payout route</legend>
                <label className={payoutMode === "near" ? "is-selected" : ""}>
                  <input
                    type="radio"
                    name="payout"
                    checked={payoutMode === "near"}
                    onChange={() => setPayoutMode("near")}
                  />
                  <span>
                    <strong>USDC on NEAR</strong>
                    <small>Direct, fastest, no swap</small>
                  </span>
                </label>
                <label
                  className={payoutMode === "cross_chain" ? "is-selected" : ""}
                >
                  <input
                    type="radio"
                    name="payout"
                    checked={payoutMode === "cross_chain"}
                    onChange={() => setPayoutMode("cross_chain")}
                  />
                  <span>
                    <strong>Another asset or chain</strong>
                    <small>Routed through NEAR Intents</small>
                  </span>
                </label>
              </fieldset>

              {payoutMode === "near" ? (
                <label className="field">
                  <span>NEAR account</span>
                  <input
                    value={nearAccount}
                    onChange={(event) => setNearAccount(event.target.value)}
                    placeholder="winner.near"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </label>
              ) : (
                <>
                  <label className="field">
                    <span>Receive</span>
                    <select
                      value={destination}
                      onChange={(event) => setDestination(event.target.value)}
                      disabled={!payoutAssets.length}
                    >
                      {!payoutAssets.length ? (
                        <option value="">No live route available</option>
                      ) : null}
                      {payoutAssets.map((asset) => (
                        <option key={asset.assetId} value={asset.assetId}>
                          {payoutAssetLabel(asset)}
                        </option>
                      ))}
                    </select>
                    <small>
                      {catalogStatus ||
                        "Available assets come directly from the live 1Click catalog."}
                    </small>
                  </label>
                  <label className="field">
                    <span>Destination address</span>
                    <input
                      value={recipient}
                      onChange={(event) => setRecipient(event.target.value)}
                      placeholder="Paste the receiving address"
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                  </label>
                  <label className="field">
                    <span>NEAR recovery account</span>
                    <input
                      value={recoveryAccount}
                      onChange={(event) => setRecoveryAccount(event.target.value)}
                      placeholder="recovery.near"
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                    <small>
                      If the route expires, 1Click returns funds here—not to the
                      campaign service.
                    </small>
                  </label>
                </>
              )}
              <button
                className="button button--blue button--wide"
                type="button"
                onClick={requestQuote}
                disabled={
                  payoutMode === "cross_chain" && !payoutAssets.length
                }
              >
                Review payout quote
              </button>
            </>
          ) : null}

          {stage === "quote" && quote ? (
            <>
              <div className="quote-card">
                <p>Short-lived payout quote</p>
                <dl>
                  <div>
                    <dt>Prize in escrow</dt>
                    <dd>
                      {campaign.reward.type === "token"
                        ? `${campaign.reward.amount} ${campaign.reward.symbol}`
                        : campaign.reward.title}
                    </dd>
                  </div>
                  <div>
                    <dt>Destination</dt>
                    <dd>{quote.destinationLabel}</dd>
                  </div>
                  <div>
                    <dt>Estimated delivery</dt>
                    <dd>{quote.estimatedDeliveryAmount}</dd>
                  </div>
                  <div>
                    <dt>Quote expires</dt>
                    <dd>{new Date(quote.deadline).toLocaleTimeString()}</dd>
                  </div>
                </dl>
              </div>
              <div className="privacy-note">
                <strong>Your answers do not leave this browser.</strong>
                The submitted proof binds this campaign, payout, nonce, and
                deadline so it cannot be redirected or replayed.
              </div>
              <button
                className="button button--blue button--wide"
                type="button"
                onClick={submitClaim}
              >
                Sign proof & claim
              </button>
            </>
          ) : null}

          {stage === "submitted" ? (
            <div className="claim-result">
              <span aria-hidden="true">✓</span>
              <h3>
                {campaign.isDemo ? "Preview complete" : "Claim submitted"}
              </h3>
              <p>{status}</p>
              <Link className="text-link" href={`/campaigns/${campaign.slug}`}>
                Return to campaign evidence →
              </Link>
            </div>
          ) : status ? (
            <p className="form-message" role="status">
              {status}
            </p>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
