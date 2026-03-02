import React from "react";
import Link from "next/link";

const SuccessPage = () => {
  return (
    <section className="page-grid">
      <article className="card">
        <p className="eyebrow">Reward Claimed</p>
        <h2>Your reward transfer was successful.</h2>
        <p>
          Want similar engagement for your own project? Launch a crossword
          campaign and reward users for learning key product concepts.
        </p>
        <div className="button-row">
          <Link className="button button-primary" href="/create">
            Create Your Campaign
          </Link>
          <Link className="button button-secondary" href="/ai-studio">
            Open AI Studio
          </Link>
        </div>
      </article>
    </section>
  );
};

export default SuccessPage;
