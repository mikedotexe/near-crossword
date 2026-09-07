import process from "node:process";
import {
  baseDeploymentFromEnvironment,
  RpcBaseChainReader,
} from "../src/server/base/chain-reader";
import { ReconciledBaseChainReader } from "../src/server/base/reconciled-chain-reader";
import {
  cdpPaymasterUpstream,
  ClaimSponsorship,
} from "../src/server/base/sponsorship";
import { sponsorshipConfigurationFromEnvironment } from "../src/server/base/sponsorship-policy";
import { AppError } from "../src/server/v2/errors";
import { getDatabasePool } from "../src/server/v2/repository-factory";

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const allocationId = option("allocation");
  const reviewedBy = option("reviewed-by");
  const commit = process.argv.includes("--commit");
  if (!allocationId || !reviewedBy)
    throw new AppError(
      400,
      "BASE_RECOVERY_INPUT_REQUIRED",
      "Allocation and reviewer are required",
    );
  const { policy, upstreamUrl } = sponsorshipConfigurationFromEnvironment();
  const pool = getDatabasePool();
  try {
    const rpc = new RpcBaseChainReader(baseDeploymentFromEnvironment());
    const service = new ClaimSponsorship(
      pool,
      new ReconciledBaseChainReader(pool, rpc),
      rpc,
      policy,
      cdpPaymasterUpstream(upstreamUrl),
    );
    const result = await service.reviewExpiredStubOnlyRecovery(
      allocationId,
      reviewedBy,
      commit,
    );
    console.log(JSON.stringify({ ok: true, ...result }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      code:
        error instanceof AppError
          ? error.code
          : "BASE_SPONSORSHIP_RECOVERY_FAILED",
    }),
  );
  process.exitCode = 1;
});
