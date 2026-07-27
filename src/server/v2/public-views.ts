import type { Campaign, Claim, JsonValue } from "./types";

const PUBLIC_CLAIM_EVIDENCE_FIELDS = new Set([
  "contractState",
  "contractClaimNonce",
  "providerStatus",
  "downstreamStatus",
  "destinationTxHash",
  "destinationTransactionHash",
  "refundTxHash",
  "recoveryTxHash",
  "settlementReceiptDigest",
  "providerReceiptDigest",
  "outputAmountAtomic",
  "amountOutAtomic",
  "recoveredAmountAtomic",
]);

function publicClaimEvidence(value: JsonValue): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, item]) =>
        PUBLIC_CLAIM_EVIDENCE_FIELDS.has(key) &&
        (item === null ||
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"),
    ),
  );
}

/**
 * Anonymous polling deliberately returns only lifecycle and receipt evidence.
 * The signed proof, payout quote, deposit/recovery addresses and claimant
 * identifiers stay in the private workflow ledger.
 */
export function publicClaimView(claim: Claim) {
  return {
    id: claim.id,
    campaignId: claim.campaignId,
    status: claim.status,
    contractTxHash: claim.contractTxHash,
    settlementTxHash: claim.settlementTxHash,
    evidence: publicClaimEvidence(claim.evidence),
  };
}

/**
 * Public discovery needs the puzzle commitment and campaign terms, not the
 * creator's database identity or private recovery/accounting fields.
 */
export function publicCampaignView(campaign: Campaign) {
  return {
    id: campaign.id,
    slug: campaign.slug,
    title: campaign.title,
    description: campaign.description,
    sponsorName: campaign.sponsorName,
    sponsorUrl: campaign.sponsorUrl,
    visibility: campaign.visibility,
    status: campaign.status,
    puzzle: campaign.puzzle,
    contentHash: campaign.contentHash,
    solutionPublicKey: campaign.solutionPublicKey,
    reward: campaign.reward,
    contractId: campaign.contractId,
    openingAt: campaign.openingAt,
    expiresAt: campaign.expiresAt,
    fundingReference: campaign.fundingReference,
    chainCampaignId: campaign.chainCampaignId,
    aiGenerationReceipt: campaign.aiGenerationReceipt,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
}
