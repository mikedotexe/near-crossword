import type { Metadata } from "next";
import { CampaignCard } from "../../components/CampaignCard";
import { SectionHeading } from "../../components/SectionHeading";
import { listCampaigns } from "../../lib/api";

export const metadata: Metadata = {
  title: "Explore",
  description: "Discover sponsor-funded crossword campaigns with locked prizes.",
};

export default async function ExplorePage() {
  const campaigns = await listCampaigns();
  const active = campaigns.filter((campaign) =>
    ["active", "scheduled"].includes(campaign.state),
  );
  const completed = campaigns.filter((campaign) =>
    ["claimed", "expired", "refunded"].includes(campaign.state),
  );

  return (
    <>
      <section className="page-hero page-hero--explore">
        <div className="shell page-hero__grid">
          <div>
            <p className="eyebrow eyebrow--blue">Explore campaigns</p>
            <h1>
              Find the clue
              <br />
              that <em>clicks.</em>
            </h1>
          </div>
          <div className="page-hero__copy">
            <p>
              Every live prize is fully funded before the first letter goes in.
              Solving is free; the first valid finish wins.
            </p>
            <div className="filter-pills" aria-label="Campaign types">
              <span className="is-active">All puzzles</span>
              <span>Open now</span>
              <span>Opening soon</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--paper">
        <div className="shell">
          <SectionHeading
            eyebrow="The board"
            title={`${active.length} campaign${active.length === 1 ? "" : "s"} ready to play`}
          >
            <p>Pick a theme, not a network. Payout routing comes after the solve.</p>
          </SectionHeading>
          {active.every((campaign) => campaign.isDemo) ? (
            <p className="catalog-demo-note">
              Preview catalog — these campaigns demonstrate the intended v2
              experience and do not represent funded live prizes.
            </p>
          ) : null}
          <div className="campaign-grid campaign-grid--three">
            {active.map((campaign) => (
              <CampaignCard campaign={campaign} key={campaign.id} />
            ))}
          </div>
        </div>
      </section>

      {completed.length ? (
        <section className="section section--muted">
          <div className="shell">
            <SectionHeading eyebrow="Archive" title="Solved in public." />
            <div className="campaign-grid campaign-grid--three">
              {completed.map((campaign) => (
                <CampaignCard campaign={campaign} key={campaign.id} />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
