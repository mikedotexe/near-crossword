import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import { keccak256, stringToHex } from "viem";
import { AppError } from "../v2/errors";
import { bounded } from "./bounded";
import { transaction } from "./database";
import { chainFailure, deploymentPins, type BaseAccountingReader, type ChainBlock } from "./chain-reader";
import { accountingJson, projectEscrowEvents, reconcileCampaign, reconcileTotals, type BlockEvents } from "./chain-events";

const haltCodes = new Set(["BASE_FINALITY_CONFLICT", "BASE_REORG_TOO_DEEP", "BASE_RECONCILIATION_MISMATCH"]);
const maxHistoryEvents = 100000;
function fromRow(row: QueryResultRow): ChainBlock {
  return { number: BigInt(row.block_number), hash: row.block_hash, parentHash: row.parent_hash, timestamp: Number(row.block_timestamp) };
}
function historyFromRows(rows: QueryResultRow[]): BlockEvents[] {
  const blocks = new Map<string, BlockEvents>();
  for (const row of rows) {
    let entry = blocks.get(row.block_hash);
    if (!entry) { entry = { block: fromRow(row), logs: [] }; blocks.set(row.block_hash, entry); }
    entry.logs.push({
      blockHash: row.block_hash, blockNumber: BigInt(row.block_number), transactionHash: row.transaction_hash,
      transactionIndex: row.transaction_index, logIndex: row.log_index, data: row.data, topics: row.topics,
    });
  }
  return [...blocks.values()];
}

export class BaseChainIndexer {
  private readonly batchBlocks: number;
  private readonly maxReorgBlocks: number;
  constructor(private readonly pool: Pool, private readonly chain: BaseAccountingReader, options: { batchBlocks?: number; maxReorgBlocks?: number } = {}) {
    this.batchBlocks = options.batchBlocks ?? 32;
    this.maxReorgBlocks = options.maxReorgBlocks ?? 128;
    if (!Number.isInteger(this.batchBlocks) || this.batchBlocks < 1 || this.batchBlocks > 128 ||
        !Number.isInteger(this.maxReorgBlocks) || this.maxReorgBlocks < 1 || this.maxReorgBlocks > 1024) chainFailure();
  }
  private async load() {
    const pins = deploymentPins(this.chain.deployment);
    const safePins: Record<string, unknown> = pins;
    return transaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO base_chain_deployments (id, chain_id, escrow, pins) VALUES ($1, $2, $3, $4)
         ON CONFLICT (chain_id, escrow) DO NOTHING`, [randomUUID(), pins.chainId, pins.escrow, safePins],
      );
      const result = await client.query("SELECT * FROM base_chain_deployments WHERE chain_id = $1 AND escrow = $2 FOR SHARE", [pins.chainId, pins.escrow]);
      const row = result.rows[0];
      if (Object.keys(row.pins).length !== Object.keys(safePins).length || Object.entries(safePins).some(([key, value]) => row.pins[key] !== value)) {
        chainFailure("BASE_DEPLOYMENT_PINS_CHANGED");
      }
      if (row.state === "HALTED") chainFailure("BASE_INDEXER_HALTED");
      const history = await client.query(
        `SELECT b.*, e.transaction_hash, e.log_index, e.transaction_index, e.data, e.topics
         FROM base_chain_blocks b JOIN base_chain_events e USING (deployment_id, block_hash)
         WHERE b.deployment_id = $1 AND b.canonical ORDER BY b.block_number, e.log_index LIMIT $2`, [row.id, maxHistoryEvents + 1],
      );
      if (history.rows.length > maxHistoryEvents) chainFailure("BASE_ACCOUNTING_CAPACITY");
      const tail = await client.query(
        "SELECT * FROM base_chain_blocks WHERE deployment_id = $1 AND canonical ORDER BY block_number DESC LIMIT $2", [row.id, this.maxReorgBlocks + 1],
      );
      return { row, history: historyFromRows(history.rows), tail: tail.rows.map(fromRow) };
    });
  }
  private async halt(id: string, version: string, code: string) {
    await transaction(this.pool, (client) => client.query(
      `UPDATE base_chain_deployments SET state = 'HALTED', failure_code = $3, version = version + 1, checked_at = NOW()
       WHERE id = $1 AND version = $2 AND state <> 'HALTED'`, [id, version, code],
    ));
  }
  async sync() {
    const snapshot = await this.load();
    try { return await bounded((signal) => this.synchronize(snapshot, signal), 60000); }
    catch (error) {
      if (error instanceof AppError && haltCodes.has(error.code)) {
        await this.halt(snapshot.row.id, snapshot.row.version, error.code);
        throw error;
      }
      if (error instanceof AppError) throw error;
      chainFailure();
    }
  }
  private async synchronize(snapshot: Awaited<ReturnType<BaseChainIndexer["load"]>>, signal: AbortSignal) {
    const { row, history, tail } = snapshot;
    const latest = await this.chain.block("latest", signal);
    const finalized = await this.chain.block("finalized", signal);
    const now = Math.floor(Date.now() / 1000);
    if (finalized.number > latest.number || finalized.timestamp > now + 30 ||
        finalized.timestamp < now - this.chain.maxFinalizedLagSeconds || finalized.number < this.chain.deployment.deploymentBlock) chainFailure();
    if (row.finalized_number !== null) {
      const previousFinalized = BigInt(row.finalized_number);
      if (finalized.number < previousFinalized) chainFailure();
      if ((await this.chain.block(previousFinalized, signal)).hash !== row.finalized_hash) chainFailure("BASE_FINALITY_CONFLICT");
    }
    await this.chain.verifyDeployment(finalized, signal);
    if (row.tip_number !== null) {
      const tipNumber = BigInt(row.tip_number);
      if (tipNumber > latest.number || (await this.chain.block(tipNumber, signal)).hash !== row.tip_hash) {
        let ancestor: ChainBlock | undefined;
        for (const block of tail) {
          if (tipNumber - block.number > BigInt(this.maxReorgBlocks)) break;
          if (block.number <= latest.number && (await this.chain.block(block.number, signal)).hash === block.hash) { ancestor = block; break; }
        }
        if (!ancestor) chainFailure("BASE_REORG_TOO_DEEP");
        if (row.finalized_number !== null && ancestor.number < BigInt(row.finalized_number)) chainFailure("BASE_FINALITY_CONFLICT");
        if ((await this.chain.block(ancestor.number, signal)).hash !== ancestor.hash) chainFailure();
        signal.throwIfAborted();
        return transaction(this.pool, async (client) => {
          const saved = await client.query("SELECT version FROM base_chain_deployments WHERE id = $1 FOR UPDATE", [row.id]);
          if (saved.rows[0].version !== row.version) chainFailure("BASE_INDEXER_RETRY");
          await client.query(
            "UPDATE base_chain_blocks SET canonical = FALSE, orphaned_at = NOW() WHERE deployment_id = $1 AND canonical AND block_number > $2", [row.id, ancestor.number.toString()],
          );
          await client.query(
            `UPDATE base_chain_deployments SET tip_number = $2, tip_hash = $3, state = 'CATCHING_UP', version = version + 1, checked_at = NOW() WHERE id = $1`,
            [row.id, ancestor.number.toString(), ancestor.hash],
          );
          return { state: "CATCHING_UP", rewoundBlocks: Number(tipNumber - ancestor.number), blocks: 0, events: 0 };
        });
      }
    }
    const additions: BlockEvents[] = [];
    let parent = tail[0];
    const start = row.tip_number === null ? this.chain.deployment.deploymentBlock : BigInt(row.tip_number) + 1n;
    const stop = start + BigInt(this.batchBlocks) - 1n < latest.number ? start + BigInt(this.batchBlocks) - 1n : latest.number;
    for (let number = start; number <= stop; number++) {
      const block = await this.chain.block(number, signal);
      if (parent && (block.parentHash !== parent.hash || block.timestamp < parent.timestamp)) chainFailure();
      if (number === this.chain.deployment.deploymentBlock && block.hash !== this.chain.deployment.deploymentBlockHash) chainFailure("BASE_FINALITY_CONFLICT");
      additions.push({ block, logs: await this.chain.logs(block, signal) }); parent = block;
    }
    if (!parent) chainFailure();
    const allEvents = [...history, ...additions.filter((entry) => entry.logs.length)];
    if (allEvents.reduce((sum, entry) => sum + entry.logs.length, 0) > maxHistoryEvents) chainFailure("BASE_ACCOUNTING_CAPACITY");
    projectEscrowEvents(this.chain.deployment, allEvents);
    const checkpointNumber = parent.number < finalized.number ? parent.number : finalized.number;
    let checkpoint = additions.find((entry) => entry.block.number === checkpointNumber)?.block;
    if (!checkpoint) {
      const found = await this.pool.query("SELECT * FROM base_chain_blocks WHERE deployment_id = $1 AND canonical AND block_number = $2", [row.id, checkpointNumber.toString()]);
      if (!found.rowCount) chainFailure();
      checkpoint = fromRow(found.rows[0]);
    }
    if ((await this.chain.block(checkpoint.number, signal)).hash !== checkpoint.hash) chainFailure();
    await this.chain.verifyDeployment(checkpoint, signal);
    const campaigns = projectEscrowEvents(this.chain.deployment, allEvents.filter((entry) => entry.block.number <= checkpoint.number));
    for (const campaign of campaigns.values()) reconcileCampaign(campaign, await this.chain.campaignAt(campaign.onChainId, checkpoint, signal), checkpoint);
    const totals = await this.chain.totalsAt(checkpoint, signal);
    const accounting = reconcileTotals(campaigns, totals);
    if ((await this.chain.block(parent.number, signal)).hash !== parent.hash ||
        (await this.chain.block(checkpoint.number, signal)).hash !== checkpoint.hash ||
        (await this.chain.block("finalized", signal)).number < checkpoint.number) chainFailure();
    signal.throwIfAborted();
    return transaction(this.pool, async (client) => {
      const saved = await client.query("SELECT version FROM base_chain_deployments WHERE id = $1 FOR UPDATE", [row.id]);
      if (saved.rows[0].version !== row.version) chainFailure("BASE_INDEXER_RETRY");
      for (const { block, logs } of additions) {
        const logsHash = keccak256(stringToHex(accountingJson(logs)));
        const inserted = await client.query(
          `INSERT INTO base_chain_blocks (deployment_id, block_hash, block_number, parent_hash, block_timestamp, logs_hash)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (deployment_id, block_hash) DO UPDATE SET canonical = TRUE, orphaned_at = NULL
           WHERE base_chain_blocks.block_number = EXCLUDED.block_number AND base_chain_blocks.parent_hash = EXCLUDED.parent_hash
             AND base_chain_blocks.block_timestamp = EXCLUDED.block_timestamp AND base_chain_blocks.logs_hash = EXCLUDED.logs_hash
           RETURNING block_hash`, [row.id, block.hash, block.number.toString(), block.parentHash, block.timestamp, logsHash],
        );
        if (!inserted.rowCount) chainFailure("BASE_RECONCILIATION_MISMATCH");
        if (logs.length) await client.query(
          `INSERT INTO base_chain_events (deployment_id, block_hash, transaction_hash, log_index, transaction_index, data, topics)
           SELECT $1, $2, e."transactionHash", e."logIndex", e."transactionIndex", e.data, e.topics
           FROM jsonb_to_recordset($3::jsonb) AS e("transactionHash" TEXT, "logIndex" INTEGER, "transactionIndex" INTEGER, data TEXT, topics JSONB)
           ON CONFLICT DO NOTHING`, [row.id, block.hash, accountingJson(logs)],
        );
      }
      if (campaigns.size) await client.query(
        `INSERT INTO base_chain_campaign_snapshots (deployment_id, on_chain_id, block_hash, accounting)
         SELECT $1, (item->>'onChainId')::NUMERIC, $2, item FROM jsonb_array_elements($3::jsonb) item
         ON CONFLICT (deployment_id, on_chain_id) DO UPDATE SET block_hash = EXCLUDED.block_hash, accounting = EXCLUDED.accounting`,
        [row.id, checkpoint.hash, accountingJson([...campaigns.values()])],
      );
      const state = checkpoint.number === finalized.number ? "HEALTHY" : "CATCHING_UP";
      await client.query(
        `UPDATE base_chain_deployments SET tip_number = $2, tip_hash = $3, finalized_number = $4, finalized_hash = $5,
         totals = $6, state = $7, checked_at = NOW(), version = version + 1 WHERE id = $1`,
        [row.id, parent.number.toString(), parent.hash, checkpoint.number.toString(), checkpoint.hash, accountingJson({ ...totals, ...accounting }), state],
      );
      return { state, rewoundBlocks: 0, blocks: additions.length, events: additions.reduce((sum, entry) => sum + entry.logs.length, 0), finalizedBlock: checkpoint.number.toString() };
    });
  }
}
