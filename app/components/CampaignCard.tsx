import Link from "next/link";
import type { Campaign } from "../lib/types";
import { Countdown } from "./Countdown";
import { PuzzleDiagram } from "./PuzzleDiagram";
import { StatusBadge } from "./StatusBadge";

export function CampaignCard({ campaign }: { campaign: Campaign }) {
  const isScheduled = campaign.state === "scheduled";
  const prize =
    campaign.reward.type === "token"
      ? `${campaign.reward.amount} ${campaign.reward.symbol}`
      : campaign.reward.title;

  return (
    <article className="campaign-card">
      <div className="campaign-card__visual">
        <div className="campaign-card__visual-meta">
          <span className="sponsor-mark">{campaign.sponsorMark}</span>
          <StatusBadge state={campaign.state} compact />
        </div>
        <PuzzleDiagram puzzle={campaign.puzzle} compact />
      </div>
      <div className="campaign-card__body">
        <p className="eyebrow">Presented by {campaign.sponsorName}</p>
        <h3>
          <Link href={`/campaigns/${campaign.slug}`}>{campaign.title}</Link>
        </h3>
        <p>{campaign.description}</p>

        <div className="campaign-card__reward">
          <span>
            <small>Prize</small>
            <strong>{prize}</strong>
          </span>
          <Countdown
            target={isScheduled ? campaign.opensAt : campaign.expiresAt}
            prefix={isScheduled ? "Opens in" : "Closes in"}
          />
        </div>

        <div className="campaign-card__foot">
          <span>{campaign.solverCount.toLocaleString()} playing</span>
          <Link
            className="text-link"
            href={
              isScheduled || !campaign.isDemo
                ? `/campaigns/${campaign.slug}`
                : `/campaigns/${campaign.slug}/play`
            }
          >
            {isScheduled || !campaign.isDemo
              ? "View & verify"
              : "Solve the preview"}{" "}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
}
