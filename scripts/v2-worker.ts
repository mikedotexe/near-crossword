import "dotenv/config";
import { hostname } from "node:os";
import { NearApiV2ChainClient } from "../src/server/v2/chain/near-client";
import {
  runChainWorkerBatch,
  safeWorkerError,
} from "../src/server/v2/chain/worker";
import type { WorkerLogger } from "../src/server/v2/chain/types";
import { getRepository } from "../src/server/v2/repository-factory";

const POLL_MS = Math.max(
  250,
  Number(
    process.env.V2_WORKER_POLL_INTERVAL_MS ||
      process.env.V2_CHAIN_WORKER_POLL_MS ||
      2_000,
  ),
);
const BATCH_SIZE = Math.min(
  50,
  Math.max(1, Number(process.env.V2_CHAIN_WORKER_BATCH_SIZE || 5)),
);

let stopping = false;

const logger: WorkerLogger = {
  info(message, metadata) {
    console.info(JSON.stringify({ level: "info", message, ...metadata }));
  },
  error(message, metadata) {
    console.error(JSON.stringify({ level: "error", message, ...metadata }));
  },
};

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  if (process.env.V2_CHAIN_BROADCAST_ENABLED !== "true") {
    throw new Error(
      "V2 chain worker will not start unless V2_CHAIN_BROADCAST_ENABLED=true",
    );
  }
  const repository = getRepository();
  const chain = NearApiV2ChainClient.fromEnvironment();
  const workerId = `v2-chain:${hostname()}:${process.pid}`;
  logger.info("v2 chain worker started", {
    workerId,
    contractId: chain.contractId,
    usdcContractId: chain.usdcContractId,
  });

  while (!stopping) {
    const result = await runChainWorkerBatch(repository, chain, workerId, {
      limit: BATCH_SIZE,
      logger,
    });
    if (result.processed === 0) await sleep(POLL_MS);
  }
  logger.info("v2 chain worker stopped", { workerId });
}

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

main().catch((error) => {
  logger.error("v2 chain worker terminated", {
    error: safeWorkerError(error),
  });
  process.exitCode = 1;
});
