import React, { useEffect, useState } from "react";
import Link from "next/link";
import { trackEvent } from "../../lib/analytics";
import { getPaymentHistory, TEMPO_EXPLORER } from "../../lib/mpp-client";

const NEAR_EXPLORER =
  process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet"
    ? "https://nearblocks.io"
    : "https://testnet.nearblocks.io";

const LandingPage = ({ hasActivePuzzle }) => {
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    setPayments(getPaymentHistory());
  }, []);

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
          No sign-up required — connect a wallet or pay with dollars to start.
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
        <p className="eyebrow">Powered by Tempo</p>
        <h3>Pay with dollars, no wallet needed</h3>
        <p>
          Fund puzzles without a crypto wallet. Tempo&apos;s Machine Payments
          Protocol handles the payment in the background when you hit publish.
        </p>
        <ul className="step-list">
          <li>Write your clues and set a reward amount</li>
          <li>Choose &ldquo;Pay with dollars&rdquo; at checkout</li>
          <li>Your puzzle goes live on NEAR automatically</li>
        </ul>
        <p style={{ fontSize: "0.82rem", color: "var(--muted)", marginTop: "0.5rem" }}>
          Under the hood: the server issues an HTTP 402 challenge, your browser
          signs a Tempo transaction, and the server verifies payment on-chain
          before creating the puzzle on NEAR. No API keys, no accounts, no
          checkout page.
        </p>
        <div className="button-row" style={{ marginTop: "1rem" }}>
          <Link
            className="button button-primary"
            href="/create"
            onClick={() => trackEvent("landing_mpp_create_click")}
          >
            Create a Puzzle
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

      {payments.length > 0 ? (
        <article className="card">
          <p className="eyebrow">Your Payments</p>
          <h3>Recent cross-chain transactions</h3>
          <div style={{ fontSize: "0.85rem" }}>
            {payments.slice(0, 5).map((p, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 0",
                  borderBottom: i < Math.min(payments.length, 5) - 1 ? "1px solid rgba(0,0,0,0.06)" : "none",
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  {p.type === "puzzle" ? "Puzzle" : "AI Clues"}
                </span>
                {" — "}
                <span>${p.amount}</span>
                {p.demo ? (
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)", marginLeft: "6px" }}>
                    (demo)
                  </span>
                ) : null}
                <div style={{ marginTop: "2px", fontSize: "0.78rem", color: "var(--muted)" }}>
                  {p.reference ? (
                    <a
                      href={`${TEMPO_EXPLORER}/tx/${p.reference}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--primary)", marginRight: "8px" }}
                    >
                      Tempo tx
                    </a>
                  ) : null}
                  {p.nearTxHash ? (
                    <a
                      href={`${NEAR_EXPLORER}/txns/${p.nearTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--primary)" }}
                    >
                      NEAR tx
                    </a>
                  ) : null}
                  {" "}
                  {new Date(p.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </article>
      ) : null}
    </section>
  );
};

export default LandingPage;
