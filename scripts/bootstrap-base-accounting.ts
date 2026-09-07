import { randomUUID } from "node:crypto";
import { keccak256, stringToHex } from "viem";
import { AppError } from "../src/server/v2/errors";
import {
  baseDeploymentFromEnvironment,
  chainHash,
  deploymentPins,
  RpcBaseChainReader,
  type ChainBlock,
} from "../src/server/base/chain-reader";
import {
  accountingJson,
  projectEscrowEvents,
  reconcileCampaign,
  reconcileTotals,
  type BlockEvents,
} from "../src/server/base/chain-events";
import { transaction } from "../src/server/base/database";
import { getDatabasePool } from "../src/server/v2/repository-factory";

const RANGE_BLOCKS = 10_000n;
const BLOCK_BATCH = 40;
const MAX_UNFINALIZED_BLOCKS = 1_024n;
let stage = "startup";

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type DiscoveryLog = {
  address?: unknown;
  blockHash?: unknown;
  blockNumber?: unknown;
  logIndex?: unknown;
  removed?: unknown;
  transactionHash?: unknown;
};

function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) {
    throw new AppError(503, "BASE_CHAIN_UNAVAILABLE", "Base log discovery failed");
  }
  return BigInt(value);
}

async function discoverEventBlocks(
  rpcUrl: string,
  escrow: string,
  start: bigint,
  stop: bigint,
) {
  const blocks = new Set<bigint>();
  let discoveredLogs = 0;
  for (let from = start; from <= stop; from += RANGE_BLOCKS) {
    const to = from + RANGE_BLOCKS - 1n < stop ? from + RANGE_BLOCKS - 1n : stop;
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getLogs",
        params: [
          {
            address: escrow,
            fromBlock: `0x${from.toString(16)}`,
            toBlock: `0x${to.toString(16)}`,
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new AppError(503, "BASE_CHAIN_UNAVAILABLE", "Base log discovery failed");
    }
    const body = (await response.json()) as {
      jsonrpc?: unknown;
      id?: unknown;
      result?: unknown;
      error?: unknown;
    };
    if (
      body.jsonrpc !== "2.0" ||
      body.id !== 1 ||
      body.error ||
      !Array.isArray(body.result) ||
      body.result.length > 2_000
    ) {
      throw new AppError(503, "BASE_CHAIN_UNAVAILABLE", "Base log discovery failed");
    }
    for (const raw of body.result as DiscoveryLog[]) {
      const number = quantity(raw.blockNumber);
      if (
        typeof raw.address !== "string" ||
        raw.address.toLowerCase() !== escrow ||
        number < from ||
        number > to ||
        typeof raw.blockHash !== "string" ||
        typeof raw.transactionHash !== "string" ||
        raw.removed === true ||
        quantity(raw.logIndex) > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        throw new AppError(503, "BASE_CHAIN_UNAVAILABLE", "Base log discovery failed");
      }
      chainHash.parse(raw.blockHash);
      chainHash.parse(raw.transactionHash);
      blocks.add(number);
      discoveredLogs += 1;
    }
  }
  return { blocks, discoveredLogs };
}

async function recentBlocks(
  rpcUrl: string,
  start: bigint,
  stop: bigint,
): Promise<ChainBlock[]> {
  if (stop < start || stop - start > MAX_UNFINALIZED_BLOCKS) {
    throw new AppError(503, "BASE_CHAIN_UNAVAILABLE", "Base finality window is invalid");
  }
  const result: ChainBlock[] = [];
  for (let from = start; from <= stop; from += BigInt(BLOCK_BATCH)) {
    const count = Number(
      from + BigInt(BLOCK_BATCH) - 1n < stop
        ? BigInt(BLOCK_BATCH)
        : stop - from + 1n,
    );
    const requests = Array.from({ length: count }, (_, index) => ({
      jsonrpc: "2.0",
      id: index + 1,
      method: "eth_getBlockByNumber",
      params: [`0x${(from + BigInt(index)).toString(16)}`, false],
    }));
    let body: Array<{
      id?: unknown;
      result?: {
        number?: unknown;
        hash?: unknown;
        parentHash?: unknown;
        timestamp?: unknown;
      };
      error?: unknown;
    }> | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify(requests),
      });
      const candidate = (await response.json()) as unknown;
      if (
        response.ok &&
        Array.isArray(candidate) &&
        candidate.length === count &&
        candidate.every((item) => item && typeof item === "object" && !("error" in item))
      ) {
        body = candidate;
        break;
      }
      await wait(1_100 * (attempt + 1));
    }
    if (!body) {
      throw new AppError(503, "BASE_CHAIN_UNAVAILABLE", "Base block discovery failed");
    }
    const ordered = [...body].sort((a, b) => Number(a.id) - Number(b.id));
    for (let index = 0; index < ordered.length; index += 1) {
      const raw = ordered[index];
      const number = quantity(raw.result?.number);
      const expected = from + BigInt(index);
      if (
        raw.error ||
        raw.id !== index + 1 ||
        number !== expected ||
        typeof raw.result?.hash !== "string" ||
        typeof raw.result.parentHash !== "string"
      ) {
        throw new AppError(503, "BASE_CHAIN_UNAVAILABLE", "Base block discovery failed");
      }
      result.push({
        number,
        hash: chainHash.parse(raw.result.hash),
        parentHash: chainHash.parse(raw.result.parentHash),
        timestamp: Number(quantity(raw.result.timestamp)),
      });
    }
    if (from + BigInt(count) <= stop) await wait(1_100);
  }
  for (let index = 1; index < result.length; index += 1) {
    if (
      result[index].number !== result[index - 1].number + 1n ||
      result[index].parentHash !== result[index - 1].hash ||
      result[index].timestamp < result[index - 1].timestamp
    ) {
      throw new AppError(503, "BASE_CHAIN_UNAVAILABLE", "Base block history changed");
    }
  }
  return result;
}

async function main() {
  if (process.env.BASE_INDEXER_ENABLED !== "true") {
    throw new AppError(503, "BASE_INDEXER_DISABLED", "Base accounting is disabled");
  }
  const commit = process.env.BASE_ACCOUNTING_BOOTSTRAP_COMMIT === "true";
  const replace = process.env.BASE_ACCOUNTING_BOOTSTRAP_REPLACE === "true";
  const deployment = baseDeploymentFromEnvironment();
  const reader = new RpcBaseChainReader(deployment);
  const signal = AbortSignal.timeout(60_000);
  stage = "heads";
  const latest = await reader.block("latest", signal);
  const finalized = await reader.block("finalized", signal);
  if (finalized.number > latest.number) {
    throw new AppError(503, "BASE_CHAIN_UNAVAILABLE", "Base finality is invalid");
  }
  stage = "deployment";
  await reader.verifyDeployment(finalized, signal);
  stage = "event-discovery";
  const discovery = await discoverEventBlocks(
    deployment.rpcUrl,
    deployment.escrow,
    deployment.deploymentBlock,
    latest.number,
  );
  stage = "recent-blocks";
  const unfinalized = await recentBlocks(
    deployment.rpcUrl,
    finalized.number,
    latest.number,
  );
  if (
    unfinalized[0]?.hash !== finalized.hash ||
    unfinalized.at(-1)?.hash !== latest.hash
  ) {
    throw new AppError(503, "BASE_CHAIN_UNAVAILABLE", "Base block history changed");
  }
  await wait(1_100);

  stage = "event-validation";
  const eventBlocks: BlockEvents[] = [];
  for (const number of [...discovery.blocks].sort((a, b) => (a < b ? -1 : 1))) {
    const block = await reader.block(number, signal);
    const logs = await reader.logs(block, signal);
    if (!logs.length) {
      throw new AppError(503, "BASE_RECONCILIATION_MISMATCH", "Base log discovery changed");
    }
    eventBlocks.push({ block, logs });
  }
  const validatedLogs = eventBlocks.reduce((sum, entry) => sum + entry.logs.length, 0);
  if (validatedLogs !== discovery.discoveredLogs) {
    throw new AppError(503, "BASE_RECONCILIATION_MISMATCH", "Base log discovery changed");
  }

  stage = "campaign-reconciliation";
  const finalizedHistory = eventBlocks.filter(
    (entry) => entry.block.number <= finalized.number,
  );
  const campaigns = projectEscrowEvents(deployment, finalizedHistory);
  for (const campaign of campaigns.values()) {
    reconcileCampaign(
      campaign,
      await reader.campaignAt(campaign.onChainId, finalized, signal),
      finalized,
    );
  }
  const totals = await reader.totalsAt(finalized, signal);
  const accounting = reconcileTotals(campaigns, totals);
  stage = "head-recheck";
  const currentFinalized = await reader.block("finalized", signal);
  const currentLatest = await reader.block(latest.number, signal);
  if (currentFinalized.hash !== finalized.hash || currentLatest.hash !== latest.hash) {
    throw new AppError(409, "BASE_INDEXER_RETRY", "Base advanced during bootstrap; retry");
  }

  const blocks = new Map<string, BlockEvents>();
  for (const entry of eventBlocks) blocks.set(entry.block.hash, entry);
  for (const block of unfinalized) {
    if (!blocks.has(block.hash)) blocks.set(block.hash, { block, logs: [] });
  }

  if (commit) {
    stage = "database-commit";
    const pool = getDatabasePool();
    try {
      await transaction(pool, async (client) => {
        const pins = deploymentPins(deployment);
        await client.query(
          `INSERT INTO base_chain_deployments (id, chain_id, escrow, pins)
           VALUES ($1, $2, $3, $4) ON CONFLICT (chain_id, escrow) DO NOTHING`,
          [randomUUID(), deployment.chainId, deployment.escrow, pins],
        );
        const selected = await client.query(
          `SELECT * FROM base_chain_deployments
           WHERE chain_id = $1 AND escrow = $2 FOR UPDATE`,
          [deployment.chainId, deployment.escrow],
        );
        const row = selected.rows[0];
        if (
          !row ||
          row.state === "HALTED" ||
          Object.keys(row.pins).length !== Object.keys(pins).length ||
          Object.entries(pins).some(([key, value]) => row.pins[key] !== value)
        ) {
          throw new AppError(409, "BASE_DEPLOYMENT_PINS_CHANGED", "Base deployment pins changed");
        }
        const existing = await client.query(
          `SELECT
             (SELECT count(*) FROM base_chain_events WHERE deployment_id = $1)::INTEGER AS events,
             (SELECT count(*) FROM base_chain_campaign_snapshots WHERE deployment_id = $1)::INTEGER AS snapshots`,
          [row.id],
        );
        if (
          (existing.rows[0].events !== 0 || existing.rows[0].snapshots !== 0) &&
          !replace
        ) {
          throw new AppError(
            409,
            "BASE_ACCOUNTING_ALREADY_STARTED",
            "Historical accounting already contains projected data",
          );
        }
        if (replace) {
          const activity = await client.query(
            `SELECT
               (SELECT count(*) FROM base_reward_allocations)::INTEGER AS allocations,
               (SELECT count(*) FROM base_gas_requests)::INTEGER AS gas_requests,
               (SELECT count(*) FROM base_gas_sponsorships)::INTEGER AS sponsorships`,
          );
          if (
            activity.rows[0].allocations !== 0 ||
            activity.rows[0].gas_requests !== 0 ||
            activity.rows[0].sponsorships !== 0
          ) {
            throw new AppError(
              409,
              "BASE_ACCOUNTING_ALREADY_STARTED",
              "Participant accounting has already started",
            );
          }
          await client.query(
            "DELETE FROM base_chain_campaign_snapshots WHERE deployment_id = $1",
            [row.id],
          );
          await client.query("DELETE FROM base_chain_events WHERE deployment_id = $1", [row.id]);
        }
        await client.query("DELETE FROM base_chain_blocks WHERE deployment_id = $1", [row.id]);
        for (const { block, logs } of [...blocks.values()].sort((a, b) =>
          a.block.number < b.block.number ? -1 : 1,
        )) {
          await client.query(
            `INSERT INTO base_chain_blocks
             (deployment_id, block_hash, block_number, parent_hash, block_timestamp, logs_hash)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              row.id,
              block.hash,
              block.number.toString(),
              block.parentHash,
              block.timestamp,
              keccak256(stringToHex(accountingJson(logs))),
            ],
          );
          if (logs.length) {
            await client.query(
              `INSERT INTO base_chain_events
               (deployment_id, block_hash, transaction_hash, log_index, transaction_index, data, topics)
               SELECT $1, $2, item."transactionHash", item."logIndex", item."transactionIndex", item.data, item.topics
               FROM jsonb_to_recordset($3::jsonb) AS item(
                 "transactionHash" TEXT, "logIndex" INTEGER, "transactionIndex" INTEGER, data TEXT, topics JSONB
               )`,
              [row.id, block.hash, accountingJson(logs)],
            );
          }
        }
        for (const campaign of campaigns.values()) {
          await client.query(
            `INSERT INTO base_chain_campaign_snapshots
             (deployment_id, on_chain_id, block_hash, accounting) VALUES ($1, $2, $3, $4)`,
            [row.id, campaign.onChainId.toString(), finalized.hash, accountingJson(campaign)],
          );
        }
        await client.query(
          `UPDATE base_chain_deployments SET
             tip_number = $2, tip_hash = $3, finalized_number = $4, finalized_hash = $5,
             totals = $6, state = 'HEALTHY', failure_code = NULL,
             checked_at = NOW(), version = version + 1
           WHERE id = $1`,
          [
            row.id,
            latest.number.toString(),
            latest.hash,
            finalized.number.toString(),
            finalized.hash,
            accountingJson({ ...totals, ...accounting }),
          ],
        );
      });
    } finally {
      await pool.end();
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      committed: commit,
      deploymentBlock: deployment.deploymentBlock.toString(),
      finalizedBlock: finalized.number.toString(),
      tipBlock: latest.number.toString(),
      eventBlocks: eventBlocks.length,
      events: validatedLogs,
      campaigns: campaigns.size,
      recentBlocks: unfinalized.length,
    }),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      code: error instanceof AppError ? error.code : "BASE_ACCOUNTING_BOOTSTRAP_FAILED",
      ...(process.env.BASE_ACCOUNTING_BOOTSTRAP_DEBUG === "true" ? { stage } : {}),
    }),
  );
  process.exitCode = 1;
});
