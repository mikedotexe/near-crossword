import React from "react";
import Link from "next/link";
import { trackEvent } from "../../lib/analytics";

const LandingPage = ({ hasActivePuzzle }) => {
  return (
    <section className="page-grid">
      <article className="card hero-card">
        <p className="eyebrow">Quiz Campaign Platform</p>
        <h2>Turn product education into a game users actually finish</h2>
        <p>
          Create crossword challenges for launches, community onboarding, and
          marketing campaigns. Winners claim rewards directly on NEAR.
        </p>
        <p className="trust-line">
          On-chain rewards, wallet-based auth, and no custodial accounts.
        </p>

        <div className="button-row">
          <Link
            className="button button-primary"
            href="/create"
            onClick={() => trackEvent("landing_cta_create_click")}
          >
            Start a Puzzle Campaign
          </Link>
          <Link
            className="button button-secondary"
            href="/play"
            onClick={() => trackEvent("landing_cta_play_click")}
          >
            {hasActivePuzzle ? "Play Live Puzzle" : "Browse Puzzle Mode"}
          </Link>
        </div>
      </article>

      <article className="card">
        <h3>How it works</h3>
        <ol className="step-list">
          <li>Connect a wallet and create your puzzle clues.</li>
          <li>Commit `new_puzzle` with a reward attached.</li>
          <li>Share the campaign and let users solve to win.</li>
        </ol>
      </article>
    </section>
  );
};

export default LandingPage;
