import type { Pool } from "pg";
import type { BaseClaim } from "../../lib/base/claim";
import { bounded } from "./bounded";
import { transaction } from "./database";
import { matchingState } from "./issuer";
import { participantCampaign } from "./participant-repository";
import type { ReconciledBaseChainReader } from "./reconciled-chain-reader";
import { realUserId, sha256, validId } from "./review";

export class ParticipantRecovery {
  constructor(private readonly pool: Pool, private readonly chain: ReconciledBaseChainReader) {}
  async get(userId: string, campaignId: string) {
    realUserId(userId); validId(campaignId);
    const loaded = await transaction(this.pool, async (client) => {
      const campaign = await participantCampaign(client, campaignId);
      const allocation = await client.query("SELECT * FROM base_reward_allocations WHERE campaign_id = $1 AND user_id = $2", [campaignId, userId]);
      const completed = await client.query("SELECT 1 FROM base_participant_completions WHERE campaign_id = $1 AND revision = $2 AND user_id = $3 AND terms_hash = $4",
        [campaignId, campaign.review.revision, userId, campaign.review.termsHash]);
      const consent = await client.query("SELECT * FROM base_participant_consent_events WHERE campaign_id = $1 AND user_id = $2 ORDER BY version DESC LIMIT 1", [campaignId, userId]);
      const user = await client.query("SELECT email, email_verified FROM users WHERE id = $1", [userId]);
      const emailVerified = Boolean(user.rows[0]?.email && user.rows[0]?.email_verified && new Date(user.rows[0].email_verified).getTime() <= Date.now());
      const preference = consent.rows[0];
      return { ...campaign, allocation: allocation.rows[0], completed: Boolean(completed.rowCount), emailVerified,
        consent: { version: Number(preference?.version || 0), shareEmail: Boolean(preference?.share_email && emailVerified &&
          preference.email_hash === sha256(user.rows[0].email.trim().toLowerCase())) } };
    });
    const state = await bounded((signal) => this.chain.readFinalizedCampaign(loaded.binding, signal), 10000);
    matchingState(loaded.review, loaded.binding, state, this.chain.maxFinalizedLagSeconds);
    const common = { campaignId, revision: loaded.review.revision, completed: loaded.completed, emailVerified: loaded.emailVerified,
      consent: loaded.consent, chainId: loaded.binding.chainId, escrow: loaded.binding.escrow,
      asOf: { blockHash: state.blockHash, blockNumber: state.blockNumber.toString(), blockTimestamp: state.blockTimestamp } };
    const allocation = loaded.allocation;
    const now = Math.floor(Date.now() / 1000);
    const unavailable = state.closed ? "CLOSED" : now > state.claimDeadline ? "EXPIRED" : state.paused ? "PAUSED" : now < state.startsAt ? "NOT_STARTED" : null;
    if (!allocation) return { ...common, status: unavailable || (now >= state.endsAt ? "COMPLETION_CLOSED" : loaded.nextSlot >= state.maxClaims ? "EXHAUSTED" : "NOT_ALLOCATED") };
    const claim: BaseClaim = { campaignId: loaded.binding.onChainId, slot: Number(allocation.slot), participantId: allocation.participant_id,
      recipient: allocation.recipient, amount: BigInt(allocation.amount), deadline: BigInt(allocation.deadline), signerEpoch: state.signerEpoch };
    const receipt = await bounded((signal) => this.chain.readRewardReceipt(loaded.binding, claim, state.blockHash, signal), 10000);
    return { ...common, allocationId: allocation.id as string, recipient: claim.recipient, amountAtomic: claim.amount.toString(),
      deadline: claim.deadline.toString(), status: receipt ? "PAID" : unavailable || "RECOVERABLE", ...(receipt ? { receipt } : {}) };
  }
}
