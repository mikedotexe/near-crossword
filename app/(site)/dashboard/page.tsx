import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { StatusBadge } from "../../components/StatusBadge";
import { listCampaigns } from "../../lib/api";

export const metadata: Metadata = {
  title: "Creator dashboard",
};

export default async function DashboardPage() {
  const cookie = (await headers()).get("cookie") ?? undefined;
  const campaigns = await listCampaigns({ mine: true, cookie });
  const demo = campaigns.every((campaign) => campaign.isDemo);
  const locked = campaigns.reduce(
    (total, campaign) =>
      total +
      (campaign.reward.type === "token"
        ? Number(campaign.reward.amount)
        : 0),
    0,
  );

  return (
    <section className="dashboard-page">
      <div className="shell">
        <header className="dashboard-heading">
          <div>
            <p className="eyebrow eyebrow--blue">Creator dashboard</p>
            <h1>Campaigns, receipts, next moves.</h1>
            <p>
              Draft privately, fund explicitly, and follow every prize through
              settlement or recovery.
            </p>
          </div>
          <Link className="button button--blue" href="/create">
            New campaign
          </Link>
        </header>

        {demo ? (
          <div className="dashboard-preview">
            <div>
              <strong>Preview workspace</strong>
              <p>
                These illustrative campaigns show the dashboard before creator
                authentication and the workflow ledger are connected.
              </p>
            </div>
            <Link className="button button--paper" href="/login">
              Creator sign in
            </Link>
          </div>
        ) : null}

        <div className="dashboard-stats">
          <div>
            <span>Campaigns</span>
            <strong>{campaigns.length}</strong>
            <small>Across every state</small>
          </div>
          <div>
            <span>Prize principal</span>
            <strong>{locked.toFixed(2)} USDC</strong>
            <small>Illustrative when preview is active</small>
          </div>
          <div>
            <span>Needs attention</span>
            <strong>
              {
                campaigns.filter((campaign) =>
                  ["draft", "awaiting_funding", "refunding"].includes(
                    campaign.state,
                  ),
                ).length
              }
            </strong>
            <small>Drafts, funding, or recovery</small>
          </div>
        </div>

        <section className="dashboard-table" aria-labelledby="campaigns-title">
          <div className="dashboard-table__heading">
            <div>
              <p className="eyebrow">Your campaigns</p>
              <h2 id="campaigns-title">Every promise in one ledger.</h2>
            </div>
            <span>Newest first</span>
          </div>
          <div className="dashboard-table__rows">
            {campaigns.map((campaign) => (
              <article key={campaign.id}>
                <span className="sponsor-mark">{campaign.sponsorMark}</span>
                <div>
                  <strong>{campaign.title}</strong>
                  <small>
                    {campaign.reward.type === "token"
                      ? `${campaign.reward.amount} ${campaign.reward.symbol}`
                      : campaign.reward.title}
                    {" · "}
                    {campaign.solverCount} playing
                  </small>
                </div>
                <StatusBadge state={campaign.state} compact />
                <span className="dashboard-table__date">
                  {new Date(campaign.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <Link
                  className="text-link"
                  href={`/campaigns/${campaign.slug}`}
                >
                  View →
                </Link>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
