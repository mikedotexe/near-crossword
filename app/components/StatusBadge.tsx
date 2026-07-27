import type { CampaignState } from "../lib/types";

const labels: Record<CampaignState, string> = {
  draft: "Draft",
  awaiting_funding: "Funding required",
  scheduled: "Opens soon",
  active: "Open",
  claiming: "Claim in progress",
  claimed: "Prize claimed",
  refunding: "Refund in progress",
  refunded: "Refunded",
  expired: "Ended",
};

export function StatusBadge({
  state,
  compact = false,
}: {
  state: CampaignState;
  compact?: boolean;
}) {
  const live = ["scheduled", "active", "claiming", "claimed"].includes(state);
  return (
    <span
      className={`status-badge status-badge--${live ? "funded" : state}${
        compact ? " status-badge--compact" : ""
      }`}
    >
      {live && <span aria-hidden="true">◆</span>}
      {labels[state]}
    </span>
  );
}
