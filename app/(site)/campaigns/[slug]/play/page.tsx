import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimReceiptTracker } from "../../../../components/ClaimReceiptTracker";
import { PuzzlePlayer } from "../../../../components/PuzzlePlayer";
import { getCampaign } from "../../../../lib/api";

export const metadata: Metadata = {
  title: "Play",
};

export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ claim?: string | string[] }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const rawClaimId = Array.isArray(query.claim) ? query.claim[0] : query.claim;
  const claimId =
    rawClaimId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      rawClaimId,
    )
      ? rawClaimId
      : null;
  const cookie = (await headers()).get("cookie") ?? undefined;
  const campaign = await getCampaign(slug, { cookie });
  if (!campaign) notFound();

  if (claimId) {
    return <ClaimReceiptTracker campaign={campaign} claimId={claimId} />;
  }

  const verifiedActive =
    campaign.isDemo === true ||
    (campaign.state === "active" &&
      campaign.verification.status === "verified" &&
      campaign.verification.contractMatchesLedger &&
      campaign.verification.fundedAndLocked &&
      campaign.verification.contractState === "active");

  if (campaign.state !== "active" || !verifiedActive) {
    const awaitingFunding = ["draft", "awaiting_funding"].includes(
      campaign.state,
    );
    const verificationUnavailable =
      campaign.state === "active" && !verifiedActive;
    return (
      <section className="state-page">
        <div className="shell state-card">
          <p className="eyebrow">
            {verificationUnavailable
              ? "Escrow verification required"
              : awaitingFunding
                ? "Not funded yet"
                : "Not open"}
          </p>
          <h1>
            {verificationUnavailable
              ? "Play is paused until the prize evidence matches."
              : awaitingFunding
              ? "The prize must be locked before play."
              : "The grid is not accepting solves."}
          </h1>
          <p>
            {verificationUnavailable
              ? "The workflow ledger currently says this campaign is open, but the final contract view is unavailable or differs from its immutable terms. No claim is prepared in that state."
              : campaign.state === "scheduled"
              ? "The puzzle becomes playable at the published opening time after its final escrow evidence is verified."
              : awaitingFunding
                ? "This private draft has no claimable prize. Funding settlement must finish before publication."
                : "The campaign has already moved beyond its active solving window."}
          </p>
          <Link className="button button--ink" href={`/campaigns/${slug}`}>
            View campaign details
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="play-page">
      {campaign.isDemo ? (
        <div className="demo-ribbon">
          Interactive product preview — this campaign has no live escrow or
          claimable prize.
        </div>
      ) : null}
      <div className="shell">
        <PuzzlePlayer campaign={campaign} />
      </div>
    </section>
  );
}
