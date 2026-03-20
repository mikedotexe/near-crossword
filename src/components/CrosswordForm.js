import React, { useEffect, useMemo, useRef, useState } from "react";
import { ThemeProvider } from "styled-components";
import Crossword from "@crosswordxyz/react-crossword";
import { generateLayout } from "crossword-layout-generator";
import { mungeLocalCrossword } from "../utils";
import { addNewPuzzle } from "../add-puzzle";
import { trackEvent } from "../lib/analytics";
import {
  createPuzzleWithMpp,
  getTempoBalance,
  fundTempoAccount,
  getTempoAddress,
  ensureFunded,
  recordPayment,
  TEMPO_EXPLORER,
} from "../lib/mpp-client";

const NEAR_EXPLORER =
  process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet"
    ? "https://nearblocks.io"
    : "https://testnet.nearblocks.io";
const allowedAnswerRegex = /^[a-zA-Z0-9.-]?[a-zA-Z0-9_.-]*$/;
const createBlankClue = () => ({ clue: "", answer: "" });
const SAMPLE_CLUES = [
  { clue: "HTTP status code for payment required", answer: "402" },
  { clue: "Protocol for machine-to-machine payments", answer: "MPP" },
  { clue: "Blockchain for smart contracts and dApps", answer: "NEAR" },
  { clue: "Token standard on Tempo network", answer: "TIP-20" },
  { clue: "Cryptographic proof of payment", answer: "RECEIPT" },
];

const CrosswordForm = ({ allowMpp = false }) => {
  const [clueAnswerArray, setClueAnswerArray] = useState([createBlankClue()]);
  const [dimensions, setDimensions] = useState();
  const [generatedLayout, setGeneratedLayout] = useState();
  const [crosswordLayout, setCrosswordLayout] = useState();
  const [prizeDeposit, setPrizeDeposit] = useState("5");
  const [hasErrors, setHasErrors] = useState(false);
  const [commitStatus, setCommitStatus] = useState("");
  const [commitError, setCommitError] = useState("");
  const [paymentReceipt, setPaymentReceipt] = useState(null);
  const [nearTxHash, setNearTxHash] = useState(null);
  const [isDemoResult, setIsDemoResult] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("mpp"); // "near" or "mpp"
  const [tempoBalance, setTempoBalance] = useState(null);
  const [tempoAddress, setTempoAddress] = useState(null);
  const [fundingTempo, setFundingTempo] = useState(false);
  const crosswordRef = useRef(null);

  useEffect(() => {
    if (paymentMethod === "mpp") {
      setTempoAddress(getTempoAddress());
      // Check balance and auto-fund if zero (testnet faucet)
      ensureFunded().then(setTempoBalance).catch(() => setTempoBalance(0));
    }
  }, [paymentMethod]);

  const handleFundTempo = async () => {
    setFundingTempo(true);
    try {
      const balance = await fundTempoAccount();
      setTempoBalance(balance);
    } catch (err) {
      setCommitError("Could not add funds: " + err.message);
    } finally {
      setFundingTempo(false);
    }
  };

  const handleCommitPuzzleMpp = async () => {
    setCommitStatus("Signing payment on Tempo\u2026");
    setCommitError("");
    setPaymentReceipt(null);
    setNearTxHash(null);
    setIsDemoResult(false);
    trackEvent("create_commit_mpp_initiated", {
      clue_count: validClueAnswers.length,
      prize: prizeDeposit,
    });

    try {
      const result = await createPuzzleWithMpp(validClueAnswers, prizeDeposit);

      if (result.success) {
        if (result.receipt) {
          setPaymentReceipt(result.receipt);
        }
        if (result.txHash) {
          setNearTxHash(result.txHash);
        }
        setIsDemoResult(Boolean(result.demo));
        if (result.demo) {
          setCommitStatus("Payment verified on Tempo! NEAR submission is simulated (server credentials not configured).");
        } else {
          setCommitStatus("Puzzle is live on NEAR! Tempo payment confirmed.");
        }
        trackEvent("create_commit_mpp_success");
        recordPayment({
          type: "puzzle",
          amount: "1.00",
          receipt: result.receipt,
          nearTxHash: result.txHash,
          demo: result.demo,
        });
        // Refresh balance
        getTempoBalance().then(setTempoBalance).catch(() => {});
      } else {
        setCommitError(result.error || "Unknown error");
      }
    } catch (error) {
      console.error("MPP commit failed:", error);
      setCommitStatus("");
      setCommitError(error.message || "Payment failed. Please try again.");
      // Show receipt even on error — user can prove payment was made
      if (error.receipt) {
        setPaymentReceipt(error.receipt);
      }
      trackEvent("create_commit_mpp_fail", { reason: error.message });
      // Refresh balance after failed attempt (payment may have gone through)
      getTempoBalance().then(setTempoBalance).catch(() => {});
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem("aiGeneratedClues");
    if (!stored) return;
    try {
      const pairs = JSON.parse(stored);
      if (Array.isArray(pairs) && pairs.length > 0) {
        setClueAnswerArray(pairs.filter((p) => p.clue && p.answer));
      }
    } catch (err) {
      console.warn("Failed to parse AI-generated clues:", err);
    }
    localStorage.removeItem("aiGeneratedClues");
  }, []);

  const validClueAnswers = useMemo(
    () =>
      clueAnswerArray.filter(
        (pair) => pair.answer.length > 2 && pair.clue.length > 2
      ),
    [clueAnswerArray]
  );

  const handleClueAnswerChange = (event, key, propName) => {
    let nextValue = event.target.value;

    if (propName === "answer") {
      nextValue = nextValue.replace(/\s+/g, "");
    }

    const updatedArray = clueAnswerArray.map((item, index) =>
      index === key ? { ...item, [propName]: nextValue } : item
    );

    const containsInvalidAnswer = updatedArray.some(
      (item) => item.answer && !allowedAnswerRegex.test(item.answer)
    );

    setHasErrors(containsInvalidAnswer);
    setClueAnswerArray(updatedArray);

    if (propName === "answer" && !allowedAnswerRegex.test(nextValue)) {
      event.target.classList.add("field-with-errors");
    } else {
      event.target.classList.remove("field-with-errors");
    }
  };

  const handleClueAnswerBlur = (event) => {
    if (event.target.value.length > 0 && event.target.value.length < 3) {
      event.target.classList.add("field-with-errors");
    } else {
      event.target.classList.remove("field-with-errors");
    }
  };

  const handlePrizeDepositChange = (event) => {
    if (Number(event.target.value) >= 5) {
      setPrizeDeposit(event.target.value);
    }
  };

  const generateSamplePuzzle = () => {
    if (validClueAnswers.length < 3) {
      return;
    }

    trackEvent("create_preview_generate", {
      valid_pairs: validClueAnswers.length,
    });

    const layout = generateLayout(validClueAnswers);
    const answers = [];

    layout.result.forEach((value) => {
      const answerObj = {
        num: value.position,
        start: {
          x: value.startx,
          y: value.starty,
        },
        direction: value.orientation,
        length: value.answer.length,
        answer: value.answer,
        clue: value.clue,
      };

      if (answerObj.num) {
        answers.push(answerObj);
      }
    });

    setDimensions({
      x: layout.cols,
      y: layout.rows,
    });
    setGeneratedLayout(answers);
    setCrosswordLayout(mungeLocalCrossword(answers));
    setCommitStatus("");
    setCommitError("");
  };

  const handleCommitPuzzle = async () => {
    setCommitStatus("Waiting for wallet approval...");
    setCommitError("");
    trackEvent("create_commit_initiated", {
      clue_count: generatedLayout ? generatedLayout.length : 0,
      prize: prizeDeposit,
    });

    try {
      const result = await addNewPuzzle(
        crosswordLayout,
        generatedLayout,
        dimensions,
        prizeDeposit
      );

      if (result) {
        setCommitStatus("Puzzle committed successfully.");
        trackEvent("create_commit_success");
      } else {
        setCommitStatus("");
        setCommitError("Wallet action was cancelled. No transaction was sent.");
        trackEvent("create_commit_cancel_or_fail", {
          reason: "wallet_cancelled",
        });
      }
    } catch (error) {
      console.error("Commit puzzle failed:", error);
      setCommitStatus("");
      setCommitError(error.message || "Failed to commit puzzle.");
      trackEvent("create_commit_cancel_or_fail", {
        reason: "transaction_error",
      });
    }
  };

  useEffect(() => {
    const crossword = crosswordRef.current;
    if (!crossword) {
      return;
    }

    crossword.fillAllAnswers();
    return () => {
      crossword.reset();
    };
  }, [crosswordLayout]);

  return (
    <div>
      <form className="crossword-form" onSubmit={(event) => event.preventDefault()}>
        {validClueAnswers.length < 3 ? (
          <div className="form-text">Please add at least 3 valid clue/answer pairs.</div>
        ) : null}

        {clueAnswerArray.map((value, key) => (
          <div className="clue-answer-item field-group" key={key}>
            <input
              type="text"
              onChange={(event) => handleClueAnswerChange(event, key, "clue")}
              onBlur={handleClueAnswerBlur}
              name={`clue-${key}`}
              value={value.clue}
              placeholder="Clue"
            />
            <input
              type="text"
              onChange={(event) => handleClueAnswerChange(event, key, "answer")}
              onBlur={handleClueAnswerBlur}
              name={`answer-${key}`}
              value={value.answer}
              placeholder="Answer"
            />
          </div>
        ))}

        <div className="field-group add-word-container">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setClueAnswerArray([...clueAnswerArray, createBlankClue()])}
          >
            + Add Word
          </button>
          {validClueAnswers.length < 3 ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setClueAnswerArray(SAMPLE_CLUES);
                trackEvent("create_load_sample");
              }}
              style={{ marginLeft: "8px" }}
            >
              Load sample clues
            </button>
          ) : null}
        </div>

        {hasErrors ? (
          <div className="error-msg">
            Disallowed characters detected. Allowed: letters, numbers, hyphens,
            periods, and underscores (underscore cannot be first character).
          </div>
        ) : null}

        {validClueAnswers.length >= 3 && !hasErrors ? (
          <div className="field-group field-group-border-top">
            <button
              className="button button-primary"
              type="button"
              onClick={generateSamplePuzzle}
            >
              Generate Sample Puzzle
            </button>
          </div>
        ) : null}

        {crosswordLayout ? (
          <ThemeProvider
            theme={{
              columnBreakpoint: "768px",
              gridBackground: "#ffffff",
              cellBackground: "#e8ecf8",
              cellBorder: "#c7ceeb",
              textColor: "#1a1d2e",
              numberColor: "#4b5675",
              focusBackground: "rgba(99, 102, 241, 0.4)",
              highlightBackground: "rgba(165, 180, 252, 0.4)",
            }}
          >
            <Crossword
              ref={crosswordRef}
              data={crosswordLayout}
              useStorage={false}
            />
          </ThemeProvider>
        ) : null}

        {crosswordLayout && generatedLayout && dimensions && !hasErrors ? (
          <React.Fragment>
            <div className="field-group field-group-border-top">
              <label htmlFor="prize-field">Include Prize (in NEAR):</label>
              <input
                type="number"
                id="prize-field"
                value={prizeDeposit}
                step="1"
                onChange={handlePrizeDepositChange}
              />
            </div>

            {allowMpp ? (
              <div className="field-group">
                <label>Pay with:</label>
                <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="mpp"
                      checked={paymentMethod === "mpp"}
                      onChange={() => setPaymentMethod("mpp")}
                    />
                    Dollars (Tempo)
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="near"
                      checked={paymentMethod === "near"}
                      onChange={() => setPaymentMethod("near")}
                    />
                    NEAR wallet
                  </label>
                </div>
              </div>
            ) : null}

            {paymentMethod === "mpp" ? (
              <div className="field-group" style={{ background: "rgba(99,102,241,0.08)", padding: "16px", borderRadius: "8px" }}>
                <p style={{ margin: "0 0 8px" }}>
                  {tempoBalance !== null
                    ? `$${tempoBalance.toFixed(2)} available`
                    : "Checking balance..."}
                </p>
                {tempoBalance !== null && tempoBalance < 1 ? (
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={handleFundTempo}
                    disabled={fundingTempo}
                    style={{ marginBottom: "8px" }}
                  >
                    {fundingTempo ? "Adding funds..." : "Add test funds"}
                  </button>
                ) : null}
                {tempoAddress ? (
                  <p style={{ margin: "0 0 4px", fontSize: "12px", opacity: 0.6 }}>
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
                <p style={{ margin: 0, fontSize: "12px", opacity: 0.6 }}>
                  $1.00 per puzzle via Tempo. Payment is processed automatically when you publish.
                </p>
              </div>
            ) : null}

            <div className="field-group">
              {paymentMethod === "near" ? (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={handleCommitPuzzle}
                >
                  Publish Puzzle
                </button>
              ) : (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={handleCommitPuzzleMpp}
                  disabled={tempoBalance !== null && tempoBalance < 1}
                >
                  Pay &amp; Publish
                </button>
              )}
              {paymentMethod === "mpp" && tempoBalance !== null && tempoBalance < 1 ? (
                <p className="form-text" style={{ marginTop: "4px" }}>
                  Insufficient balance. Click &ldquo;Add test funds&rdquo; above.
                </p>
              ) : null}
              {commitStatus ? <p className="info-msg">{commitStatus}</p> : null}
              {commitError ? <p className="error-msg">{commitError}</p> : null}
              {paymentReceipt || nearTxHash ? (
                <div style={{ marginTop: "8px", padding: "16px", background: "rgba(16,185,129,0.08)", borderRadius: "8px", fontSize: "0.85rem" }}>
                  <p style={{ margin: "0 0 8px", fontWeight: 600, color: "var(--foreground)" }}>
                    Cross-chain transaction
                  </p>
                  {paymentReceipt?.reference ? (
                    <p style={{ margin: "0 0 4px", color: "var(--secondary)" }}>
                      Tempo payment:{" "}
                      <a
                        href={`${TEMPO_EXPLORER}/tx/${paymentReceipt.reference}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--primary)" }}
                      >
                        {paymentReceipt.reference.slice(0, 10)}...{paymentReceipt.reference.slice(-6)}
                      </a>
                    </p>
                  ) : null}
                  {nearTxHash ? (
                    <p style={{ margin: "0 0 4px", color: "var(--secondary)" }}>
                      NEAR transaction:{" "}
                      <a
                        href={`${NEAR_EXPLORER}/txns/${nearTxHash}?tab=overview`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--primary)" }}
                      >
                        {nearTxHash.slice(0, 10)}...{nearTxHash.slice(-6)}
                      </a>
                    </p>
                  ) : null}
                  {isDemoResult ? (
                    <p style={{ margin: "4px 0 0", fontSize: "0.78rem", fontStyle: "italic", color: "var(--muted)" }}>
                      Demo mode &mdash; Tempo payment was real, NEAR submission skipped (configure NEAR_PRIVATE_KEY for full flow)
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </React.Fragment>
        ) : null}
      </form>
    </div>
  );
};

export default CrosswordForm;
