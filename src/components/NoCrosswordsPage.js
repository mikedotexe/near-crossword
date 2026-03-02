import React from "react";
import Link from "next/link";

const NoCrosswordsPage = () => {
  return (
    <section className="page-grid">
      <article className="card">
        <p className="eyebrow">No Active Puzzle</p>
        <h2>All current puzzles are solved.</h2>
        <p>
          Publish a new campaign puzzle to keep your audience engaged with
          product learning challenges.
        </p>
        <div className="button-row">
          <Link className="button button-primary" href="/create">
            Publish a Puzzle
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
