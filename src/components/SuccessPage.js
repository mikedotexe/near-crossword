import React from "react";
import Link from "next/link";

const SuccessPage = () => {
  return (
    <section className="page-grid">
      <article className="card">
        <p className="eyebrow">Reward Sent</p>
        <h2>Your NEAR tokens are on the way!</h2>
        <p>
          Enjoyed the puzzle? Create one for your own community and reward your
          users for learning.
        </p>
        <div className="button-row">
          <Link className="button button-primary" href="/create">
            Create a Puzzle
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
