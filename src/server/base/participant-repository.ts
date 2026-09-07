import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getAddress, type Address, type Hex } from "viem";
import { createSiweMessage } from "viem/siwe";
import { AppError } from "../v2/errors";
import { bounded } from "./bounded";
import { assertPublished, conflict, notFound, transaction } from "./database";
import { matchingState, type BaseChainReader, type ChainBinding, type EligibilityVerifier } from "./issuer";
import { currentReview } from "./review-repository";
import { realUserId, sha256, validId } from "./review";
import { challengeSchema, completionSchema, consentSchema, correctAnswers, participantInput, participantOrigin, walletProofSchema } from "./participant-input";

export interface WalletControlVerifier {
  verifyWalletMessage(input: { recipient: Address; message: string; signature: Hex }, signal: AbortSignal): Promise<boolean>;
}

export async function participantCampaign(client: PoolClient, campaignId: string) {
  validId(campaignId);
  const review = await currentReview(client, campaignId);
  const result = await client.query("SELECT * FROM base_reward_campaigns WHERE campaign_id = $1 FOR UPDATE", [campaignId]);
  if (!result.rowCount) notFound();
  const row = result.rows[0];
  if (review.status !== "APPROVED" || row.revision !== review.revision) conflict("Approved funding is required");
  const binding: ChainBinding = { chainId: row.chain_id, escrow: row.escrow, onChainId: BigInt(row.on_chain_id) };
  return { review, binding, nextSlot: Number(row.next_slot) };
}

async function verifiedEmail(client: PoolClient, userId: string) {
  const result = await client.query("SELECT email, email_verified FROM users WHERE id = $1 FOR SHARE", [userId]);
  const row = result.rows[0];
  if (!row?.email || !row.email_verified || new Date(row.email_verified).getTime() > Date.now()) {
    throw new AppError(403, "VERIFIED_EMAIL_REQUIRED", "Verify your email before claiming a reward");
  }
  return row.email as string;
}

export class PostgresParticipantRepository implements EligibilityVerifier {
  constructor(private readonly pool: Pool, private readonly chain: BaseChainReader, private readonly wallet: WalletControlVerifier,
    private readonly origin: string, private readonly requirePublication = false) { participantOrigin(origin); }

  async complete(userId: string, campaignId: string, raw: unknown) {
    realUserId(userId); validId(campaignId);
    const input = participantInput(completionSchema, raw);
    const loaded = await transaction(this.pool, (client) => participantCampaign(client, campaignId));
    const state = await bounded((signal) => this.chain.readFinalizedCampaign(loaded.binding, signal), 10000);
    return transaction(this.pool, async (client) => {
      const current = await participantCampaign(client, campaignId);
      matchingState(current.review, current.binding, state, this.chain.maxFinalizedLagSeconds);
      if (current.review.revision !== input.revision) conflict("Complete the current approved revision");
      const existing = await client.query("SELECT completed_at FROM base_participant_completions WHERE campaign_id = $1 AND revision = $2 AND user_id = $3",
        [campaignId, input.revision, userId]);
      if (existing.rowCount) return { status: "COMPLETED" as const, revision: input.revision, completedAt: new Date(existing.rows[0].completed_at).toISOString() };
      if (this.requirePublication) await assertPublished(client, campaignId, input.revision);
      const now = Math.floor(Date.now() / 1000);
      if (state.closed || state.paused || now < state.startsAt || now >= state.endsAt) conflict("The completion window is not open");
      if (!correctAnswers(input.answers, current.review.submission.draft.entries.map((entry) => entry.answer))) {
        throw new AppError(422, "COMPLETION_INCORRECT", "The completed puzzle is not correct");
      }
      const result = await client.query(
        `INSERT INTO base_participant_completions (campaign_id, revision, user_id, terms_hash)
         VALUES ($1, $2, $3, $4) RETURNING completed_at`, [campaignId, input.revision, userId, current.review.termsHash]);
      return { status: "COMPLETED" as const, revision: input.revision, completedAt: new Date(result.rows[0].completed_at).toISOString() };
    });
  }

  async challenge(userId: string, campaignId: string, raw: unknown) {
    realUserId(userId); validId(campaignId);
    const input = participantInput(challengeSchema, raw);
    return transaction(this.pool, async (client) => {
      const { review, binding } = await participantCampaign(client, campaignId);
      await verifiedEmail(client, userId);
      if (input.revision !== review.revision || input.recipient === binding.escrow) conflict("Use the approved revision and a reward wallet");
      const completed = await client.query(
        "SELECT terms_hash FROM base_participant_completions WHERE campaign_id = $1 AND revision = $2 AND user_id = $3",
        [campaignId, review.revision, userId]);
      if (completed.rows[0]?.terms_hash !== review.termsHash) throw new AppError(403, "COMPLETION_REQUIRED", "Complete the approved puzzle first");
      const allocated = await client.query("SELECT recipient FROM base_reward_allocations WHERE campaign_id = $1 AND user_id = $2", [campaignId, userId]);
      if (allocated.rowCount && allocated.rows[0].recipient !== input.recipient) conflict("An allocated reward cannot change recipient");
      const now = new Date();
      const cutoff = allocated.rowCount ? review.submission.terms.claimDeadline + 1 : review.submission.terms.endsAt;
      const expiresAt = new Date(Math.min(now.getTime() + 300000, cutoff * 1000));
      if (expiresAt <= now) conflict("The reward authorization window has ended");
      const id = randomUUID();
      const message = createSiweMessage({
        domain: new URL(this.origin).host, address: getAddress(input.recipient), chainId: binding.chainId,
        version: "1", nonce: randomBytes(32).toString("hex"), uri: `${this.origin}/api/base/participants/${campaignId}/claim`,
        statement: "Verify this reward wallet for Crossword. This is not a transaction or permission to spend funds.",
        issuedAt: now, expirationTime: expiresAt,
        resources: [`urn:uuid:${id}`, `urn:crossword:campaign:${campaignId}:revision:${review.revision}`, `urn:crossword:terms:${review.termsHash}`],
      });
      await client.query(
        `INSERT INTO base_wallet_challenges (id, campaign_id, revision, user_id, recipient, origin, message, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [id, campaignId, review.revision, userId, input.recipient, this.origin, message, now, expiresAt]);
      return { challengeId: id, message, expiresAt: expiresAt.toISOString() };
    });
  }

  async verify(input: { campaignId: string; revision: number; userId: string; recipient: Address; proof: unknown }, signal: AbortSignal) {
    realUserId(input.userId); validId(input.campaignId);
    const proof = participantInput(walletProofSchema, input.proof);
    const load = async (client: PoolClient) => {
      const { review } = await participantCampaign(client, input.campaignId);
      await verifiedEmail(client, input.userId);
      const result = await client.query(
        `SELECT w.* FROM base_wallet_challenges w JOIN base_participant_completions c
         USING (campaign_id, revision, user_id)
         WHERE w.id = $1 AND w.campaign_id = $2 AND w.revision = $3 AND w.user_id = $4
           AND w.recipient = $5 AND w.origin = $6 AND w.expires_at > clock_timestamp()
           AND w.created_at <= clock_timestamp() AND c.terms_hash = $7`,
        [proof.challengeId, input.campaignId, input.revision, input.userId, input.recipient.toLowerCase(), this.origin, review.termsHash]);
      if (!result.rowCount || review.revision !== input.revision) throw new AppError(403, "WALLET_PROOF_REQUIRED", "A fresh wallet challenge is required");
      return result.rows[0];
    };
    signal.throwIfAborted();
    const challenge = await transaction(this.pool, load);
    if (!await this.wallet.verifyWalletMessage({ recipient: input.recipient, message: challenge.message, signature: proof.signature }, signal)) {
      throw new AppError(403, "WALLET_PROOF_REQUIRED", "A valid wallet signature is required");
    }
    signal.throwIfAborted();
    return transaction(this.pool, async (client) => {
      const current = await load(client);
      if (current.message !== challenge.message) conflict("Wallet challenge changed");
      const signatureHash = sha256(proof.signature);
      await client.query(
        `INSERT INTO base_participant_eligibility (id, challenge_id, signature_hash) VALUES ($1, $2, $3)
         ON CONFLICT (challenge_id) DO NOTHING`, [randomUUID(), proof.challengeId, signatureHash]);
      const saved = await client.query("SELECT id, signature_hash FROM base_participant_eligibility WHERE challenge_id = $1", [proof.challengeId]);
      if (saved.rows[0].signature_hash !== signatureHash) conflict("Wallet challenge has already been used");
      signal.throwIfAborted();
      return { receiptId: saved.rows[0].id as string };
    });
  }

  async consent(userId: string, campaignId: string, raw: unknown) {
    realUserId(userId); validId(campaignId);
    const input = participantInput(consentSchema, raw);
    return transaction(this.pool, async (client) => {
      await participantCampaign(client, campaignId);
      const latest = await client.query(
        `SELECT version, share_email, email_hash FROM base_participant_consent_events
         WHERE campaign_id = $1 AND user_id = $2 ORDER BY version DESC LIMIT 1`, [campaignId, userId]);
      const previous = latest.rows[0];
      const emailHash = input.shareEmail ? sha256((await verifiedEmail(client, userId)).trim().toLowerCase()) : null;
      if (previous?.version === input.expectedVersion + 1 && previous.share_email === input.shareEmail && previous.email_hash === emailHash) {
        return { version: previous.version as number, shareEmail: input.shareEmail };
      }
      if ((previous?.version || 0) !== input.expectedVersion) conflict("Contact preference changed; reload before updating");
      const version = input.expectedVersion + 1;
      await client.query(
        `INSERT INTO base_participant_consent_events (campaign_id, user_id, version, share_email, email_hash, policy)
         VALUES ($1, $2, $3, $4, $5, 'private-email-optional-sponsor-contact:v1')`, [campaignId, userId, version, input.shareEmail, emailHash]);
      return { version, shareEmail: input.shareEmail };
    });
  }
}
