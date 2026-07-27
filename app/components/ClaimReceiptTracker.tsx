"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getClaimStatus } from "../lib/api";
import type { Campaign, CampaignClaim } from "../lib/types";

const terminalStatuses = new Set(["PAID", "RECOVERED", "FAILED", "EXPIRED"]);

function statusCopy(status: CampaignClaim["status"]): string {
  if (status === "PAID") {
    return "The payout reached its chosen destination and the terminal receipt is recorded.";
  }
  if (status === "RECOVERED") {
    return "The route did not settle, so the prize was returned to the winner-controlled NEAR recovery account.";
  }
  if (status === "FAILED") {
    return "The route needs recovery review. Delivery is not claimed without a terminal downstream receipt.";
  }
  if (status === "EXPIRED") {
    return "The payout quote expired before a valid claim could settle.";
  }
  if (status === "PAYING") {
    return "The prize left escrow and is routing. It is not marked delivered until the downstream route is terminal.";
  }
  if (status === "SUBMITTED") {
    return "The claim is queued for final on-chain submission.";
  }
  return "The short-lived claim is awaiting its solution proof.";
}

function nearExplorerUrl(hash: string): string | null {
  const configured = process.env.NEXT_PUBLIC_NEAR_NETWORK;
  if (configured !== "mainnet" && configured !== "testnet") return null;
  return `https://${
    configured === "testnet" ? "testnet." : ""
  }nearblocks.io/txns/${encodeURIComponent(hash)}`;
}

export function ClaimReceiptTracker({
  campaign,
  claimId,
}: {
  campaign: Campaign;
  claimId: string;
}) {
  const [claim, setClaim] = useState<CampaignClaim | null>(null);
  const [message, setMessage] = useState(
    "Recovering the public payout receipt…",
  );
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const next = await getClaimStatus(claimId);
    if (next.campaignId !== campaign.id) {
      throw new Error("This receipt does not belong to this campaign.");
    }
    setClaim(next);
    setMessage(statusCopy(next.status));
    return next;
  }, [campaign.id, claimId]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const next = await refresh();
        if (!active || terminalStatuses.has(next.status)) return;
        timer = setTimeout(poll, 4_000);
      } catch (error) {
        if (!active) return;
        setMessage(
          error instanceof Error
            ? error.message
            : "The payout receipt is temporarily unavailable.",
        );
        timer = setTimeout(poll, 8_000);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  async function refreshNow() {
    setBusy(true);
    setMessage("Checking the latest terminal receipt…");
    try {
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The payout receipt is temporarily unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }

  const contractUrl = claim?.contractTxHash
    ? nearExplorerUrl(claim.contractTxHash)
    : null;

  return (
    <section className="state-page">
      <div className="shell state-card">
        {campaign.isDemo ? (
          <span className="demo-label">Illustrative receipt preview</span>
        ) : null}
        <p className="eyebrow">Winner payout receipt</p>
        <h1>{campaign.title}</h1>
        <p>{message}</p>
        <dl className="quote-card">
          <div>
            <dt>Claim</dt>
            <dd>
              <code>{claimId}</code>
            </dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{claim?.status ?? "LOADING"}</dd>
          </div>
          {claim?.contractTxHash ? (
            <div>
              <dt>Escrow transaction</dt>
              <dd>
                {contractUrl ? (
                  <a href={contractUrl} rel="noreferrer" target="_blank">
                    {claim.contractTxHash}
                  </a>
                ) : (
                  <code>{claim.contractTxHash}</code>
                )}
              </dd>
            </div>
          ) : null}
          {claim?.settlementTxHash ? (
            <div>
              <dt>Destination receipt</dt>
              <dd>
                <code>{claim.settlementTxHash}</code>
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="state-card__actions">
          <button
            className="button button--ink"
            disabled={busy}
            onClick={refreshNow}
            type="button"
          >
            {busy ? "Checking…" : "Refresh receipt"}
          </button>
          <a
            className="button button--paper"
            href={`/api/v2/claims/${encodeURIComponent(claimId)}`}
            rel="noreferrer"
            target="_blank"
          >
            Open receipt record
          </a>
          <Link
            className="text-link"
            href={`/campaigns/${campaign.slug}`}
          >
            Campaign evidence →
          </Link>
        </div>
      </div>
    </section>
  );
}
