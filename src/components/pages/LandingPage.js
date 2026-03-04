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
    </section>
  );
};

export default LandingPage;
