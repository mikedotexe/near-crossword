import React from "react";
import Link from "next/link";
import { trackEvent } from "../../lib/analytics";

const LandingPage = ({ hasActivePuzzle }) => {
  return (
    <section className="page-grid">
      <article className="card hero-card">
        <p className="eyebrow">NEAR Crossword</p>
        <h2>Crossword puzzles with real crypto rewards</h2>
        <p>
          Solve community puzzles or create your own. Winners earn NEAR tokens
          directly to their wallet.
        </p>
        <p className="trust-line">
          No sign-up required — just connect a wallet and play.
        </p>

        <div className="button-row">
          <Link
            className="button button-primary"
            href="/play"
            onClick={() => trackEvent("landing_cta_play_click")}
          >
            {hasActivePuzzle ? "Play Now" : "Browse Puzzles"}
          </Link>
          <Link
            className="button button-secondary"
            href="/create"
            onClick={() => trackEvent("landing_cta_create_click")}
          >
            Create a Puzzle
          </Link>
        </div>
      </article>

      <article className="card">
        <p className="eyebrow">3 Steps</p>
        <h3>How it works</h3>
        <ol className="step-list">
          <li>Pick a live puzzle and start solving clues.</li>
          <li>Complete the crossword to unlock the reward.</li>
          <li>Claim your NEAR tokens instantly.</li>
        </ol>
        <p className="creator-note">
          Want to create your own?{" "}
          <Link href="/create">Get started here</Link>.
        </p>
      </article>

      <article className="card">
        <p className="eyebrow">Powered by Tempo MPP</p>
        <h3>Pay with any currency</h3>
        <p>
          Create puzzles using USDC, stablecoins, or other tokens via
          Tempo&apos;s Machine Payments Protocol. No NEAR wallet needed to get
          started — pay with what you have.
        </p>
        <ul className="step-list">
          <li>
            <strong>Multi-currency:</strong> Pay with USDC on Tempo instead of
            NEAR
          </li>
          <li>
            <strong>HTTP 402 flow:</strong> Seamless payment integrated into API
            requests
          </li>
          <li>
            <strong>Cross-chain:</strong> Your Tempo payment funds NEAR puzzles
            automatically
          </li>
        </ul>
        <div className="button-row" style={{ marginTop: "1rem" }}>
          <Link
            className="button button-primary"
            href="/create"
            onClick={() => trackEvent("landing_mpp_create_click")}
          >
            Create with Tempo
          </Link>
          <Link
            className="button button-secondary"
            href="/ai-studio"
            onClick={() => trackEvent("landing_mpp_ai_click")}
          >
            AI Studio
          </Link>
        </div>
      </article>
    </section>
  );
};

export default LandingPage;
