import { AppError } from "../src/server/v2/errors";
import { getDatabasePool } from "../src/server/v2/repository-factory";
import { RpcBaseChainReader, baseDeploymentFromEnvironment } from "../src/server/base/chain-reader";
import { BaseChainIndexer } from "../src/server/base/chain-indexer";

async function main() {
  if (process.env.BASE_INDEXER_ENABLED !== "true") throw new AppError(503, "BASE_INDEXER_DISABLED", "Base accounting is disabled");
  const reader = new RpcBaseChainReader(baseDeploymentFromEnvironment());
  const pool = getDatabasePool();
  try {
    const result = await new BaseChainIndexer(pool, reader).sync();
    console.log(JSON.stringify({ ok: true, ...result }));
  } finally { await pool.end(); }
}

main().catch((error) => {
  // RPC/DB errors may contain credentials or private records. Emit only our own stable code.
  console.error(JSON.stringify({ ok: false, code: error instanceof AppError ? error.code : "BASE_ACCOUNTING_FAILED" }));
  process.exitCode = 1;
});
