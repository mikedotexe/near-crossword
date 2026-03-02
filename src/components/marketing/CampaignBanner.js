import React from "react";
import Link from "next/link";

const CampaignBanner = () => {
  return (
    <section className="campaign-banner app-container">
      <div>
        <p className="campaign-kicker">Campaign Ready</p>
        <h1>Create branded crossword quiz campaigns in minutes</h1>
        <p>
          Launch interactive quizzes that teach users about your project and
          reward completion with on-chain incentives.
        </p>
      </div>
      <div className="campaign-actions">
        <Link className="button button-primary" href="/create">
          Build a Campaign
        </Link>
        <Link className="button button-secondary" href="/ai-studio">
          Try AI Studio
        </Link>
      </div>
    </section>
  );
};

export default CampaignBanner;
