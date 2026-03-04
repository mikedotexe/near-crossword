import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { trackEvent } from "../../lib/analytics";

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
  const [draft, setDraft] = useState(defaultDraft);
  const [inputMode, setInputMode] = useState("youtube");
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [phase, setPhase] = useState("idle");
  const [variations, setVariations] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

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
  const canSubmit = inputMode === "pdf" ? !!file : isYoutubeValid;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;

    setPhase("uploading");
    setErrorMessage("");

    const isPdf = inputMode === "pdf";
    trackEvent(isPdf ? "ai_pdf_upload_start" : "ai_youtube_upload_start");

    try {
      let body;
      if (isPdf) {
        const pdfBase64 = await readFileAsBase64(file);
        body = { pdfBase64, tone: draft.tone, objective: draft.objective };
      } else {
        body = { youtubeUrl: youtubeUrl.trim(), tone: draft.tone, objective: draft.objective };
      }

      const response = await fetch("/api/generate-clues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate clues.");
      }

      setVariations(data.variations);
      setPhase("review");
      trackEvent("ai_pdf_upload_success");
    } catch (error) {
      console.error("AI generation failed:", error);
      setErrorMessage(error.message || "Something went wrong. Please try again.");
      setPhase("error");
      trackEvent("ai_pdf_upload_error");
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
    setFile(null);
    setYoutubeUrl("");
  };

  return (
    <section className="card ai-card">
      <div className="section-header">
        <p className="eyebrow">AI Studio</p>
        <h2>Generate puzzle clues with AI</h2>
        <p>
          Upload a PDF or paste a YouTube URL and we&apos;ll use AI to create
          crossword clue/answer pairs from its content.
        </p>
      </div>

      {phase === "uploading" && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <p>
            {inputMode === "pdf"
              ? "Reading your PDF and generating clues\u2026"
              : "Fetching transcript and generating clues\u2026"}
          </p>
          <p style={{ fontSize: "0.85rem", opacity: 0.8 }}>
            This may take up to a minute.
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
          </div>

          {inputMode === "pdf" ? (
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
          ) : (
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

          <div className="field-group">
            <button
              className="button button-primary"
              type="submit"
              disabled={!canSubmit}
            >
              Generate Clues
            </button>
          </div>
        </form>
      )}

      {phase === "review" && variations && (
        <div>
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

      {phase === "error" && (
        <div>
          <p className="error-msg">{errorMessage}</p>
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
