"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Plus, RefreshCw } from "lucide-react";
import { learningApi, LearningApiError, loginLink } from "../api";

export function SponsorList() {
  const [campaigns, setCampaigns] = useState<Array<{
    id: string;
    title: string;
    revision: number;
    status: string;
  }> | null>(null);
  const [error, setError] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const load = useCallback(async () => {
    setError("");
    setAnonymous(false);
    try {
      setCampaigns(
        (
          await learningApi<{ campaigns: NonNullable<typeof campaigns> }>(
            "/api/base/reviews",
          )
        ).campaigns,
      );
    } catch (e) {
      if (e instanceof LearningApiError && e.status === 401) setAnonymous(true);
      else setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <div className="learn-heading">
        <div>
          <p className="learn-kicker">Crossword / Sponsors</p>
          <h1>Campaign studio</h1>
        </div>
        <Link href="/learn/studio/new" className="learn-button">
          <Plus size={18} /> New campaign
        </Link>
      </div>
      {anonymous ? (
        <section className="learn-empty">
          <h2>Your drafts stay private.</h2>
          <Link className="learn-button" href={loginLink("/learn/studio")}>
            Sign in to the studio
          </Link>
        </section>
      ) : error ? (
        <div className="learn-notice" role="alert">
          {error}
          <button
            className="learn-icon"
            title="Retry campaigns"
            aria-label="Retry campaigns"
            onClick={() => void load()}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      ) : !campaigns ? (
        <p role="status">Loading campaigns...</p>
      ) : campaigns.length ? (
        <div className="learn-catalog">
          {campaigns.map((campaign) => (
            <Link href={`/learn/studio/${campaign.id}`} key={campaign.id}>
              <div>
                <p className="learn-kicker">
                  Revision {campaign.revision} /{" "}
                  {campaign.status === "APPROVED"
                    ? "Content approved"
                    : "Needs review"}
                </p>
                <h2>{campaign.title}</h2>
              </div>
              <ArrowRight size={20} />
            </Link>
          ))}
        </div>
      ) : (
        <section className="learn-empty">
          <h2>No campaigns yet.</h2>
          <p>Your first lesson starts with its source material.</p>
        </section>
      )}
    </>
  );
}
