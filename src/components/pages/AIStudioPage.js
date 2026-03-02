import React, { useEffect, useState } from "react";
import aiConfig from "../../aiConfig";

const DRAFT_KEY = "aiCrosswordDraft";

const defaultDraft = {
  projectName: "",
  projectUrl: "",
  resources: "",
  objective: "",
  tone: "Educational",
  puzzleCount: "2",
};

const AIStudioPage = () => {
  const [draft, setDraft] = useState(defaultDraft);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    const savedDraft = localStorage.getItem(DRAFT_KEY);
    if (!savedDraft) {
      return;
    }

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

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!aiConfig.enabled) {
      setStatusMessage(
        "AI Studio is not live yet. Your draft is saved locally while integration is in progress."
      );
      return;
    }

    setStatusMessage(
      "AI Studio wiring is enabled by config, but backend integration is still pending in this repo."
    );
  };

  return (
    <section className="card ai-card">
      <div className="section-header">
        <p className="eyebrow">AI Studio Preview</p>
        <h2>Prepare AI-generated crossword campaigns</h2>
        <p>
          Configure project inputs now. We will connect this flow to market.near.ai
          agent execution in a later iteration.
        </p>
      </div>

      <form className="ai-form" onSubmit={handleSubmit}>
        <label htmlFor="projectName">Project name</label>
        <input
          id="projectName"
          name="projectName"
          value={draft.projectName}
          onChange={updateField}
          placeholder="Example: Aurora Quest"
          type="text"
        />

        <label htmlFor="projectUrl">Project URL</label>
        <input
          id="projectUrl"
          name="projectUrl"
          value={draft.projectUrl}
          onChange={updateField}
          placeholder="https://example.org"
          type="url"
        />

        <label htmlFor="resources">Source resources (URLs, docs, notes)</label>
        <textarea
          id="resources"
          name="resources"
          value={draft.resources}
          onChange={updateField}
          placeholder="Paste links and context for clue generation"
          rows={5}
        />

        <label htmlFor="objective">Campaign objective</label>
        <input
          id="objective"
          name="objective"
          value={draft.objective}
          onChange={updateField}
          placeholder="Teach product features and onboarding steps"
          type="text"
        />

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

        <label htmlFor="puzzleCount">Number of puzzles</label>
        <input
          id="puzzleCount"
          name="puzzleCount"
          value={draft.puzzleCount}
          onChange={updateField}
          min="1"
          max="10"
          type="number"
        />

        <button className="button button-primary" type="submit">
          Save AI Generation Draft
        </button>

        <p className="ai-config-note">
          Config: `NEXT_PUBLIC_NEAR_AI_ENABLED={String(aiConfig.enabled)}` |
          `NEXT_PUBLIC_MARKET_NEAR_AI_URL={aiConfig.marketUrl}`
          {aiConfig.agentId
            ? ` | NEXT_PUBLIC_NEAR_AI_AGENT_ID=${aiConfig.agentId}`
            : ""}
        </p>

        {statusMessage ? <p className="info-msg">{statusMessage}</p> : null}
      </form>
    </section>
  );
};

export default AIStudioPage;
