import React from "react";
import Link from "next/link";
import { usePuzzles } from "../lib/usePuzzles";

const NoCrosswordsPage = () => {
  const { data, loading } = usePuzzles();

  const upcoming = data?.upcoming || [];
  const recent = data?.recent || [];

  const explorerBase =
    process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet"
      ? "https://nearblocks.io/txns"
      : "https://testnet.nearblocks.io/txns";

  return (
    <section className="page-grid">
      <article className="card">
        <p className="eyebrow">Check Back Soon</p>
        <h2>All puzzles have been claimed!</h2>
        <p>
          New puzzles are posted regularly. In the meantime, you can create one
          for your own community.
        </p>
        <div className="button-row">
          <Link className="button button-primary" href="/create">
            Create a Puzzle
          </Link>
          <Link className="button button-secondary" href="/">
            Back to Home
          </Link>
        </div>
      </article>

      {!loading && upcoming.length > 0 && (
        <article className="card half-card">
          <p className="eyebrow">Upcoming Puzzles</p>
          <h2>Coming Soon</h2>
          {upcoming.map((p) => (
            <p key={p.id}>
              {p.reward_amount} NEAR reward — scheduled{" "}
              {new Date(p.scheduled_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          ))}
        </article>
      )}

      {!loading && recent.length > 0 && (
        <article className="card half-card">
          <p className="eyebrow">Recently Solved</p>
          <h2>Past Puzzles</h2>
          {recent.map((p) => (
            <p key={p.id}>
              {p.reward_amount} NEAR —{" "}
              {new Date(p.updated_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
              {p.activate_tx_hash && (
                <>
                  {" — "}
                  <a
                    href={`${explorerBase}/${p.activate_tx_hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    view tx
                  </a>
                </>
              )}
            </p>
          ))}
        </article>
      )}
    </section>
  );
};

export default NoCrosswordsPage;
