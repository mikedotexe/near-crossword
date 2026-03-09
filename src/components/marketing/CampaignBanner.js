import React from "react";
import Link from "next/link";

const CampaignBanner = () => {
  return (
    <section className="campaign-banner app-container">
      <div>
        <p className="campaign-kicker">For Creators</p>
        <h1>Build a puzzle for your community</h1>
        <p>
          Design clues about your project. Attach a NEAR reward. Share the link.
        </p>
      </div>
      <div className="campaign-actions">
        <Link className="button button-primary" href="/create">
          Create a Puzzle
        </Link>
        <Link className="button button-secondary" href="/ai-studio">
          Try AI Studio
        </Link>
      </div>
    </section>
  );
};

export default CampaignBanner;
