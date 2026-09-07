import { config as loadEnv } from "dotenv";
import pg from "pg";
import { getAddress } from "viem";

import { RpcBaseChainReader, baseDeploymentFromEnvironment } from "../src/server/base/chain-reader";
import { BaseRewardIssuer, matchingState } from "../src/server/base/issuer";
import { LearningPublication } from "../src/server/base/publication";
import { PostgresReviewRepository } from "../src/server/base/review-repository";
import { AppError } from "../src/server/v2/errors";

loadEnv({ path: ".env.local" });

const COMMIT = process.argv.includes("--commit");
const OWNER_ID = "1";
const CAMPAIGN_ID = "247c4bff-fb70-4a50-b78e-9d6ed194ab4d";
const ON_CHAIN_ID = 3n;
const EXPECTED = {
  revision: 2,
  termsHash:
    "0x8ceb4b64f564424caf61e0957dc2bd090ce7cf315178f498468f1ed482d97ad8",
  layoutHash:
    "0x4b39dace2fd83e6c8fdb58782aeee5c7edc178c5df37b309abe4d8780efb9490",
};

function localDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL must name the local acceptance database.");
  const url = new URL(raw);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/near_crossword"
  ) {
    throw new Error("Campaign 3 may only be bound in the local near_crossword database.");
  }
  return raw;
}

function requireEqual<T>(label: string, actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${String(expected)}, received ${String(actual)}`,
    );
  }
}

async function main() {
  const pool = new pg.Pool({ connectionString: localDatabaseUrl(), max: 2 });
  try {
    const chain = new RpcBaseChainReader(baseDeploymentFromEnvironment());
    const reviews = new PostgresReviewRepository(pool);
    const publication = new LearningPublication(pool, chain);
    const issuer = new BaseRewardIssuer(pool, chain);
    const review = await reviews.get(OWNER_ID, CAMPAIGN_ID);
    const preview = await publication.preview(OWNER_ID, CAMPAIGN_ID);

    requireEqual("review status", review.status, "APPROVED");
    requireEqual("review revision", review.revision, EXPECTED.revision);
    requireEqual("review terms hash", review.termsHash, EXPECTED.termsHash);
    requireEqual("layout approval", preview.approved, true);
    requireEqual("layout revision", preview.revision, EXPECTED.revision);
    requireEqual("layout terms hash", preview.termsHash, EXPECTED.termsHash);
    requireEqual("layout hash", preview.layoutHash, EXPECTED.layoutHash);

    const binding = {
      chainId: review.submission.terms.chainId,
      escrow: getAddress(review.submission.terms.escrow),
      onChainId: ON_CHAIN_ID,
    };
    const state = await chain.readFinalizedCampaign(binding, AbortSignal.timeout(10_000));
    matchingState(review, binding, state, chain.maxFinalizedLagSeconds);
    const finalizedBlock = await chain.block(
      state.blockNumber,
      AbortSignal.timeout(10_000),
    );
    requireEqual("finalized block hash", finalizedBlock.hash, state.blockHash);
    const totals = await chain.totalsAt(
      finalizedBlock,
      AbortSignal.timeout(10_000),
    );
    requireEqual("campaign count", totals.campaignCount, ON_CHAIN_ID);
    requireEqual("total reserved", totals.totalReserved, state.fundedAtomic);
    requireEqual("escrow token balance", totals.balance, state.fundedAtomic);
    requireEqual("paid count", state.paidCount, 0);
    requireEqual("refunded amount", state.refundedAtomic, 0n);
    requireEqual("outstanding amount", state.outstandingAtomic, state.fundedAtomic);
    requireEqual("signer epoch", state.signerEpoch, 1n);
    requireEqual(
      "eligibility signer",
      state.signer.toLowerCase(),
      review.submission.terms.initialSigner,
    );
    requireEqual("paused", state.paused, false);
    requireEqual("closed", state.closed, false);

    console.log(
      JSON.stringify(
        {
          preflight: {
            mode: COMMIT ? "commit" : "preflight",
            database: "local near_crossword",
            campaignId: CAMPAIGN_ID,
            revision: review.revision,
            termsHash: review.termsHash,
            layoutHash: preview.layoutHash,
            onChainId: ON_CHAIN_ID.toString(),
            finalizedBlock: state.blockNumber.toString(),
            finalizedBlockHash: state.blockHash,
            fundedAtomic: state.fundedAtomic.toString(),
            outstandingAtomic: state.outstandingAtomic.toString(),
            alreadyBound: review.fundingBound,
            alreadyPublished: preview.published,
          },
        },
        null,
        2,
      ),
    );
    if (!COMMIT) return;

    const savedBinding = await issuer.bindApprovedCampaign(
      OWNER_ID,
      CAMPAIGN_ID,
      ON_CHAIN_ID,
      EXPECTED,
    );
    const published = await publication.publish(OWNER_ID, CAMPAIGN_ID, EXPECTED);
    console.log(
      JSON.stringify(
        {
          result: {
            campaignId: CAMPAIGN_ID,
            onChainId: savedBinding.onChainId.toString(),
            published: published.published,
            publicationHash: published.publicationHash,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof AppError
      ? error.code
      : error instanceof Error
        ? error.message
        : "Campaign binding failed.",
  );
  process.exitCode = 1;
});
