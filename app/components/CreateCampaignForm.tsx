"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  createCampaign,
  getTokenCatalog,
  requestAiDraft,
  requestFundingQuote,
} from "../lib/api";
import { connectFastNearX402Payer } from "../lib/fastnear-x402-payer";
import { layoutDraft, type DraftEntry } from "../lib/puzzle";
import { getX402BrowserPayer } from "../lib/x402-browser";
import type {
  AuthorizedFundingDeposit,
  AiGenerationReceiptHandle,
  CampaignDraft,
  CampaignFundingOrder,
  EscrowAsset,
  SupportedToken,
} from "../lib/types";
import { deriveSolutionPublicKey } from "../../src/lib/v2/solution";
import { DirectFundingAction } from "./DirectFundingAction";
import { ExternalFundingAuthorizationAction } from "./ExternalFundingAuthorizationAction";
import { PuzzleDiagram } from "./PuzzleDiagram";

const starterEntries: DraftEntry[] = [
  {
    clue: "The HTTP status code that asks for payment",
    answer: "402",
  },
  {
    clue: "A route chosen for the result, not the rails",
    answer: "INTENT",
  },
  {
    clue: "Evidence that a transfer really settled",
    answer: "RECEIPT",
  },
  {
    clue: "A reward set aside before play begins",
    answer: "PRIZE",
  },
];

const steps = [
  { id: 1, label: "Puzzle" },
  { id: 2, label: "Story" },
  { id: 3, label: "Prize" },
  { id: 4, label: "Review" },
];

const allowedAnswer = /^[A-Za-z0-9-]*$/;

export function CreateCampaignForm() {
  const [step, setStep] = useState(1);
  const [entries, setEntries] = useState<DraftEntry[]>(starterEntries);
  const [title, setTitle] = useState("The Open Payments Puzzle");
  const [description, setDescription] = useState(
    "A quick crossword about the protocols that let value move as freely as information.",
  );
  const [sponsorName, setSponsorName] = useState("Your community");
  const [visibility, setVisibility] =
    useState<CampaignDraft["visibility"]>("public");
  const [durationHours, setDurationHours] = useState(168);
  const [rewardAmount, setRewardAmount] = useState("25");
  const [fundingRail, setFundingRail] =
    useState<CampaignDraft["fundingPreference"]["rail"]>("intents");
  const [originAsset, setOriginAsset] = useState("USDC on Base");
  const [recoveryAccount, setRecoveryAccount] = useState("");
  const [originRefundAddress, setOriginRefundAddress] = useState("");
  const [aiTopic, setAiTopic] = useState("open payments");
  const [aiTone, setAiTone] = useState("clever");
  const [aiStatus, setAiStatus] = useState("");
  const [aiPayerReady, setAiPayerReady] = useState(false);
  const [aiPayerConnecting, setAiPayerConnecting] = useState(false);
  const [aiPayerLabel, setAiPayerLabel] = useState("");
  const [aiReceiptHandle, setAiReceiptHandle] =
    useState<AiGenerationReceiptHandle | null>(null);
  const [submitStatus, setSubmitStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [fundingOrder, setFundingOrder] =
    useState<CampaignFundingOrder | null>(null);
  const [fundingAuthorizationRequired, setFundingAuthorizationRequired] =
    useState(false);
  const [authorizedDeposit, setAuthorizedDeposit] =
    useState<AuthorizedFundingDeposit | null>(null);
  const [escrowAsset, setEscrowAsset] = useState<EscrowAsset | null>(null);
  const [supportedTokens, setSupportedTokens] = useState<SupportedToken[]>([]);
  const [fundingStatus, setFundingStatus] = useState(
    "Checking supported funding routes…",
  );

  useEffect(() => {
    let active = true;
    getTokenCatalog()
      .then((catalog) => {
        if (!active) return;
        setEscrowAsset(catalog.escrowAsset);
        setSupportedTokens(catalog.tokens);
        if (catalog.tokens.length) {
          const first =
            catalog.tokens.find(
              (token) => token.network.toLowerCase() !== "near",
            ) ?? catalog.tokens[0];
          setOriginAsset(first.assetId);
        }
        setFundingStatus("");
      })
      .catch((error) => {
        if (!active) return;
        setFundingStatus(
          error instanceof Error
            ? error.message
            : "Prize funding is not configured on this deployment.",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (getX402BrowserPayer()) {
      setAiPayerReady(true);
      setAiPayerLabel("Compatible payer available");
    }
  }, []);

  const layout = useMemo(() => layoutDraft(entries), [entries]);
  const validEntryCount = entries.filter(
    (entry) => entry.clue.trim().length > 2 && entry.answer.trim().length > 2,
  ).length;
  const reward = Number(rewardAmount);
  const rewardIsValid =
    Number.isFinite(reward) && reward >= 1 && reward <= 100;
  const visibleFundingAmount =
    fundingOrder?.rail === "ONE_CLICK"
      ? authorizedDeposit?.inputAmountAtomic ??
        (!fundingAuthorizationRequired
          ? fundingOrder.inputAmountAtomic
          : null)
      : fundingOrder?.inputAmountAtomic ?? null;
  const visibleFundingAddress =
    fundingOrder?.rail === "ONE_CLICK"
      ? authorizedDeposit?.depositAddress ??
        (!fundingAuthorizationRequired ? fundingOrder.depositAddress : null)
      : fundingOrder?.depositAddress ?? null;
  const visibleFundingMemo =
    fundingOrder?.rail === "ONE_CLICK"
      ? authorizedDeposit?.depositMemo ??
        (!fundingAuthorizationRequired
          ? fundingOrder.quote.depositMemo
          : null)
      : fundingOrder?.quote.depositMemo ?? null;
  const visibleFundingDeadline =
    fundingOrder?.rail === "ONE_CLICK" && authorizedDeposit
      ? authorizedDeposit.deadline
      : fundingOrder?.expiresAt ?? null;
  const visibleOriginAsset =
    fundingOrder?.rail === "ONE_CLICK" && authorizedDeposit
      ? authorizedDeposit.originAssetId
      : fundingOrder?.originAssetId ?? null;
  const externalAuthorizationPending =
    fundingOrder?.rail === "ONE_CLICK" &&
    fundingAuthorizationRequired &&
    !authorizedDeposit;
  const fundingDepositIsVisible = Boolean(
    visibleFundingAmount && visibleFundingAddress && visibleFundingDeadline,
  );

  const setEntry = (
    index: number,
    field: keyof DraftEntry,
    value: string,
  ) => {
    if (field === "answer" && !allowedAnswer.test(value)) return;
    setEntries((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index
          ? {
              ...entry,
              [field]:
                field === "answer"
                  ? value.replace(/\s+/g, "").toUpperCase()
                  : value,
            }
          : entry,
      ),
    );
  };

  const addEntry = () => {
    if (entries.length >= 12) return;
    setEntries((current) => [...current, { clue: "", answer: "" }]);
  };

  const removeEntry = (index: number) => {
    if (entries.length <= 3) return;
    setEntries((current) =>
      current.filter((_, entryIndex) => entryIndex !== index),
    );
  };

  const generateWithAi = async () => {
    if (!getX402BrowserPayer()) {
      setAiPayerReady(false);
      setAiStatus(
        "Connect a compatible NEAR payer before requesting the paid AI draft.",
      );
      return;
    }
    setAiStatus("Preparing a one-time x402 request…");
    setAiReceiptHandle(null);
    try {
      const result = await requestAiDraft({
        topic: aiTopic,
        tone: aiTone,
        count: 7,
      });
      if (result.entries.length < 3) {
        throw new Error("The generator returned too few usable clues.");
      }
      setEntries(result.entries.slice(0, 12));
      setAiReceiptHandle(result.receiptHandle);
      setAiStatus(
        result.cached
          ? "Paid result recovered from the same payment identifier. No second settlement was requested."
          : "Draft added. The x402 settlement receipt is recorded; every clue stays editable before funding.",
      );
    } catch (error) {
      setAiStatus(
        error instanceof Error
          ? error.message
          : "AI drafting is unavailable. You can keep building manually.",
      );
    }
  };

  const connectAiPayer = async () => {
    setAiPayerConnecting(true);
    setAiStatus(
      "Choose a NEAR wallet that supports timeout-aware delegated actions…",
    );
    try {
      const connected = await connectFastNearX402Payer();
      setAiPayerReady(true);
      setAiPayerLabel(
        `${connected.accountId} · NEAR ${connected.network}`,
      );
      setAiStatus(
        "Payer connected. Your wallet will show the exact x402 amount before it signs.",
      );
    } catch (error) {
      setAiPayerReady(false);
      setAiPayerLabel("");
      setAiStatus(
        error instanceof Error
          ? error.message
          : "A compatible NEAR x402 payer could not be connected.",
      );
    } finally {
      setAiPayerConnecting(false);
    }
  };

  const goNext = () => {
    setSubmitStatus("");
    if (step === 1 && validEntryCount < 3) {
      setSubmitStatus("Add at least three complete clue and answer pairs.");
      return;
    }
    if (step === 2 && (!title.trim() || !sponsorName.trim())) {
      setSubmitStatus("Give your campaign a title and sponsor name.");
      return;
    }
    if (step === 3 && !rewardIsValid) {
      setSubmitStatus("Choose a prize between 1 and 100 USDC for the beta.");
      return;
    }
    if (step === 3 && !recoveryAccount.trim()) {
      setSubmitStatus(
        "Add a creator-controlled NEAR recovery account before requesting funding.",
      );
      return;
    }
    if (
      step === 3 &&
      fundingRail === "intents" &&
      !originRefundAddress.trim()
    ) {
      setSubmitStatus(
        "Add a refund address on the network you are funding from.",
      );
      return;
    }
    setStep((current) => Math.min(4, current + 1));
    window.scrollTo({ top: 180, behavior: "smooth" });
  };

  const saveDraft = async () => {
    if (!escrowAsset) {
      setSubmitStatus(
        "Funding is not configured, so this preview cannot be saved or published.",
      );
      return;
    }
    setSubmitting(true);
    setSubmitStatus("Deriving the solution commitment in this tab…");
    setCreatedSlug(null);
    setFundingOrder(null);
    setFundingAuthorizationRequired(false);
    setAuthorizedDeposit(null);
    try {
      const id = crypto.randomUUID();
      const solutionEntries = layout.positioned.map((entry) => ({
        number: entry.number,
        direction: entry.direction,
        answer: entry.answer,
      }));
      const solutionPublicKey = await deriveSolutionPublicKey(
        id,
        solutionEntries,
      );
      const amountAtomic = BigInt(
        Math.round(Number(rewardAmount) * 1_000_000),
      ).toString();
      const result = await createCampaign({
        id,
        creatorAccountId: recoveryAccount.trim().toLowerCase(),
        refundAccount: recoveryAccount.trim().toLowerCase(),
        title: title.trim(),
        description: description.trim(),
        sponsorName: sponsorName.trim(),
        visibility,
        durationHours,
        solutionPublicKey,
        puzzle: layout.puzzle,
        reward: {
          type: "TOKEN_PRIZE",
          assetId: escrowAsset.assetId,
          amountAtomic,
          decimals: escrowAsset.decimals,
          symbol: escrowAsset.symbol,
        },
        aiReceiptHandle,
        fundingPreference: {
          rail: fundingRail,
          originAsset,
        },
      });
      setSubmitStatus(
        "Draft saved. Requesting a short-lived funding quote—nothing has moved yet…",
      );
      const quoteResult = await requestFundingQuote({
        campaignId: result.campaign.id,
        rail: fundingRail,
        originAssetId:
          fundingRail === "direct" ? escrowAsset.assetId : originAsset,
        refundTo:
          fundingRail === "direct"
            ? recoveryAccount.trim().toLowerCase()
            : originRefundAddress.trim(),
      });
      setFundingOrder(quoteResult.fundingOrder);
      setFundingAuthorizationRequired(
        quoteResult.authorizationRequired,
      );
      setCreatedSlug(result.campaign.slug);
      setSubmitStatus(
        quoteResult.authorizationRequired
          ? "Quote prepared. Authorize the immutable campaign terms before the provider deposit can be revealed."
          : "Quote ready. Review the exact amount and destination below; the campaign stays private until settlement.",
      );
    } catch (error) {
      setSubmitStatus(
        error instanceof Error
          ? error.message
          : "We could not save this draft. Nothing was charged.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="creator-workspace">
      <aside className="creator-steps" aria-label="Campaign creation progress">
        <p className="eyebrow">Campaign builder</p>
        <ol>
          {steps.map((item) => (
            <li
              key={item.id}
              className={
                item.id === step
                  ? "is-active"
                  : item.id < step
                    ? "is-complete"
                    : ""
              }
            >
              <button type="button" onClick={() => setStep(item.id)}>
                <span>{item.id < step ? "✓" : item.id}</span>
                {item.label}
              </button>
            </li>
          ))}
        </ol>
        <div className="creator-steps__promise">
          <strong>Nothing goes live unfunded.</strong>
          <p>
            The puzzle and prize are frozen together only after settlement.
          </p>
        </div>
      </aside>

      <section className="creator-panel">
        {step === 1 ? (
          <>
            <header className="creator-panel__header">
              <p className="eyebrow">Step 1 of 4</p>
              <h1>Write a puzzle worth sharing.</h1>
              <p>
                Start with your own clues or use an x402-paid AI draft. Answers
                are used locally to build the solution commitment; they are
                never published with the campaign.
              </p>
            </header>

            <div className="ai-assist">
              <div>
                <p className="eyebrow">Optional · x402 service</p>
                <h2>Give me a first draft</h2>
                <p>
                  One transparent payment for one generated set. The prize is
                  funded separately.
                </p>
                <p>
                  Requires a NEAR wallet that supports NEP-366 delegated actions
                  with an explicit timeout. The wallet keeps its keys and
                  confirms the exact payment.
                </p>
              </div>
              <div className="ai-assist__fields">
                <label>
                  <span>Topic</span>
                  <input
                    value={aiTopic}
                    onChange={(event) => setAiTopic(event.target.value)}
                    placeholder="e.g. climate tech"
                  />
                </label>
                <label>
                  <span>Tone</span>
                  <select
                    value={aiTone}
                    onChange={(event) => setAiTone(event.target.value)}
                  >
                    <option value="clever">Clever</option>
                    <option value="approachable">Approachable</option>
                    <option value="expert">Expert</option>
                    <option value="playful">Playful</option>
                  </select>
                </label>
                <div className="ai-assist__actions">
                  {!aiPayerReady ? (
                    <button
                      className="button button--paper"
                      type="button"
                      onClick={connectAiPayer}
                      disabled={aiPayerConnecting}
                    >
                      {aiPayerConnecting
                        ? "Connecting payer…"
                        : "Connect NEAR payer"}
                    </button>
                  ) : (
                    <p className="form-message" role="status">
                      Payer: {aiPayerLabel}
                    </p>
                  )}
                  <button
                    className="button button--paper"
                    type="button"
                    onClick={generateWithAi}
                    disabled={!aiPayerReady}
                  >
                    Generate via x402
                  </button>
                </div>
              </div>
              {aiStatus || aiReceiptHandle ? (
                <p className="form-message" role="status">
                  {aiStatus}
                  {aiReceiptHandle ? (
                    <>
                      <br />
                      x402 receipt handle:{" "}
                      {aiReceiptHandle.paymentIdentifier.slice(0, 14)}…
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>

            <div className="clue-editor">
              <div className="clue-editor__title">
                <div>
                  <h2>Clues & answers</h2>
                  <p>{validEntryCount} complete · 3 minimum · 12 maximum</p>
                </div>
                <button
                  className="text-link"
                  type="button"
                  onClick={addEntry}
                  disabled={entries.length >= 12}
                >
                  + Add clue
                </button>
              </div>

              {entries.map((entry, index) => (
                <fieldset className="clue-row" key={`entry-${index}`}>
                  <legend className="sr-only">Clue {index + 1}</legend>
                  <span className="clue-row__number">{index + 1}</span>
                  <label>
                    <span>Clue</span>
                    <input
                      value={entry.clue}
                      onChange={(event) =>
                        setEntry(index, "clue", event.target.value)
                      }
                      placeholder="Write a concise clue"
                    />
                  </label>
                  <label className="clue-row__answer">
                    <span>Answer</span>
                    <input
                      value={entry.answer}
                      onChange={(event) =>
                        setEntry(index, "answer", event.target.value)
                      }
                      placeholder="ANSWER"
                      autoCapitalize="characters"
                      spellCheck={false}
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove clue ${index + 1}`}
                    onClick={() => removeEntry(index)}
                    disabled={entries.length <= 3}
                  >
                    ×
                  </button>
                </fieldset>
              ))}
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <header className="creator-panel__header">
              <p className="eyebrow">Step 2 of 4</p>
              <h1>Make it feel like your campaign.</h1>
              <p>
                Tell solvers who is behind the prize and why this puzzle exists.
              </p>
            </header>

            <div className="form-grid">
              <label className="field field--wide">
                <span>Campaign title</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={80}
                />
                <small>{title.length}/80</small>
              </label>
              <label className="field">
                <span>Presented by</span>
                <input
                  value={sponsorName}
                  onChange={(event) => setSponsorName(event.target.value)}
                  maxLength={60}
                />
              </label>
              <label className="field">
                <span>Visibility</span>
                <select
                  value={visibility}
                  onChange={(event) =>
                    setVisibility(event.target.value as CampaignDraft["visibility"])
                  }
                >
                  <option value="public">Public directory</option>
                  <option value="unlisted">Anyone with the link</option>
                </select>
              </label>
              <label className="field field--wide">
                <span>Campaign introduction</span>
                <textarea
                  rows={5}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={280}
                />
                <small>{description.length}/280</small>
              </label>
            </div>

            <div className="principle-card">
              <span className="principle-card__index">01</span>
              <div>
                <h2>A fair promise, in plain language</h2>
                <p>
                  V1 campaigns are free to solve and first-correct-wins. The
                  sponsor can cancel only before opening; after that, the
                  contract controls payout or expiry.
                </p>
              </div>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <header className="creator-panel__header">
              <p className="eyebrow">Step 3 of 4</p>
              <h1>Lock a prize from anywhere.</h1>
              <p>
                The campaign receives exactly the USDC prize shown to solvers.
                Routing costs and service fees are quoted separately.
              </p>
            </header>

            <div className="prize-composer">
              <label className="prize-input">
                <span>Winner&apos;s prize</span>
                <div>
                  <span aria-hidden="true">$</span>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    step="0.01"
                    value={rewardAmount}
                    onChange={(event) => setRewardAmount(event.target.value)}
                    aria-describedby="prize-limit"
                  />
                  <strong>USDC</strong>
                </div>
                <small id="prize-limit">
                  1–100 USDC during the unaudited beta
                </small>
              </label>

              <label className="field">
                <span>Campaign window</span>
                <select
                  value={durationHours}
                  onChange={(event) =>
                    setDurationHours(Number(event.target.value))
                  }
                >
                  <option value={1}>1 hour</option>
                  <option value={24}>24 hours</option>
                  <option value={72}>3 days</option>
                  <option value={168}>7 days</option>
                  <option value={336}>14 days</option>
                  <option value={720}>30 days</option>
                </select>
              </label>
            </div>

            <fieldset className="rail-picker">
              <legend>How do you want to fund it?</legend>
              <label className={fundingRail === "intents" ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="funding-rail"
                  value="intents"
                  checked={fundingRail === "intents"}
                  onChange={() => setFundingRail("intents")}
                />
                <span className="rail-picker__icon">↝</span>
                <span>
                  <strong>From another network</strong>
                  <small>
                    Swap a supported asset into exact-output USDC with NEAR
                    Intents.
                  </small>
                </span>
                <em>Recommended</em>
              </label>
              <label className={fundingRail === "direct" ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="funding-rail"
                  value="direct"
                  checked={fundingRail === "direct"}
                  onChange={() => setFundingRail("direct")}
                />
                <span className="rail-picker__icon">N</span>
                <span>
                  <strong>USDC on NEAR</strong>
                  <small>
                    Transfer directly from a connected NEAR account.
                  </small>
                </span>
              </label>
            </fieldset>

            {fundingRail === "intents" ? (
              <>
                <label className="field origin-field">
                  <span>Asset you want to send</span>
                  <select
                    value={originAsset}
                    onChange={(event) => setOriginAsset(event.target.value)}
                  >
                    {supportedTokens.length ? (
                      supportedTokens.map((token) => (
                        <option key={token.assetId} value={token.assetId}>
                          {token.label ?? `${token.symbol} on ${token.network}`}
                        </option>
                      ))
                    ) : (
                      <option value="">No live routes available</option>
                    )}
                  </select>
                  <small>
                    Live publication uses the current 1Click token catalog and
                    quote availability.
                  </small>
                </label>
                <label className="field origin-field">
                  <span>Origin-network refund address</span>
                  <input
                    autoComplete="off"
                    value={originRefundAddress}
                    onChange={(event) =>
                      setOriginRefundAddress(event.target.value)
                    }
                    placeholder="Address controlled by you"
                  />
                  <small>
                    1Click sends route refunds here; this address is never
                    replaced by the campaign operator.
                  </small>
                </label>
              </>
            ) : null}

            <label className="field origin-field">
              <span>NEAR recovery account</span>
              <input
                autoComplete="off"
                value={recoveryAccount}
                onChange={(event) => setRecoveryAccount(event.target.value)}
                placeholder="sponsor.near"
              />
              <small>
                Controls pre-open cancellation and receives an expired prize.
              </small>
            </label>

            {fundingStatus ? (
              <p className="form-message" role="status">
                {fundingStatus} You can still finish and preview the puzzle.
              </p>
            ) : null}

            <div className="fee-breakdown">
              <div>
                <span>Prize principal</span>
                <strong>
                  {rewardIsValid ? Number(rewardAmount).toFixed(2) : "—"} USDC
                </strong>
              </div>
              <div>
                <span>Route + network cost</span>
                <strong>Shown in the live quote</strong>
              </div>
              <div>
                <span>Platform fee</span>
                <strong>0.00 USDC · beta</strong>
              </div>
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <header className="creator-panel__header">
              <p className="eyebrow">Step 4 of 4</p>
              <h1>Review the promise.</h1>
              <p>
                Saving creates a private draft. You will review a time-limited
                funding quote before anything is charged or published.
              </p>
            </header>

            <div className="campaign-preview">
              <div className="campaign-preview__puzzle">
                <p className="eyebrow">Puzzle preview</p>
                <PuzzleDiagram puzzle={layout.puzzle} />
                <span>
                  {layout.puzzle.entries.length} clues ·{" "}
                  {layout.puzzle.rows}×{layout.puzzle.columns} grid
                </span>
              </div>
              <div className="campaign-preview__story">
                <span className="status-badge status-badge--awaiting_funding">
                  Funding required
                </span>
                <p className="eyebrow">Presented by {sponsorName}</p>
                <h2>{title}</h2>
                <p>{description}</p>
                <div className="campaign-preview__prize">
                  <span>Winner&apos;s prize</span>
                  <strong>{Number(rewardAmount || 0).toFixed(2)} USDC</strong>
                  <small>
                    Fund with {fundingRail === "intents" ? originAsset : "NEAR USDC"}
                  </small>
                </div>
              </div>
            </div>

            <div className="review-checks">
              <div>
                <span aria-hidden="true">✓</span>
                <p>
                  <strong>Answers stay private</strong>
                  Only a solution public key and content fingerprint are
                  committed.
                </p>
              </div>
              <div>
                <span aria-hidden="true">✓</span>
                <p>
                  <strong>Prize before publish</strong>
                  The page cannot become active until escrow is fully funded.
                </p>
              </div>
              <div>
                <span aria-hidden="true">✓</span>
                <p>
                  <strong>One recoverable route</strong>
                  Expiry returns funds to your chosen recovery account.
                </p>
              </div>
            </div>
          </>
        ) : null}

        {submitStatus ? (
          <div
            className={`submit-status${createdSlug ? " is-success" : ""}`}
            role="status"
          >
            {submitStatus}
            {createdSlug ? (
              <Link href={`/campaigns/${createdSlug}`}>
                Open draft <span aria-hidden="true">→</span>
              </Link>
            ) : null}
          </div>
        ) : null}

        {fundingOrder ? (
          <section className="funding-instructions" aria-live="polite">
            {externalAuthorizationPending ? (
              <>
                <p className="eyebrow">
                  Step 1 of 2 · Creator authorization
                </p>
                <h2>Authorize the campaign before funding.</h2>
                <dl>
                  <div>
                    <dt>Prize principal</dt>
                    <dd>
                      {fundingOrder.principalAmountAtomic} atomic USDC
                    </dd>
                  </div>
                  <div>
                    <dt>Authorization deadline</dt>
                    <dd>
                      {new Date(fundingOrder.expiresAt).toLocaleString()}
                    </dd>
                  </div>
                </dl>
                <p>
                  The origin amount, provider address, and memo stay hidden
                  until the v2 contract independently confirms your immutable
                  campaign terms at finality.
                </p>
                <ExternalFundingAuthorizationAction
                  fundingOrder={fundingOrder}
                  onVerified={setAuthorizedDeposit}
                />
              </>
            ) : fundingDepositIsVisible ? (
              <>
                <p className="eyebrow">
                  {fundingOrder.rail === "ONE_CLICK"
                    ? "Step 2 of 2 · Time-limited funding quote"
                    : "Time-limited funding quote"}
                </p>
                <h2>Send only the quoted asset and amount.</h2>
                <dl>
                  <div>
                    <dt>Prize principal</dt>
                    <dd>
                      {fundingOrder.principalAmountAtomic} atomic USDC
                    </dd>
                  </div>
                  {visibleOriginAsset ? (
                    <div>
                      <dt>Asset to send</dt>
                      <dd>{visibleOriginAsset}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Exact amount to send</dt>
                    <dd>{visibleFundingAmount} atomic units</dd>
                  </div>
                  <div>
                    <dt>Deposit destination</dt>
                    <dd>{visibleFundingAddress}</dd>
                  </div>
                  {visibleFundingMemo ? (
                    <div>
                      <dt>Required memo</dt>
                      <dd>{visibleFundingMemo}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Quote expires</dt>
                    <dd>
                      {new Date(visibleFundingDeadline!).toLocaleString()}
                    </dd>
                  </div>
                </dl>
                <p>
                  Funding is not complete until the ledger observes final
                  settlement and the v2 contract shows the full prize
                  reserved.
                </p>
                <DirectFundingAction fundingOrder={fundingOrder} />
              </>
            ) : (
              <>
                <p className="eyebrow">Funding quote unavailable</p>
                <h2>Do not send funds from this quote.</h2>
                <p>
                  The service did not return a complete exact amount,
                  destination, and deadline. Request a fresh quote before
                  funding.
                </p>
              </>
            )}
          </section>
        ) : null}

        <footer className="creator-panel__actions">
          {step > 1 ? (
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setStep((current) => current - 1)}
            >
              Back
            </button>
          ) : (
            <span />
          )}
          {step < 4 ? (
            <button
              className="button button--ink"
              type="button"
              onClick={goNext}
            >
              Continue
            </button>
          ) : (
            <button
              className="button button--blue"
              type="button"
              onClick={saveDraft}
              disabled={submitting || !escrowAsset}
            >
              {submitting ? "Saving…" : "Save private draft"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
