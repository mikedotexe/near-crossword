import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import {
  encodeFunctionData,
  hashTypedData,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import { baseClaimTypedData, type BaseClaim } from "../../lib/base/claim";
import { learningRewardsAbi } from "../../lib/base/escrow-abi";
import { bounded } from "./bounded";
import { transaction } from "./database";
import { matchingState, type BaseChainReader } from "./issuer";
import { participantCampaign } from "./participant-repository";
import { realUserId, sha256, validId } from "./review";
import {
  parseSponsorshipRequest,
  sponsorshipDenied,
  sponsorshipPolicyHash,
  sponsorshipUnavailable,
  validateClaimOperation,
  validatePaymasterResult,
  type SponsorshipOperation,
  type SponsorshipPolicy,
  type SponsorshipRequest,
} from "./sponsorship-policy";

type AccountVerifier = {
  verifySponsorshipAccount(
    op: SponsorshipOperation,
    policy: SponsorshipPolicy,
    blockHash: Hex,
    signal: AbortSignal,
  ): Promise<void>;
};
export type PaymasterResult = ReturnType<typeof validatePaymasterResult>;
export type PaymasterUpstream = (
  request: SponsorshipRequest,
  signal: AbortSignal,
) => Promise<unknown>;

export function cdpPaymasterUpstream(
  url: string,
  fetcher: typeof fetch = fetch,
): PaymasterUpstream {
  return async (request, signal) => {
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        redirect: "error",
        signal,
        // The permit, cookies, origin, RPC id and any caller-selected URL stay here.
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: request.method,
          params: [...request.params.slice(0, 3), {}],
        }),
      });
      if (!response.ok || !response.body) sponsorshipUnavailable();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 32768) {
            await reader.cancel();
            sponsorshipUnavailable();
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (body.jsonrpc !== "2.0" || body.id !== 1 || body.error || !body.result)
        sponsorshipUnavailable();
      return body.result;
    } catch {
      sponsorshipUnavailable();
    }
  };
}

export class ClaimSponsorship {
  constructor(
    private readonly pool: Pool,
    private readonly chain: BaseChainReader,
    private readonly accounts: AccountVerifier,
    private readonly policy: SponsorshipPolicy,
    private readonly upstream: PaymasterUpstream,
  ) {}

  private async load(userId: string, campaignId: string, digest: string) {
    realUserId(userId);
    validId(campaignId);
    if (!/^0x[0-9a-f]{64}$/.test(digest)) sponsorshipDenied();
    const loaded = await transaction(this.pool, async (client) => {
      const campaign = await participantCampaign(client, campaignId);
      const rows = await client.query(
        `SELECT r.*, a.signer_epoch, a.digest, a.signature, a.typed_data, a.signer
         FROM base_reward_allocations r JOIN base_reward_authorizations a ON a.allocation_id = r.id
         JOIN users u ON u.id = r.user_id
         WHERE r.campaign_id = $1 AND r.user_id = $2 AND a.digest = $3 AND a.signature IS NOT NULL
           AND u.email_verified IS NOT NULL AND u.email_verified <= NOW()`,
        [campaignId, userId, digest],
      );
      if (rows.rowCount !== 1) sponsorshipDenied();
      return { ...campaign, row: rows.rows[0] };
    });
    const { binding, review, row } = loaded;
    if (
      binding.chainId !== this.policy.chainId ||
      binding.escrow.toLowerCase() !== this.policy.escrow.toLowerCase()
    )
      sponsorshipDenied();
    const state = await bounded(
      (signal) => this.chain.readFinalizedCampaign(binding, signal),
      10000,
    );
    matchingState(review, binding, state, this.chain.maxFinalizedLagSeconds);
    const now = Math.floor(Date.now() / 1000);
    if (
      state.paused ||
      state.closed ||
      state.startsAt > now ||
      state.claimDeadline <= now + 30 ||
      state.signerEpoch !== BigInt(row.signer_epoch) ||
      state.signer.toLowerCase() !== row.signer
    )
      sponsorshipDenied();
    const claim: BaseClaim = {
      campaignId: binding.onChainId,
      slot: Number(row.slot),
      participantId: row.participant_id,
      recipient: row.recipient,
      amount: BigInt(row.amount),
      deadline: BigInt(row.deadline),
      signerEpoch: BigInt(row.signer_epoch),
    };
    const typedData = baseClaimTypedData(
      binding.chainId,
      binding.escrow,
      claim,
    );
    if (
      hashTypedData(typedData) !== digest ||
      hashTypedData(row.typed_data) !== digest ||
      claim.amount !== state.rewardAtomic ||
      claim.deadline !== BigInt(state.claimDeadline) ||
      !(await verifyTypedData({
        ...typedData,
        address: state.signer,
        signature: row.signature,
      }))
    )
      sponsorshipDenied();
    const used = await bounded(
      (signal) =>
        this.chain.readClaimUse(binding, claim, state.blockHash, signal),
      10000,
    );
    if (used.slotUsed || used.participantUsed) sponsorshipDenied();
    return {
      allocationId: row.id as string,
      epoch: row.signer_epoch as string,
      state,
      recipient: row.recipient as Address,
      deadline: Number(row.deadline),
      callData: encodeFunctionData({
        abi: learningRewardsAbi,
        functionName: "claim",
        args: [claim, row.signature],
      }),
    };
  }

  async permit(userId: string, campaignId: string, digest: string) {
    const loaded = await this.load(userId, campaignId, digest);
    const token = randomBytes(32).toString("hex"),
      policyHash = sponsorshipPolicyHash(this.policy);
    const expiresAt = await transaction(this.pool, async (client) => {
      // Serialize initial creation and refresh even before the permit row exists.
      await client.query(
        "SELECT id FROM base_reward_allocations WHERE id = $1 FOR UPDATE",
        [loaded.allocationId],
      );
      const saved = await client.query(
        "SELECT * FROM base_gas_sponsorships WHERE allocation_id = $1 FOR UPDATE",
        [loaded.allocationId],
      );
      const row = saved.rows[0],
        now = Math.floor(Date.now() / 1000);
      let expiry = Math.min(now + 600, loaded.deadline);
      if (row) {
        if (row.digest !== digest || row.policy_hash !== policyHash)
          sponsorshipDenied();
        const priorExpiry = Math.floor(
          new Date(row.expires_at).getTime() / 1000,
        );
        if (row.operation_identity) {
          // Never renew a possibly signed operation. Its nonce, allowance and deadline survive restarts.
          if (priorExpiry <= now + 30) sponsorshipDenied();
          expiry = priorExpiry;
        }
        await client.query(
          "UPDATE base_gas_sponsorships SET token_hash = $2, expires_at = to_timestamp($3) WHERE allocation_id = $1",
          [loaded.allocationId, sha256(token), expiry],
        );
      } else {
        await client.query(
          `INSERT INTO base_gas_sponsorships (allocation_id, signer_epoch, digest, policy_hash, token_hash, expires_at)
          VALUES ($1, $2, $3, $4, $5, to_timestamp($6))`,
          [
            loaded.allocationId,
            loaded.epoch,
            digest,
            policyHash,
            sha256(token),
            expiry,
          ],
        );
      }
      return expiry;
    });
    return { token, expiresAt, digest };
  }

  async proxy(raw: unknown): Promise<PaymasterResult> {
    const request = parseSponsorshipRequest(raw),
      tokenHash = sha256(request.params[3].token);
    const rows = await transaction(this.pool, (client) =>
      client.query(
        `SELECT s.*, r.campaign_id, r.user_id::TEXT FROM base_gas_sponsorships s
       JOIN base_reward_allocations r ON r.id = s.allocation_id WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
        [tokenHash],
      ),
    );
    const permit = rows.rows[0];
    if (!permit || permit.policy_hash !== sponsorshipPolicyHash(this.policy))
      sponsorshipDenied();
    const loaded = await this.load(
      permit.user_id,
      permit.campaign_id,
      permit.digest,
    );
    const identity = validateClaimOperation(request, loaded, this.policy);
    await bounded(
      (signal) =>
        this.accounts.verifySponsorshipAccount(
          request.params[0],
          this.policy,
          loaded.state.blockHash,
          signal,
        ),
      15000,
    );
    const expiresAt = Math.floor(new Date(permit.expires_at).getTime() / 1000);
    const decision = await transaction(this.pool, async (client) => {
      // One deployment-wide lock makes global/account quota reservation atomic across different allocations.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`base-gas:${this.policy.chainId}:${this.policy.escrow.toLowerCase()}`],
      );
      const current = await client.query(
        "SELECT * FROM base_gas_sponsorships WHERE allocation_id = $1 FOR UPDATE",
        [loaded.allocationId],
      );
      const row = current.rows[0];
      if (
        !row ||
        row.token_hash !== tokenHash ||
        row.policy_hash !== sponsorshipPolicyHash(this.policy) ||
        new Date(row.expires_at).getTime() <= Date.now() + 10000 ||
        row.digest !== permit.digest
      )
        sponsorshipDenied();
      if (
        row.operation_identity &&
        row.operation_identity !== identity.identity
      )
        sponsorshipDenied();
      const previous = await client.query(
        "SELECT * FROM base_gas_requests WHERE allocation_id = $1 AND request_hash = $2",
        [loaded.allocationId, identity.requestHash],
      );
      if (previous.rowCount) {
        if (previous.rows[0].state !== "READY") sponsorshipUnavailable();
        return { cached: previous.rows[0].result as PaymasterResult };
      }
      const uncertain = await client.query(
        "SELECT 1 FROM base_gas_requests WHERE allocation_id = $1 AND state <> 'READY' LIMIT 1",
        [loaded.allocationId],
      );
      if (uncertain.rowCount) sponsorshipUnavailable();
      if (row.final_request_hash || row.attempts >= 12) sponsorshipDenied();
      if (!row.operation_identity) {
        const usage = await client.query(
          `SELECT COALESCE(SUM(s.reserved_wei), 0)::TEXT AS total,
             COUNT(*) FILTER (WHERE r.recipient = $3 AND s.reserved_wei > 0)::INTEGER AS account_count
           FROM base_gas_sponsorships s JOIN base_reward_allocations r ON r.id = s.allocation_id
           JOIN base_reward_campaigns c ON c.campaign_id = r.campaign_id WHERE c.chain_id = $1 AND c.escrow = $2`,
          [
            this.policy.chainId,
            this.policy.escrow.toLowerCase(),
            loaded.recipient,
          ],
        );
        if (
          BigInt(usage.rows[0].total) + this.policy.maxOperationWei >
            this.policy.totalBudgetWei ||
          usage.rows[0].account_count >= this.policy.maxOperationsPerAccount
        )
          sponsorshipDenied();
      }
      await client.query(
        `UPDATE base_gas_sponsorships SET operation_identity = $2,
        reserved_wei = CASE WHEN reserved_wei = 0 THEN $3 ELSE reserved_wei END, attempts = attempts + 1,
        final_request_hash = CASE WHEN $4 THEN $5 ELSE final_request_hash END WHERE allocation_id = $1`,
        [
          loaded.allocationId,
          identity.identity,
          this.policy.maxOperationWei.toString(),
          request.method === "pm_getPaymasterData",
          identity.requestHash,
        ],
      );
      await client.query(
        "INSERT INTO base_gas_requests (allocation_id, request_hash, method, state) VALUES ($1, $2, $3, 'IN_FLIGHT')",
        [loaded.allocationId, identity.requestHash, request.method],
      );
      return { cached: null };
    });
    if (decision.cached)
      return validatePaymasterResult(
        decision.cached,
        this.policy,
        expiresAt,
        request.method === "pm_getPaymasterStubData",
      );
    try {
      const response = await bounded(
        (signal) => this.upstream(request, signal),
        15000,
      );
      const result = validatePaymasterResult(
        response,
        this.policy,
        expiresAt,
        request.method === "pm_getPaymasterStubData",
      );
      // Recheck after the provider call; rotation/payment or a stale scanner must not escape as success.
      const latest = await this.load(
        permit.user_id,
        permit.campaign_id,
        permit.digest,
      );
      await bounded(
        (signal) =>
          this.accounts.verifySponsorshipAccount(
            request.params[0],
            this.policy,
            latest.state.blockHash,
            signal,
          ),
        15000,
      );
      validatePaymasterResult(
        result,
        this.policy,
        expiresAt,
        request.method === "pm_getPaymasterStubData",
      );
      await transaction(this.pool, async (client) => {
        await client.query(
          "UPDATE base_gas_requests SET state = 'READY', result = $3 WHERE allocation_id = $1 AND request_hash = $2 AND state = 'IN_FLIGHT'",
          [loaded.allocationId, identity.requestHash, result],
        );
        if (result.isFinal)
          await client.query(
            "UPDATE base_gas_sponsorships SET final_request_hash = $2 WHERE allocation_id = $1",
            [loaded.allocationId, identity.requestHash],
          );
      });
      return result;
    } catch {
      await transaction(this.pool, (client) =>
        client.query(
          "UPDATE base_gas_requests SET state = 'UNKNOWN' WHERE allocation_id = $1 AND request_hash = $2 AND state = 'IN_FLIGHT'",
          [loaded.allocationId, identity.requestHash],
        ),
      ).catch(() => undefined);
      sponsorshipUnavailable();
    }
  }
}
