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
} from "../lib/mpp-client";

const allowedAnswerRegex = /^[a-zA-Z0-9.-]?[a-zA-Z0-9_.-]*$/;
const createBlankClue = () => ({ clue: "", answer: "" });

const CrosswordForm = ({ allowMpp = false }) => {
  const [clueAnswerArray, setClueAnswerArray] = useState([createBlankClue()]);
  const [dimensions, setDimensions] = useState();
  const [generatedLayout, setGeneratedLayout] = useState();
  const [crosswordLayout, setCrosswordLayout] = useState();
  const [prizeDeposit, setPrizeDeposit] = useState("5");
  const [hasErrors, setHasErrors] = useState(false);
  const [commitStatus, setCommitStatus] = useState("");
  const [commitError, setCommitError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("near"); // "near" or "mpp"
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
      setCommitError("Failed to fund Tempo account: " + err.message);
    } finally {
      setFundingTempo(false);
    }
  };

  const handleCommitPuzzleMpp = async () => {
    setCommitStatus("Processing payment via Tempo...");
    setCommitError("");
    trackEvent("create_commit_mpp_initiated", {
      clue_count: validClueAnswers.length,
      prize: prizeDeposit,
    });

    try {
      const result = await createPuzzleWithMpp(validClueAnswers, prizeDeposit);

      if (result.success) {
        const receiptInfo = result.receipt
          ? ` | Tempo TX: ${result.receipt.reference?.slice(0, 10)}...`
          : "";
        const nearInfo = result.txHash
          ? `NEAR TX: ${result.txHash.slice(0, 10)}...`
          : "MPP payment verified";
        setCommitStatus(
          `${nearInfo}. Paid via Tempo MPP.${receiptInfo}${result.demo ? " (demo mode)" : ""}`
        );
        trackEvent("create_commit_mpp_success");
        // Refresh balance
        getTempoBalance().then(setTempoBalance).catch(() => {});
      } else {
        setCommitError(result.error || "Unknown error");
      }
    } catch (error) {
      console.error("MPP commit failed:", error);
      setCommitStatus("");
      setCommitError(error.message || "MPP payment failed.");
      trackEvent("create_commit_mpp_fail", { reason: error.message });
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
                <label>Payment Method:</label>
                <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="near"
                      checked={paymentMethod === "near"}
                      onChange={() => setPaymentMethod("near")}
                    />
                    NEAR Wallet
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="mpp"
                      checked={paymentMethod === "mpp"}
                      onChange={() => setPaymentMethod("mpp")}
                    />
                    Tempo MPP (Multi-Currency)
                  </label>
                </div>
              </div>
            ) : null}

            {paymentMethod === "mpp" ? (
              <div className="field-group" style={{ background: "rgba(99,102,241,0.08)", padding: "16px", borderRadius: "8px" }}>
                <p style={{ margin: "0 0 8px", fontWeight: 600 }}>Tempo Account</p>
                {tempoAddress ? (
                  <p style={{ margin: "0 0 4px", fontSize: "13px", wordBreak: "break-all", opacity: 0.7 }}>
                    {tempoAddress}
                  </p>
                ) : null}
                <p style={{ margin: "0 0 8px" }}>
                  Balance: {tempoBalance !== null ? `$${tempoBalance.toFixed(2)} USDC` : "Loading..."}
                </p>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={handleFundTempo}
                  disabled={fundingTempo}
                  style={{ marginBottom: "8px" }}
                >
                  {fundingTempo ? "Funding..." : "Get Testnet USDC (Faucet)"}
                </button>
                <p style={{ margin: 0, fontSize: "12px", opacity: 0.6 }}>
                  Pay with USDC on Tempo instead of NEAR. The server funds the puzzle on-chain.
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
                  Commit Puzzle to Smart Contract
                </button>
              ) : (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={handleCommitPuzzleMpp}
                >
                  Pay with Tempo &amp; Create Puzzle
                </button>
              )}
              {commitStatus ? <p className="info-msg">{commitStatus}</p> : null}
              {commitError ? <p className="error-msg">{commitError}</p> : null}
            </div>
          </React.Fragment>
        ) : null}
      </form>
    </div>
  );
};

export default CrosswordForm;
