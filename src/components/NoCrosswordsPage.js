import React from "react";
import Link from "next/link";

const NoCrosswordsPage = () => {
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
    </section>
  );
};

export default NoCrosswordsPage;
