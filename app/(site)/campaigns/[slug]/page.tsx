import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Countdown } from "../../../components/Countdown";
import { EvidencePanel } from "../../../components/EvidencePanel";
import { FundingContinuation } from "../../../components/FundingContinuation";
import { PuzzleDiagram } from "../../../components/PuzzleDiagram";
import { StatusBadge } from "../../../components/StatusBadge";
import { getCampaign } from "../../../lib/api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const cookie = (await headers()).get("cookie") ?? undefined;
  const campaign = await getCampaign(slug, { cookie });
  if (!campaign) notFound();
  return {
    title: campaign.title,
    description: campaign.description,
  };
}

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cookie = (await headers()).get("cookie") ?? undefined;
  const campaign = await getCampaign(slug, { cookie });
  if (!campaign) notFound();
  const scheduled = campaign.state === "scheduled";
  const awaitingFunding = ["draft", "awaiting_funding"].includes(
    campaign.state,
  );
  const verifiedPlayable =
    campaign.isDemo === true ||
    (campaign.verification.status === "verified" &&
      campaign.verification.contractMatchesLedger &&
      campaign.verification.fundedAndLocked &&
      campaign.verification.contractState === "active");
  const prize =
    campaign.reward.type === "token"
      ? `${campaign.reward.amount} ${campaign.reward.symbol}`
      : campaign.reward.title;

  return (
    <>
      <section className="campaign-hero">
        <div className="shell campaign-hero__grid">
          <div className="campaign-hero__story">
            {campaign.isDemo ? (
              <span className="demo-label">Illustrative campaign</span>
            ) : null}
            <StatusBadge state={campaign.state} />
            <p className="eyebrow">Presented by {campaign.sponsorName}</p>
            <h1>{campaign.title}</h1>
            <p className="campaign-hero__lede">{campaign.description}</p>
            <div className="campaign-hero__stats">
              <div>
                <span>Prize</span>
                <strong>{prize}</strong>
              </div>
              <div>
                <span>{scheduled ? "Opens" : "Time remaining"}</span>
                <Countdown
                  target={scheduled ? campaign.opensAt : campaign.expiresAt}
                  prefix={scheduled ? "In" : ""}
                />
              </div>
              <div>
                <span>Playing</span>
                <strong>{campaign.solverCount.toLocaleString()}</strong>
              </div>
            </div>
            {awaitingFunding ? (
              <div className="campaign-ended">
                Private draft · complete the time-limited funding instructions
                from your creator workspace.
              </div>
            ) : scheduled ? (
              <button className="button button--ink" disabled>
                Opens after the countdown
              </button>
            ) : campaign.state === "active" && verifiedPlayable ? (
              <Link
                className="button button--blue"
                href={`/campaigns/${campaign.slug}/play`}
              >
                Solve the crossword
              </Link>
            ) : campaign.state === "active" ? (
              <div className="campaign-ended">
                Play is paused until final contract evidence matches this
                campaign’s complete locked terms.
              </div>
            ) : (
              <span className="campaign-ended">This campaign has ended.</span>
            )}
            <p className="no-wallet-copy">
              No account or purchase is needed to play.
            </p>
          </div>

          <div className="campaign-hero__puzzle">
            <div className="campaign-hero__sponsor">
              <span className="sponsor-mark sponsor-mark--large">
                {campaign.sponsorMark}
              </span>
              <span>
                <small>Theme</small>
                <strong>{campaign.theme}</strong>
              </span>
            </div>
            <PuzzleDiagram puzzle={campaign.puzzle} />
            <span className="campaign-hero__clue-count">
              {campaign.puzzle.entries.length} clues · first valid solve wins
            </span>
          </div>
        </div>
      </section>

      {awaitingFunding && !campaign.isDemo ? (
        <section className="section section--paper">
          <div className="shell">
            <FundingContinuation campaignId={campaign.id} />
          </div>
        </section>
      ) : null}

      <section className="section section--paper">
        <div className="shell campaign-detail-grid">
          <EvidencePanel campaign={campaign} />

          <section className="rules-panel" aria-labelledby="rules-title">
            <p className="eyebrow">Campaign rules</p>
            <h2 id="rules-title">Simple enough to read before playing.</h2>
            <ol>
              {campaign.rules.map((rule, index) => (
                <li key={rule}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{rule}</p>
                </li>
              ))}
            </ol>
            {campaign.reward.type === "token" ? (
              <div className="route-summary">
                <span aria-hidden="true">↝</span>
                <p>
                  <strong>{campaign.reward.originLabel}</strong>
                  The winner can request direct NEAR USDC or a supported
                  cross-chain payout from a live quote.
                </p>
              </div>
            ) : null}
          </section>
        </div>
      </section>
    </>
  );
}
