import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { getAddress, hashTypedData, verifyTypedData, type Address, type Hex } from "viem";
import { baseClaimDigest, baseClaimTypedData, type BaseClaim } from "../../lib/base/claim";
import { AppError } from "../v2/errors";
import { assertPublished, conflict, notFound, transaction } from "./database";
import { realUserId, validId } from "./review";
import { currentReview, type PrivateReview } from "./review-repository";
import { bounded } from "./bounded";

export interface ChainBinding { chainId: number; escrow: Address; onChainId: bigint }
export interface FinalizedCampaignState extends ChainBinding {
  token: Address;
  sponsor: Address;
  rewardAtomic: bigint;
  maxClaims: number;
  startsAt: number;
  endsAt: number;
  claimDeadline: number;
  termsHash: Hex;
  fundedAtomic: bigint;
  outstandingAtomic: bigint;
  refundedAtomic: bigint;
  paidCount: number;
  signer: Address;
  signerEpoch: bigint;
  paused: boolean;
  closed: boolean;
  blockHash: Hex;
  blockNumber: bigint;
  blockTimestamp: number;
  observedAt: number;
}

// Trusted server ports, never implemented from browser-supplied receipts or flags.
// RpcBaseChainReader pins deployment/token/code and reads canonical finalized state.
export interface BaseChainReader {
  // Deployment-reviewed policy, not an assumed Base finality duration.
  maxFinalizedLagSeconds: number;
  readFinalizedCampaign(binding: ChainBinding, signal: AbortSignal): Promise<FinalizedCampaignState>;
  readClaimUse(binding: ChainBinding, claim: BaseClaim, blockHash: Hex, signal: AbortSignal): Promise<{ slotUsed: boolean; participantUsed: boolean }>;
}
export interface EligibilityVerifier {
  // Must check completion for this revision, abuse policy, and fresh recipient-control proof
  // bound to this authenticated user/campaign. Return an opaque private audit receipt, not answers.
  verify(input: { campaignId: string; revision: number; userId: string; recipient: Address; proof: unknown }, signal: AbortSignal): Promise<{ receiptId: string }>;
}
export interface BaseClaimSigner {
  address: Address;
  sign(data: ReturnType<typeof baseClaimTypedData>, signal: AbortSignal): Promise<Hex>;
}

function sameAddress(a: string, b: string) { return a.toLowerCase() === b.toLowerCase(); }
function unixNow() { return Math.floor(Date.now() / 1000); }
function freshState(state: FinalizedCampaignState, maxFinalizedLagSeconds: number) {
  const now = unixNow();
  if (!Number.isSafeInteger(maxFinalizedLagSeconds) || maxFinalizedLagSeconds <= 0 ||
      !Number.isSafeInteger(state.observedAt) || !Number.isSafeInteger(state.blockTimestamp) ||
      state.observedAt > now + 5 || state.observedAt < now - 60 ||
      state.blockTimestamp > now + 30 || state.blockTimestamp < now - maxFinalizedLagSeconds ||
      !/^0x[0-9a-f]{64}$/.test(state.blockHash) || state.blockNumber < 0n) {
    conflict("Fresh finalized chain state is required");
  }
}

export function matchingState(review: PrivateReview, binding: ChainBinding, state: FinalizedCampaignState, maxFinalizedLagSeconds: number) {
  freshState(state, maxFinalizedLagSeconds);
  const terms = review.submission.terms;
  if (state.chainId !== binding.chainId || !sameAddress(state.escrow, binding.escrow) || state.onChainId !== binding.onChainId ||
      state.chainId !== terms.chainId || !sameAddress(state.escrow, terms.escrow) ||
      !sameAddress(state.token, terms.token) || !sameAddress(state.sponsor, terms.sponsor) || state.termsHash !== review.termsHash ||
      state.rewardAtomic !== BigInt(terms.rewardAtomic) || state.maxClaims !== terms.maxClaims ||
      state.startsAt !== terms.startsAt || state.endsAt !== terms.endsAt || state.claimDeadline !== terms.claimDeadline ||
      state.fundedAtomic !== BigInt(terms.rewardAtomic) * BigInt(terms.maxClaims) ||
      !Number.isInteger(state.paidCount) || state.paidCount < 0 || state.paidCount > terms.maxClaims ||
      state.outstandingAtomic < 0n || state.refundedAtomic < 0n ||
      state.outstandingAtomic + state.refundedAtomic + BigInt(state.paidCount) * state.rewardAtomic !== state.fundedAtomic ||
      state.signerEpoch <= 0n || state.signerEpoch >= 1n << 64n) {
    conflict("Finalized funding does not match the approved campaign");
  }
}

function available(state: FinalizedCampaignState) {
  if (state.paused || state.closed || unixNow() < state.startsAt || unixNow() > state.claimDeadline) {
    conflict("Campaign is not accepting reward authorizations");
  }
}

function bindingFromRow(row: QueryResultRow): ChainBinding {
  return { chainId: row.chain_id, escrow: row.escrow, onChainId: BigInt(row.on_chain_id) };
}
function claimFromRow(row: QueryResultRow, onChainId: bigint, epoch: bigint): BaseClaim {
  return {
    campaignId: onChainId, slot: Number(row.slot), participantId: row.participant_id,
    recipient: row.recipient, amount: BigInt(row.amount), deadline: BigInt(row.deadline), signerEpoch: epoch,
  };
}
function jsonTypedData(data: ReturnType<typeof baseClaimTypedData>) {
  return {
    ...data,
    message: {
      ...data.message, campaignId: data.message.campaignId.toString(), amount: data.message.amount.toString(),
      deadline: data.message.deadline.toString(), signerEpoch: data.message.signerEpoch.toString(),
    },
  };
}

export class BaseRewardIssuer {
  constructor(
    private readonly pool: Pool,
    private readonly chain: BaseChainReader,
    private readonly eligibility?: EligibilityVerifier,
    private readonly signer?: BaseClaimSigner,
    private readonly requirePublication = false,
  ) {}

  async bindApprovedCampaign(ownerId: string, campaignId: string, onChainId: bigint, expected?: { revision: number; termsHash: string; layoutHash: string }) {
    realUserId(ownerId); validId(campaignId);
    if (onChainId <= 0n || onChainId >= 1n << 256n) conflict("Invalid on-chain campaign identifier");
    const review = await transaction(this.pool, (client) => currentReview(client, campaignId, ownerId));
    if (expected && (review.revision !== expected.revision || review.termsHash !== expected.termsHash)) conflict("Reviewed funding material changed");
    if (review.status !== "APPROVED") conflict("Human approval is required before binding funding");
    const binding = { chainId: review.submission.terms.chainId, escrow: review.submission.terms.escrow as Address, onChainId };
    const state = await this.readState(binding);
    matchingState(review, binding, state, this.chain.maxFinalizedLagSeconds);
    if (state.closed || state.paused || state.paidCount !== 0 || state.signerEpoch !== 1n ||
        !sameAddress(state.signer, review.submission.terms.initialSigner)) {
      conflict("Bind untouched funding before enabling reward issuance");
    }
    return transaction(this.pool, async (client) => {
      const current = await currentReview(client, campaignId, ownerId);
      if (current.status !== "APPROVED" || current.revision !== review.revision || current.termsHash !== review.termsHash) {
        conflict("Review changed during funding verification");
      }
      freshState(state, this.chain.maxFinalizedLagSeconds);
      if (expected) {
        const layout = await client.query("SELECT layout_hash, terms_hash FROM base_learning_layouts WHERE campaign_id = $1 AND revision = $2", [campaignId, current.revision]);
        if (current.revision !== expected.revision || layout.rows[0]?.layout_hash !== expected.layoutHash || layout.rows[0]?.terms_hash !== expected.termsHash) conflict("Approve the current layout before linking funding");
      }
      const existing = await client.query("SELECT * FROM base_reward_campaigns WHERE campaign_id = $1", [campaignId]);
      if (existing.rowCount) {
        const previous = bindingFromRow(existing.rows[0]);
        if (previous.onChainId !== onChainId) conflict("Campaign funding is already bound");
        return previous;
      }
      await client.query(
        `INSERT INTO base_reward_campaigns
           (campaign_id, revision, chain_id, escrow, on_chain_id, funding_block_hash, funding_block_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [campaignId, review.revision, binding.chainId, binding.escrow, onChainId.toString(), state.blockHash, state.blockNumber.toString()],
      );
      return binding;
    });
  }

  private async load(client: PoolClient, campaignId: string) {
    // Consistent lock order with review edits and binding: review row, then reward row.
    const review = await currentReview(client, campaignId);
    const result = await client.query("SELECT * FROM base_reward_campaigns WHERE campaign_id = $1 FOR UPDATE", [campaignId]);
    if (!result.rowCount) notFound();
    if (result.rows[0].revision !== review.revision || review.status !== "APPROVED") conflict("Approved funding is required");
    return { review, binding: bindingFromRow(result.rows[0]), nextSlot: Number(result.rows[0].next_slot) };
  }

  private async readState(binding: ChainBinding) {
    try { return await bounded((signal) => this.chain.readFinalizedCampaign(binding, signal), 10000); }
    catch { throw new AppError(503, "BASE_CHAIN_UNAVAILABLE", "Finalized reward state is unavailable"); }
  }

  private async assertUnused(binding: ChainBinding, claim: BaseClaim, state: FinalizedCampaignState) {
    let used;
    try { used = await bounded((signal) => this.chain.readClaimUse(binding, claim, state.blockHash, signal), 10000); }
    catch { throw new AppError(503, "BASE_CHAIN_UNAVAILABLE", "Finalized reward state is unavailable"); }
    if (used.slotUsed || used.participantUsed) conflict("Reward is already consumed on-chain; reconcile its receipt");
  }

  async issue(input: { campaignId: string; userId: string; recipient: Address; proof: unknown }) {
    const signer = this.signer, eligibility = this.eligibility;
    if (!signer || !eligibility) throw new AppError(503, "BASE_ISSUANCE_UNAVAILABLE", "Reward signing is not configured");
    validId(input.campaignId); realUserId(input.userId);
    let recipient: Address;
    try {
      recipient = getAddress(input.recipient).toLowerCase() as Address;
      if (BigInt(recipient) === 0n) throw new Error();
    } catch { throw new AppError(400, "INVALID_RECIPIENT", "A valid reward recipient is required"); }
    const loaded = await transaction(this.pool, (client) => this.load(client, input.campaignId));
    if (sameAddress(recipient, loaded.binding.escrow)) conflict("Escrow cannot be the reward recipient");
    const state = await this.readState(loaded.binding);
    matchingState(loaded.review, loaded.binding, state, this.chain.maxFinalizedLagSeconds); available(state);
    if (!sameAddress(signer.address, state.signer)) conflict("The current eligibility signer is not configured");

    let receiptId: string;
    try {
      const verified = await bounded((signal) => eligibility.verify({ ...input, recipient, revision: loaded.review.revision }, signal), 15000);
      receiptId = validId(verified.receiptId);
    } catch {
      throw new AppError(403, "BASE_ELIGIBILITY_REQUIRED", "Verified completion and wallet ownership are required");
    }

    const reserved = await transaction(this.pool, async (client) => {
      const { review, binding, nextSlot } = await this.load(client, input.campaignId);
      matchingState(review, binding, state, this.chain.maxFinalizedLagSeconds); available(state);
      const history = await client.query(
        `SELECT MAX(a.signer_epoch) AS epoch, MAX(a.checked_block_number) AS block_number
         FROM base_reward_authorizations a JOIN base_reward_allocations r ON r.id = a.allocation_id
         WHERE r.campaign_id = $1`, [input.campaignId],
      );
      if ((history.rows[0].epoch && BigInt(history.rows[0].epoch) > state.signerEpoch) ||
          (history.rows[0].block_number && BigInt(history.rows[0].block_number) > state.blockNumber)) {
        conflict("Finalized issuer state moved backwards; reconciliation is required");
      }
      const user = await client.query("SELECT email_verified FROM users WHERE id = $1 FOR SHARE", [input.userId]);
      if (!user.rows[0]?.email_verified || new Date(user.rows[0].email_verified).getTime() > Date.now()) {
        throw new AppError(403, "VERIFIED_EMAIL_REQUIRED", "Verify your email before claiming a reward");
      }
      const existing = await client.query("SELECT * FROM base_reward_allocations WHERE campaign_id = $1 AND user_id = $2", [input.campaignId, input.userId]);
      let allocation = existing.rows[0];
      if (allocation && !sameAddress(allocation.recipient, recipient)) conflict("An allocated reward cannot change recipient");
      if (!allocation) {
        if (this.requirePublication) await assertPublished(client, input.campaignId, review.revision);
        if (unixNow() >= state.endsAt) conflict("The completion and new-allocation window has ended");
        if (nextSlot >= state.maxClaims) conflict("All reward slots are allocated");
        const result = await client.query(
          `INSERT INTO base_reward_allocations
             (id, campaign_id, user_id, slot, participant_id, recipient, amount, deadline, eligibility_receipt, email_verified_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          [randomUUID(), input.campaignId, input.userId, nextSlot, `0x${randomBytes(32).toString("hex")}`, recipient,
            state.rewardAtomic.toString(), state.claimDeadline.toString(), receiptId, user.rows[0].email_verified],
        );
        allocation = result.rows[0];
        await client.query("UPDATE base_reward_campaigns SET next_slot = next_slot + 1 WHERE campaign_id = $1", [input.campaignId]);
      }
      const claim = claimFromRow(allocation, binding.onChainId, state.signerEpoch);
      const typedData = baseClaimTypedData(binding.chainId, binding.escrow, claim);
      const digest = baseClaimDigest(binding.chainId, binding.escrow, claim);
      await client.query(
        `INSERT INTO base_reward_authorizations
           (allocation_id, signer_epoch, signer, digest, typed_data, checked_block_hash, checked_block_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (allocation_id, signer_epoch) DO NOTHING`,
        [allocation.id, state.signerEpoch.toString(), state.signer.toLowerCase(), digest, jsonTypedData(typedData), state.blockHash, state.blockNumber.toString()],
      );
      const saved = await client.query("SELECT * FROM base_reward_authorizations WHERE allocation_id = $1 AND signer_epoch = $2", [allocation.id, state.signerEpoch.toString()]);
      if (saved.rows[0].digest !== digest || hashTypedData(saved.rows[0].typed_data) !== digest ||
          !sameAddress(saved.rows[0].signer, state.signer)) conflict("Saved authorization does not match the current issuer");
      return { allocationId: allocation.id as string, claim, digest, typedData, signature: saved.rows[0].signature as Hex | null };
    });

    // Commit the full tuple before any signature can escape, including a timeout or lost response.
    await this.assertUnused(loaded.binding, reserved.claim, state);
    let signature = reserved.signature;
    try {
      if (!signature) signature = await bounded((signal) => signer.sign(reserved.typedData, signal), 15000);
      if (!await verifyTypedData({ ...reserved.typedData, address: state.signer, signature })) throw new Error();
    } catch {
      throw new AppError(503, "BASE_SIGNING_UNAVAILABLE", "Reward reservation is saved; authorization can be retried");
    }
    const latest = await this.readState(loaded.binding);
    matchingState(loaded.review, loaded.binding, latest, this.chain.maxFinalizedLagSeconds); available(latest);
    if (latest.blockNumber < state.blockNumber || (latest.blockNumber === state.blockNumber && latest.blockHash !== state.blockHash)) {
      conflict("Finalized chain state changed unexpectedly; reconciliation is required");
    }
    if (latest.signerEpoch !== state.signerEpoch || !sameAddress(latest.signer, state.signer)) conflict("Issuer rotated; retry the saved reward reservation");
    await this.assertUnused(loaded.binding, reserved.claim, latest);
    const result = await transaction(this.pool, async (client) => {
      freshState(latest, this.chain.maxFinalizedLagSeconds); available(latest);
      const saved = await client.query(
        `UPDATE base_reward_authorizations SET signature = COALESCE(signature, $4), signed_at = COALESCE(signed_at, NOW())
         WHERE allocation_id = $1 AND signer_epoch = $2 AND digest = $3 RETURNING signature`,
        [reserved.allocationId, reserved.claim.signerEpoch.toString(), reserved.digest, signature],
      );
      if (!saved.rowCount) conflict("Saved authorization is missing");
      return saved.rows[0].signature as Hex;
    });
    // Only the authenticated participant/recovery service may receive this response. It is not a public view.
    return { allocationId: reserved.allocationId, status: "AUTHORIZED" as const, digest: reserved.digest, typedData: jsonTypedData(reserved.typedData), signature: result };
  }
}
