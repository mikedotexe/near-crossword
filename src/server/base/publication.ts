import type { Pool, PoolClient } from "pg";
import type { PublicLesson } from "../../lib/base/learning";
import { AppError } from "../v2/errors";
import { bounded } from "./bounded";
import { conflict, notFound, transaction } from "./database";
import { matchingState, type BaseChainReader } from "./issuer";
import {
  generateLayout,
  layoutHash,
  publicationHash,
  validateLayout,
} from "./layout";
import { participantCampaign } from "./participant-repository";
import { realUserId, validId } from "./review";
import { currentReview, type PrivateReview } from "./review-repository";

export type PublicationExpectation = {
  revision: number;
  termsHash: string;
  layoutHash: string;
};

async function material(
  client: PoolClient,
  review: PrivateReview,
  generate = false,
) {
  const result = await client.query(
    "SELECT * FROM base_learning_layouts WHERE campaign_id = $1 AND revision = $2",
    [review.id, review.revision],
  );
  const saved = result.rows[0];
  const answers = review.submission.draft.entries.map((e) => e.answer);
  if (!saved && !generate)
    conflict("Approve the crossword layout before publication");
  const layout = saved
    ? validateLayout(saved.layout, answers)
    : generateLayout(answers);
  const hash = layoutHash(layout);
  if (
    saved &&
    (saved.terms_hash !== review.termsHash || saved.layout_hash !== hash)
  )
    conflict("Layout commitments require reconciliation");
  return {
    revision: review.revision,
    termsHash: review.termsHash,
    layout,
    layoutHash: hash,
    publicationHash: publicationHash(
      review.id,
      review.revision,
      review.termsHash,
      hash,
    ),
    approved: Boolean(saved),
  };
}

function expected(
  actual: PublicationExpectation,
  expectation: PublicationExpectation,
) {
  if (
    actual.revision !== expectation.revision ||
    actual.termsHash !== expectation.termsHash ||
    actual.layoutHash !== expectation.layoutHash
  ) {
    conflict("Publication material changed; reload and review again");
  }
}

export class LearningPublication {
  constructor(
    private readonly pool: Pool,
    private readonly chain?: BaseChainReader,
  ) {}

  async preview(ownerId: string, id: string) {
    realUserId(ownerId);
    validId(id);
    return transaction(this.pool, async (client) => {
      const review = await currentReview(client, id, ownerId);
      const draft = await material(client, review, true);
      const published = await client.query(
        "SELECT withdrawn_at, published_at FROM base_learning_publications WHERE campaign_id = $1",
        [id],
      );
      return {
        ...draft,
        published: Boolean(
          published.rowCount && !published.rows[0].withdrawn_at,
        ),
      };
    });
  }

  async approveLayout(
    ownerId: string,
    id: string,
    expectation: PublicationExpectation,
  ) {
    realUserId(ownerId);
    validId(id);
    return transaction(this.pool, async (client) => {
      const review = await currentReview(client, id, ownerId);
      if (review.status !== "APPROVED")
        conflict("Approve the lesson and funded terms first");
      const draft = await material(client, review, true);
      expected(draft, expectation);
      await client.query(
        `INSERT INTO base_learning_layouts (campaign_id, revision, layout, layout_hash, terms_hash, reviewer_id)
        VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [
          id,
          review.revision,
          draft.layout,
          draft.layoutHash,
          draft.termsHash,
          ownerId,
        ],
      );
      return { ...draft, approved: true };
    });
  }

  async publish(
    ownerId: string,
    id: string,
    expectation: PublicationExpectation,
  ) {
    const chain = this.chain;
    if (!chain)
      throw new AppError(
        503,
        "BASE_CHAIN_UNAVAILABLE",
        "Finalized reward state is unavailable",
      );
    realUserId(ownerId);
    validId(id);
    const loaded = await transaction(this.pool, async (client) => {
      await currentReview(client, id, ownerId);
      const campaign = await participantCampaign(client, id);
      expected(await material(client, campaign.review), expectation);
      return campaign;
    });
    const state = await bounded(
      (signal) => chain.readFinalizedCampaign(loaded.binding, signal),
      10000,
    );
    return transaction(this.pool, async (client) => {
      await currentReview(client, id, ownerId);
      const current = await participantCampaign(client, id);
      const draft = await material(client, current.review);
      expected(draft, expectation);
      matchingState(
        current.review,
        current.binding,
        state,
        chain.maxFinalizedLagSeconds,
      );
      if (
        state.closed ||
        state.paused ||
        Math.floor(Date.now() / 1000) >= state.endsAt ||
        current.nextSlot >= state.maxClaims
      )
        conflict("Funding is not available for publication");
      const prior = await client.query(
        "SELECT publication_hash FROM base_learning_publications WHERE campaign_id = $1",
        [id],
      );
      if (
        prior.rowCount &&
        prior.rows[0].publication_hash !== draft.publicationHash
      )
        conflict("A published commitment cannot change");
      await client.query(
        `INSERT INTO base_learning_publications (campaign_id, revision, publication_hash) VALUES ($1, $2, $3)
        ON CONFLICT (campaign_id) DO UPDATE SET withdrawn_at = NULL`,
        [id, current.review.revision, draft.publicationHash],
      );
      return { published: true, publicationHash: draft.publicationHash };
    });
  }

  async withdraw(
    ownerId: string,
    id: string,
    expectation: PublicationExpectation,
  ) {
    realUserId(ownerId);
    validId(id);
    return transaction(this.pool, async (client) => {
      const review = await currentReview(client, id, ownerId);
      expected(await material(client, review), expectation);
      await client.query(
        "UPDATE base_learning_publications SET withdrawn_at = COALESCE(withdrawn_at, NOW()) WHERE campaign_id = $1",
        [id],
      );
      return { published: false };
    });
  }

  async list() {
    return transaction(this.pool, async (client) => {
      const result =
        await client.query(`SELECT p.campaign_id AS id, r.public_content ->> 'title' AS title,
        r.public_terms ->> 'rewardAtomic' AS "rewardAtomic", (r.public_terms ->> 'chainId')::INTEGER AS "chainId"
        FROM base_learning_publications p JOIN base_learning_revisions r USING (campaign_id, revision)
        WHERE p.withdrawn_at IS NULL ORDER BY p.published_at DESC, p.campaign_id DESC LIMIT 50`);
      // Catalog prices are reviewed terms, not a promise that an allocation remains.
      return result.rows as Array<{
        id: string;
        title: string;
        rewardAtomic: string;
        chainId: number;
      }>;
    });
  }

  async get(id: string): Promise<PublicLesson> {
    const chain = this.chain;
    if (!chain)
      throw new AppError(
        503,
        "BASE_CHAIN_UNAVAILABLE",
        "Finalized reward state is unavailable",
      );
    validId(id);
    const loaded = await transaction(this.pool, async (client) => {
      const campaign = await participantCampaign(client, id);
      const publication = await client.query(
        "SELECT * FROM base_learning_publications WHERE campaign_id = $1 AND withdrawn_at IS NULL",
        [id],
      );
      if (!publication.rowCount) notFound();
      const draft = await material(client, campaign.review);
      if (
        publication.rows[0].revision !== campaign.review.revision ||
        publication.rows[0].publication_hash !== draft.publicationHash
      )
        conflict("Publication commitments require reconciliation");
      return {
        ...campaign,
        draft,
        publishedAt: new Date(publication.rows[0].published_at).toISOString(),
      };
    });
    const state = await bounded(
      (signal) => chain.readFinalizedCampaign(loaded.binding, signal),
      10000,
    );
    matchingState(
      loaded.review,
      loaded.binding,
      state,
      chain.maxFinalizedLagSeconds,
    );
    const terms = loaded.review.submission.terms,
      now = Math.floor(Date.now() / 1000);
    return {
      id,
      revision: loaded.review.revision,
      ...loaded.review.publicContent,
      layout: loaded.draft.layout,
      layoutHash: loaded.draft.layoutHash,
      termsHash: loaded.review.termsHash,
      publicationHash: loaded.draft.publicationHash,
      publishedAt: loaded.publishedAt,
      terms: {
        chainId: terms.chainId,
        escrow: terms.escrow,
        token: terms.token,
        sponsor: terms.sponsor,
        rewardAtomic: terms.rewardAtomic,
        maxClaims: terms.maxClaims,
        startsAt: terms.startsAt,
        endsAt: terms.endsAt,
        claimDeadline: terms.claimDeadline,
      },
      onChainId: loaded.binding.onChainId.toString(),
      remainingSlots: Math.max(0, state.maxClaims - loaded.nextSlot),
      paidCount: state.paidCount,
      availability:
        state.closed || now >= state.endsAt
          ? "CLOSED"
          : state.paused
            ? "PAUSED"
            : now < state.startsAt
              ? "NOT_STARTED"
              : loaded.nextSlot >= state.maxClaims
                ? "EXHAUSTED"
                : "OPEN",
      asOf: {
        blockNumber: state.blockNumber.toString(),
        blockHash: state.blockHash,
      },
    };
  }
}
