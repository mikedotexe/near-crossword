import type { Pool } from "pg";
import { decodeEventLog, toEventSelector, toHex, type Hex } from "viem";
import { learningRewardsAbi } from "../../lib/base/escrow-abi";
import type { BaseClaim } from "../../lib/base/claim";
import type { BaseChainReader, ChainBinding } from "./issuer";
import { transaction } from "./database";
import { accountingJson } from "./chain-events";
import { chainFailure, deploymentPins, type BaseAccountingReader } from "./chain-reader";

// Use this wrapper for funding/issuance. A direct RPC result must not bypass a halted ledger.
export class ReconciledBaseChainReader implements BaseChainReader {
  get maxFinalizedLagSeconds() { return this.chain.maxFinalizedLagSeconds; }
  constructor(private readonly pool: Pool, private readonly chain: BaseAccountingReader) {}
  private async checkpoint(binding: ChainBinding) {
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `SELECT d.*, s.accounting, s.block_hash AS snapshot_hash FROM base_chain_deployments d
         JOIN base_chain_campaign_snapshots s ON s.deployment_id = d.id
         WHERE d.chain_id = $1 AND d.escrow = $2 AND s.on_chain_id = $3`,
        [binding.chainId, binding.escrow.toLowerCase(), binding.onChainId.toString()],
      );
      const row = result.rows[0];
      const now = Date.now();
      if (!row || row.state !== "HEALTHY" || !row.finalized_hash || row.snapshot_hash !== row.finalized_hash ||
          !row.checked_at || new Date(row.checked_at).getTime() < now - 60000 || new Date(row.checked_at).getTime() > now + 5000) chainFailure("BASE_ACCOUNTING_NOT_READY");
      const pins = deploymentPins(this.chain.deployment);
      if (Object.entries(pins).some(([key, value]) => row.pins[key] !== value)) chainFailure("BASE_ACCOUNTING_NOT_READY");
      return row;
    });
  }
  async readFinalizedCampaign(binding: ChainBinding, signal: AbortSignal) {
    signal.throwIfAborted();
    const before = await this.checkpoint(binding);
    const state = await this.chain.readFinalizedCampaign(binding, signal);
    if (state.blockHash !== before.finalized_hash || state.blockNumber.toString() !== before.finalized_number) chainFailure("BASE_ACCOUNTING_NOT_READY");
    const json = JSON.parse(accountingJson(state)) as Record<string, unknown>;
    for (const key of ["blockHash", "blockNumber", "blockTimestamp", "observedAt"]) delete json[key];
    if (Object.keys(json).length !== Object.keys(before.accounting).length ||
        Object.entries(json).some(([key, value]) => before.accounting[key] !== value)) chainFailure("BASE_ACCOUNTING_NOT_READY");
    const after = await this.checkpoint(binding);
    if (before.version !== after.version) chainFailure("BASE_ACCOUNTING_NOT_READY");
    signal.throwIfAborted();
    return state;
  }
  async readClaimUse(binding: ChainBinding, claim: BaseClaim, blockHash: Hex, signal: AbortSignal) {
    signal.throwIfAborted();
    const before = await this.checkpoint(binding);
    if (before.finalized_hash !== blockHash) chainFailure("BASE_ACCOUNTING_NOT_READY");
    const result = await this.chain.readClaimUse(binding, claim, blockHash, signal);
    const after = await this.checkpoint(binding);
    if (before.version !== after.version) chainFailure("BASE_ACCOUNTING_NOT_READY");
    signal.throwIfAborted();
    return result;
  }

  async readRewardReceipt(binding: ChainBinding, claim: BaseClaim, blockHash: Hex, signal: AbortSignal) {
    const before = await this.checkpoint(binding);
    if (before.finalized_hash !== blockHash) chainFailure("BASE_ACCOUNTING_NOT_READY");
    const used = await this.readClaimUse(binding, claim, blockHash, signal);
    const rows = await transaction(this.pool, (client) => client.query(
      `SELECT e.*, b.block_number FROM base_chain_events e JOIN base_chain_blocks b
       ON b.deployment_id = e.deployment_id AND b.block_hash = e.block_hash
       WHERE e.deployment_id = $1 AND b.canonical AND b.block_number <= $2
         AND e.topics->>0 = $3 AND e.topics->>1 = $4 AND (e.topics->>2 = $5 OR e.topics->>3 = $6)
       LIMIT 3`,
      [before.id, before.finalized_number, toEventSelector("RewardPaid(uint256,uint32,bytes32,address,uint256)"),
        toHex(binding.onChainId, { size: 32 }), toHex(claim.slot, { size: 32 }), claim.participantId]));
    const after = await this.checkpoint(binding);
    if (before.version !== after.version) chainFailure("BASE_ACCOUNTING_NOT_READY");
    signal.throwIfAborted();
    if (!used.slotUsed && !used.participantUsed && rows.rowCount === 0) return null;
    if (!used.slotUsed || !used.participantUsed || rows.rowCount !== 1) chainFailure("BASE_ACCOUNTING_NOT_READY");
    const row = rows.rows[0];
    let decoded;
    try { decoded = decodeEventLog({ abi: learningRewardsAbi, data: row.data, topics: row.topics, strict: true }); }
    catch { chainFailure("BASE_ACCOUNTING_NOT_READY"); }
    if (decoded.eventName !== "RewardPaid" || decoded.args.campaignId !== binding.onChainId || decoded.args.slot !== claim.slot ||
        decoded.args.participantId !== claim.participantId || decoded.args.recipient.toLowerCase() !== claim.recipient.toLowerCase() ||
        decoded.args.amount !== claim.amount) chainFailure("BASE_ACCOUNTING_NOT_READY");
    return { transactionHash: row.transaction_hash as Hex, blockHash: row.block_hash as Hex, blockNumber: row.block_number as string,
      logIndex: row.log_index as number, recipient: claim.recipient, amountAtomic: claim.amount.toString() };
  }
}
