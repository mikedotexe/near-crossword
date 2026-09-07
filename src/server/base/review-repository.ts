import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { conflict, notFound, transaction } from "./database";
import { realUserId, reviewMaterial, validId } from "./review";

export function privateReview(row: QueryResultRow) {
  const material = reviewMaterial(row.submission, row.revision, row.campaign_id);
  if (row.review_hash !== material.reviewHash || row.terms_hash !== material.termsHash ||
      (row.approved_at && (row.approved_review_hash !== material.reviewHash || row.approved_terms_hash !== material.termsHash))) {
    conflict("Stored review commitments require reconciliation");
  }
  return {
    id: row.campaign_id as string,
    revision: row.revision as number,
    status: row.approved_at ? "APPROVED" as const : "REQUIRES_REVIEW" as const,
    ...material,
    approval: row.approved_at ? {
      reviewerId: String(row.reviewer_id), approvedAt: new Date(row.approved_at).toISOString(),
    } : null,
    fundingBound: Boolean(row.funding_bound),
  };
}
export type PrivateReview = ReturnType<typeof privateReview>;

export async function currentReview(client: PoolClient, id: string, ownerId?: string) {
  // Lock the parent first, then read its revision in a fresh statement snapshot after any wait.
  const campaign = await client.query(
    `SELECT current_revision FROM base_learning_campaigns
     WHERE id = $1 AND ($2::BIGINT IS NULL OR owner_id = $2) FOR UPDATE`, [id, ownerId ?? null],
  );
  if (!campaign.rowCount) notFound();
  const result = await client.query(
    `SELECT r.*, a.reviewer_id, a.approved_at, a.review_hash AS approved_review_hash, a.terms_hash AS approved_terms_hash,
       EXISTS (SELECT 1 FROM base_reward_campaigns b WHERE b.campaign_id = r.campaign_id) AS funding_bound
     FROM base_learning_revisions r
     LEFT JOIN base_learning_approvals a ON a.campaign_id = r.campaign_id AND a.revision = r.revision
     WHERE r.campaign_id = $1 AND r.revision = $2`, [id, campaign.rows[0].current_revision],
  );
  if (!result.rowCount) notFound();
  return privateReview(result.rows[0]);
}

async function insertRevision(client: PoolClient, id: string, revision: number, raw: unknown) {
  const m = reviewMaterial(raw, revision, id);
  await client.query(
    `INSERT INTO base_learning_revisions
       (campaign_id, revision, submission, source_manifest, review_hash, public_content, public_terms, terms_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, revision, m.submission, JSON.stringify(m.sourceManifest), m.reviewHash, m.publicContent, m.publicTerms, m.termsHash],
  );
}

export class PostgresReviewRepository {
  constructor(private readonly pool: Pool) {}

  async create(ownerId: string, creationKey: string, raw: unknown): Promise<PrivateReview> {
    realUserId(ownerId); validId(creationKey);
    const id = randomUUID();
    const material = reviewMaterial(raw, 1, id);
    return transaction(this.pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO base_learning_campaigns (id, owner_id, creation_key, creation_hash, current_revision)
         VALUES ($1, $2, $3, $4, 1) ON CONFLICT (owner_id, creation_key) DO NOTHING RETURNING id`,
        [id, ownerId, creationKey, material.reviewHash],
      );
      if (inserted.rowCount) {
        await insertRevision(client, inserted.rows[0].id, 1, material.submission);
        return currentReview(client, inserted.rows[0].id, ownerId);
      }
      const existing = await client.query(
        "SELECT id, creation_hash FROM base_learning_campaigns WHERE owner_id = $1 AND creation_key = $2",
        [ownerId, creationKey],
      );
      if (existing.rows[0].creation_hash !== material.reviewHash) conflict("Creation key was already used for different material");
      return currentReview(client, existing.rows[0].id, ownerId);
    });
  }

  async get(ownerId: string, id: string) {
    realUserId(ownerId); validId(id);
    return transaction(this.pool, (client) => currentReview(client, id, ownerId));
  }

  async list(ownerId: string) {
    realUserId(ownerId);
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `SELECT c.id, c.current_revision AS revision, r.public_content ->> 'title' AS title,
           CASE WHEN a.approved_at IS NULL THEN 'REQUIRES_REVIEW' ELSE 'APPROVED' END AS status
         FROM base_learning_campaigns c
         JOIN base_learning_revisions r ON r.campaign_id = c.id AND r.revision = c.current_revision
         LEFT JOIN base_learning_approvals a ON a.campaign_id = r.campaign_id AND a.revision = r.revision
         WHERE c.owner_id = $1 ORDER BY c.created_at DESC, c.id DESC LIMIT 100`, [ownerId],
      );
      return result.rows;
    });
  }

  async revise(ownerId: string, id: string, expectedRevision: number, raw: unknown) {
    realUserId(ownerId); validId(id);
    return transaction(this.pool, async (client) => {
      const current = await currentReview(client, id, ownerId);
      if (current.fundingBound) conflict("Funded review material is immutable");
      if (current.revision !== expectedRevision) conflict("Review revision changed; reload before editing");
      await insertRevision(client, id, current.revision + 1, raw);
      await client.query("UPDATE base_learning_campaigns SET current_revision = current_revision + 1 WHERE id = $1", [id]);
      return currentReview(client, id, ownerId);
    });
  }

  async approve(ownerId: string, id: string, revision: number, reviewHash: string, termsHash: string) {
    realUserId(ownerId); validId(id);
    return transaction(this.pool, async (client) => {
      const current = await currentReview(client, id, ownerId);
      if (current.revision !== revision || current.reviewHash !== reviewHash || current.termsHash !== termsHash) {
        conflict("Review material changed; reload before approving");
      }
      await client.query(
        `INSERT INTO base_learning_approvals (campaign_id, revision, reviewer_id, review_hash, terms_hash)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (campaign_id, revision) DO NOTHING`,
        [id, revision, ownerId, reviewHash, termsHash],
      );
      return currentReview(client, id, ownerId);
    });
  }
}
