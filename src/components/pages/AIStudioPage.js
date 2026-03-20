import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { trackEvent } from "../../lib/analytics";
import {
  generateCluesWithMpp,
  getTempoBalance,
  fundTempoAccount,
  getTempoAddress,
  ensureFunded,
  recordPayment,
  TEMPO_EXPLORER,
} from "../../lib/mpp-client";

const DRAFT_KEY = "aiCrosswordDraft";
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const YT_URL_RE = /^https?:\/\/(www\.)?(youtube\.com\/(watch|embed)|youtu\.be\/)/i;

const defaultDraft = {
  objective: "",
  tone: "Educational",
};

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

const AIStudioPage = () => {
  const router = useRouter();
  const { data: session } = useSession();
  const [draft, setDraft] = useState(defaultDraft);
  const [inputMode, setInputMode] = useState("youtube");
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [phase, setPhase] = useState("idle");
  const [variations, setVariations] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [paymentReceipt, setPaymentReceipt] = useState(null);
  const [asyncMode, setAsyncMode] = useState(false);

  // MPP state — default to enabled for hackathon demo
  const [useMpp, setUseMpp] = useState(true);
  const [tempoBalance, setTempoBalance] = useState(null);
  const [tempoAddress, setTempoAddress] = useState(null);
  const [fundingTempo, setFundingTempo] = useState(false);

  useEffect(() => {
    const savedDraft = localStorage.getItem(DRAFT_KEY);
    if (!savedDraft) return;
    try {
      const parsed = JSON.parse(savedDraft);
      setDraft({ ...defaultDraft, ...parsed });
    } catch (error) {
      console.warn("Unable to parse AI draft state:", error);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    if (useMpp) {
      setTempoAddress(getTempoAddress());
      // Check balance and auto-fund if zero (testnet faucet)
      ensureFunded().then(setTempoBalance).catch(() => setTempoBalance(0));
    }
  }, [useMpp]);

  const handleFundTempo = async () => {
    setFundingTempo(true);
    try {
      const balance = await fundTempoAccount();
      setTempoBalance(balance);
    } catch (err) {
      setErrorMessage("Could not add funds: " + err.message);
    } finally {
      setFundingTempo(false);
    }
  };

  const updateField = (event) => {
    const { name, value } = event.target;
    setDraft((current) => ({ ...current, [name]: value }));
  };

  const handleFileSelect = (event) => {
    setFileError("");
    const selected = event.target.files[0];
    if (!selected) {
      setFile(null);
      return;
    }
    if (selected.type !== "application/pdf") {
      setFileError("Please select a PDF file.");
      setFile(null);
      return;
    }
    if (selected.size > MAX_FILE_SIZE) {
      setFileError("File is too large. Maximum size is 15MB.");
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const isYoutubeValid = YT_URL_RE.test(youtubeUrl.trim());
  const canSubmit =
    inputMode === "pdf" ? !!file :
    inputMode === "text" ? pastedText.trim().length >= 50 :
    isYoutubeValid;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;

    setPhase("uploading");
    setErrorMessage("");

    trackEvent(`ai_${inputMode}_upload_start`);

    try {
      // Build common body fields
      let pdfBase64;
      if (inputMode === "pdf") {
        pdfBase64 = await readFileAsBase64(file);
      }

      // Async mode: submit background job
      if (asyncMode && session) {
        const body = {
          inputMode,
          pdfBase64: inputMode === "pdf" ? pdfBase64 : undefined,
          youtubeUrl: inputMode === "youtube" ? youtubeUrl.trim() : undefined,
          pastedText: inputMode === "text" ? pastedText.trim() : undefined,
          tone: draft.tone,
          objective: draft.objective,
        };

        const response = await fetch("/api/puzzle-jobs/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to submit job.");
        }

        setPhase("submitted");
        trackEvent("ai_async_submit_success");
        return;
      }

      // Sync mode: build request body
      let body;
      if (inputMode === "pdf") {
        body = { pdfBase64, tone: draft.tone, objective: draft.objective };
      } else if (inputMode === "text") {
        body = { pastedText: pastedText.trim(), tone: draft.tone, objective: draft.objective };
      } else {
        body = { youtubeUrl: youtubeUrl.trim(), tone: draft.tone, objective: draft.objective };
      }

      let data;

      if (useMpp) {
        // MPP-paid generation
        trackEvent("ai_mpp_generation_start");
        data = await generateCluesWithMpp(body);
      } else {
        // Free/existing flow
        const response = await fetch("/api/generate-clues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to generate clues.");
        }
      }

      setVariations(data.variations);
      if (useMpp && data.receipt) {
        setPaymentReceipt(data.receipt);
        recordPayment({
          type: "ai-clues",
          amount: "0.10",
          receipt: data.receipt,
        });
      }
      setPhase("review");
      trackEvent(useMpp ? "ai_mpp_generation_success" : "ai_pdf_upload_success");

      // Refresh Tempo balance after MPP payment
      if (useMpp) {
        getTempoBalance().then(setTempoBalance).catch(() => {});
      }
    } catch (error) {
      console.error("AI generation failed:", error);
      setErrorMessage(error.message || "Something went wrong. Please try again.");
      // Show receipt even on error — user can prove payment was made
      if (error.receipt) {
        setPaymentReceipt(error.receipt);
      }
      setPhase("error");
      trackEvent("ai_pdf_upload_error");
      // Refresh balance after failed attempt
      if (useMpp) {
        getTempoBalance().then(setTempoBalance).catch(() => {});
      }
    }
  };

  const handleSelectVariation = (variation) => {
    localStorage.setItem("aiGeneratedClues", JSON.stringify(variation.pairs));
    trackEvent("ai_variation_selected", { label: variation.label });
    router.push("/create");
  };

  const handleStartOver = () => {
    setPhase("idle");
    setVariations(null);
    setErrorMessage("");
    setPaymentReceipt(null);
    setFile(null);
    setYoutubeUrl("");
    setPastedText("");
  };

  return (
    <section className="card ai-card">
      <div className="section-header">
        <p className="eyebrow">AI Studio</p>
        <h2>Generate puzzle clues with AI</h2>
        <p>
          Provide content via YouTube URL, PDF upload, or pasted text and
          we&apos;ll use AI to create crossword clue/answer pairs from it.
        </p>
      </div>

      {phase === "uploading" && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <p>
            {inputMode === "pdf"
              ? "Reading your PDF and generating clues\u2026"
              : inputMode === "text"
              ? "Analyzing your text and generating clues\u2026"
              : "Fetching transcript and generating clues\u2026"}
          </p>
          <p style={{ fontSize: "0.85rem", opacity: 0.8 }}>
            {useMpp
              ? "Verifying payment on Tempo, then generating clues\u2026"
              : "This may take up to a minute."}
          </p>
        </div>
      )}

      {phase === "idle" && (
        <form className="ai-form" onSubmit={handleSubmit}>
          <div className="input-mode-toggle">
            <button
              type="button"
              className={inputMode === "youtube" ? "active" : ""}
              onClick={() => setInputMode("youtube")}
            >
              YouTube URL
            </button>
            <button
              type="button"
              className={inputMode === "pdf" ? "active" : ""}
              onClick={() => setInputMode("pdf")}
            >
              Upload PDF
            </button>
            <button
              type="button"
              className={inputMode === "text" ? "active" : ""}
              onClick={() => setInputMode("text")}
            >
              Paste Text
            </button>
          </div>

          {inputMode === "pdf" && (
            <div className="field-group">
              <label htmlFor="pdfFile">PDF document</label>
              <input
                id="pdfFile"
                type="file"
                accept=".pdf"
                onChange={handleFileSelect}
              />
              {fileError && <p className="error-msg">{fileError}</p>}
            </div>
          )}

          {inputMode === "youtube" && (
            <div className="field-group">
              <label htmlFor="youtubeUrl">YouTube video URL</label>
              <input
                id="youtubeUrl"
                type="url"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
              />
            </div>
          )}

          {inputMode === "text" && (
            <div className="field-group">
              <label htmlFor="pastedText">Paste your content</label>
              <textarea
                id="pastedText"
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Paste an article, notes, documentation, or any text you want to turn into crossword clues..."
                rows={8}
              />
              <p className="form-text">Minimum 50 characters.</p>
            </div>
          )}

          <div className="field-group">
            <label htmlFor="objective">Focus / objective (optional)</label>
            <input
              id="objective"
              name="objective"
              value={draft.objective}
              onChange={updateField}
              placeholder="e.g. Teach product features and onboarding steps"
              type="text"
            />
          </div>

          <div className="field-group">
            <label htmlFor="tone">Tone</label>
            <select
              id="tone"
              name="tone"
              value={draft.tone}
              onChange={updateField}
            >
              <option>Educational</option>
              <option>Playful</option>
              <option>Technical</option>
              <option>Beginner Friendly</option>
            </select>
          </div>

          {/* MPP payment toggle */}
          <div
            className="field-group"
            style={{
              background: useMpp ? "rgba(99,102,241,0.08)" : "transparent",
              padding: useMpp ? "16px" : "0",
              borderRadius: "8px",
              transition: "all 0.2s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="checkbox"
                id="useMpp"
                checked={useMpp}
                onChange={(e) => setUseMpp(e.target.checked)}
              />
              <label htmlFor="useMpp" style={{ fontWeight: 600 }}>
                Pay with dollars ($0.10 per generation)
              </label>
            </div>

            {useMpp && (
              <div style={{ marginTop: "12px" }}>
                <p style={{ margin: "0 0 8px" }}>
                  {tempoBalance !== null
                    ? `$${tempoBalance.toFixed(2)} available`
                    : "Checking balance..."}
                </p>
                {tempoBalance !== null && tempoBalance < 0.1 ? (
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={handleFundTempo}
                    disabled={fundingTempo}
                    style={{ fontSize: "0.85rem" }}
                  >
                    {fundingTempo ? "Adding funds..." : "Add test funds"}
                  </button>
                ) : null}
                {tempoAddress ? (
                  <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
                    Tempo account:{" "}
                    <a
                      href={`${TEMPO_EXPLORER}/address/${tempoAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--primary)" }}
                    >
                      {tempoAddress.slice(0, 8)}...{tempoAddress.slice(-6)}
                    </a>
                  </p>
                ) : null}
              </div>
            )}
          </div>

          {session && !useMpp && (
            <div className="async-toggle">
              <input
                type="checkbox"
                id="asyncMode"
                checked={asyncMode}
                onChange={(e) => setAsyncMode(e.target.checked)}
              />
              <label htmlFor="asyncMode">
                Submit in background and email me when ready
              </label>
            </div>
          )}

          <div className="field-group">
            <button
              className="button button-primary"
              type="submit"
              disabled={!canSubmit || (useMpp && tempoBalance !== null && tempoBalance < 0.1)}
            >
              {useMpp
                ? "Pay & Generate"
                : asyncMode && session
                ? "Submit Job"
                : "Generate Clues"}
            </button>
            {useMpp && tempoBalance !== null && tempoBalance < 0.1 ? (
              <p className="form-text" style={{ marginTop: "4px" }}>
                Insufficient balance. Click &ldquo;Add test funds&rdquo; above.
              </p>
            ) : null}
          </div>
        </form>
      )}

      {phase === "review" && variations && (
        <div>
          {paymentReceipt?.reference ? (
            <div style={{ marginBottom: "1rem", padding: "12px", background: "rgba(16,185,129,0.08)", borderRadius: "8px", fontSize: "0.85rem" }}>
              <p style={{ margin: "0 0 4px", fontWeight: 600, color: "var(--foreground)" }}>
                Tempo payment confirmed
              </p>
              <p style={{ margin: 0, color: "var(--secondary)" }}>
                Ref: {paymentReceipt.reference}{" "}
                <a
                  href={`${TEMPO_EXPLORER}/tx/${paymentReceipt.reference}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--primary)" }}
                >
                  View on explorer
                </a>
              </p>
            </div>
          ) : null}
          <p style={{ marginBottom: "1rem" }}>
            Pick a variation to use, then edit the clues on the Create page.
          </p>

          <div className="variation-grid">
            {variations.map((v) => (
              <div className="variation-card" key={v.label}>
                <h3>Variation {v.label}</h3>
                <p>{v.description}</p>

                <table className="variation-table">
                  <thead>
                    <tr>
                      <th>Clue</th>
                      <th>Answer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.pairs.map((pair, i) => (
                      <tr key={i}>
                        <td>{pair.clue}</td>
                        <td>{pair.answer}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <button
                  className="button button-primary"
                  onClick={() => handleSelectVariation(v)}
                  style={{ marginTop: "0.75rem" }}
                >
                  Use This Variation
                </button>
              </div>
            ))}
          </div>

          <div className="field-group" style={{ marginTop: "1rem" }}>
            <button
              className="button button-secondary"
              onClick={handleStartOver}
            >
              Start Over
            </button>
          </div>
        </div>
      )}

      {phase === "submitted" && (
        <div>
          <p className="info-msg" style={{ marginBottom: "0.75rem" }}>
            Job submitted! We&apos;ll email <strong>{session?.user?.email}</strong> when your clues are ready.
          </p>
          <div className="field-group">
            <Link href="/my-jobs" className="button button-primary">
              View My Jobs
            </Link>
            <button
              className="button button-secondary"
              onClick={handleStartOver}
              style={{ marginLeft: "0.5rem" }}
            >
              Submit Another
            </button>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div>
          <p className="error-msg">{errorMessage}</p>
          {paymentReceipt?.reference ? (
            <div style={{ marginTop: "0.75rem", padding: "12px", background: "rgba(251,191,36,0.08)", borderRadius: "8px", fontSize: "0.85rem" }}>
              <p style={{ margin: "0 0 4px", fontWeight: 600 }}>
                Payment was processed
              </p>
              <p style={{ margin: 0, color: "var(--secondary)" }}>
                Ref: {paymentReceipt.reference}{" "}
                <a
                  href={`${TEMPO_EXPLORER}/tx/${paymentReceipt.reference}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--primary)" }}
                >
                  View on explorer
                </a>
              </p>
            </div>
          ) : null}
          <div className="field-group" style={{ marginTop: "0.75rem" }}>
            <button className="button button-secondary" onClick={handleStartOver}>
              Try Again
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default AIStudioPage;
