import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  AI_GENERATION_IDEMPOTENCY_ACTOR,
  AI_GENERATION_IDEMPOTENCY_SCOPE,
  verifyAiGenerationReceipt,
} from "./ai-receipt";
import { AppError, isUniqueViolation } from "./errors";
import type {
  CampaignCreateData,
  CampaignDraftPatch,
  ClaimCreateData,
  EventCreateData,
  FinalizeOneClickPayoutData,
  FundingOrderCreateData,
  IdempotencyProcessingReservation,
  JobCreateData,
  ListCampaignsQuery,
  Repository,
} from "./repository";
import type {
  AiGenerationReceiptEvidence,
  AiGenerationReceiptHandle,
  Campaign,
  CampaignStatus,
  Claim,
  ClaimStatus,
  FundingOrder,
  FundingOrderStatus,
  IdempotencyRecord,
  Job,
  JsonValue,
  OperationEvent,
} from "./types";

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function campaignFromRow(row: QueryResultRow): Campaign {
  return {
    id: row.id,
    slug: row.slug,
    creatorId: row.creator_id,
    creatorAccountId: row.creator_account_id,
    title: row.title,
    description: row.description,
    sponsorName: row.sponsor_name,
    sponsorUrl: row.sponsor_url,
    visibility: row.visibility,
    status: row.status,
    puzzle: row.puzzle,
    contentHash: row.content_hash,
    solutionPublicKey: row.solution_public_key,
    reward: row.reward_spec,
    contractId: row.contract_id,
    openingAt: iso(row.opening_at),
    expiresAt: iso(row.expires_at),
    refundAccount: row.refund_account,
    fundingReference: row.funding_reference,
    chainCampaignId: row.chain_campaign_id,
    aiGenerationReceipt:
      typeof row.ai_payment_identifier === "string"
        ? {
            paymentIdentifier: row.ai_payment_identifier,
            receiptDigest: row.ai_receipt_digest,
            network: row.ai_payment_network,
            settlementReference: row.ai_settlement_reference,
          }
        : null,
    version: row.version,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function fundingOrderFromRow(row: QueryResultRow): FundingOrder {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    creatorId: row.creator_id,
    rail: row.rail,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    originAssetId: row.origin_asset_id,
    destinationAssetId: row.destination_asset_id,
    principalAmountAtomic: String(row.principal_amount_atomic),
    inputAmountAtomic: String(row.input_amount_atomic),
    routingFeeAtomic: String(row.routing_fee_atomic),
    platformFeeAtomic: String(row.platform_fee_atomic),
    refundTo: row.refund_to,
    quote: row.quote,
    providerReference: row.provider_reference,
    depositAddress: row.deposit_address,
    depositTxHash: row.deposit_tx_hash,
    settlementTxHash: row.settlement_tx_hash,
    fundingReference: row.funding_reference,
    evidence: row.evidence,
    expiresAt: iso(row.expires_at)!,
    version: row.version,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function claimFromRow(row: QueryResultRow): Claim {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    claimantId: row.claimant_id,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    payout: row.payout,
    payoutQuote: row.payout_quote,
    solutionProofDigest: row.solution_proof_digest,
    solutionProof: row.solution_proof,
    contractTxHash: row.contract_tx_hash,
    settlementTxHash: row.settlement_tx_hash,
    evidence: row.evidence,
    expiresAt: iso(row.expires_at)!,
    version: row.version,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function eventFromRow(row: QueryResultRow): OperationEvent {
  return {
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    actorId: row.actor_id,
    fromState: row.from_state,
    toState: row.to_state,
    idempotencyKey: row.idempotency_key,
    evidence: row.evidence,
    createdAt: iso(row.created_at)!,
  };
}

function idempotencyFromRow(row: QueryResultRow): IdempotencyRecord {
  return {
    scope: row.scope,
    actorId: row.actor_id,
    key: row.idempotency_key,
    requestHash: row.request_hash,
    state: row.state,
    responseStatus: row.response_status,
    responseBody: row.response_body,
    paymentReference: row.payment_reference,
    authorizationDigest: row.authorization_digest,
    processingStage: row.processing_stage,
    processingOwner: row.processing_owner ?? null,
    processingLeaseExpiresAt: iso(row.processing_lease_expires_at),
    processingVersion: Number(row.processing_version ?? 0),
    expiresAt: iso(row.expires_at)!,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function jobFromRow(row: QueryResultRow): Job {
  return {
    id: row.id,
    type: row.type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    deduplicationKey: row.deduplication_key,
    status: row.status,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: iso(row.run_after)!,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: iso(row.lease_expires_at),
    lastError: row.last_error,
    result: row.result,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

class CasConflict extends Error {}

function uniqueConstraint(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("constraint" in error)) {
    return null;
  }
  return typeof error.constraint === "string" ? error.constraint : null;
}

async function insertCampaign(
  client: Pool | PoolClient,
  input: CampaignCreateData,
  receipt: AiGenerationReceiptEvidence | null,
): Promise<Campaign> {
  const result = await client.query(
    `INSERT INTO v2_campaigns (
      id, slug, creator_id, creator_account_id, title, description,
      sponsor_name, sponsor_url, visibility, status, puzzle, content_hash,
      solution_public_key, reward_spec, contract_id, opening_at, expires_at,
      refund_account, funding_reference, chain_campaign_id,
      ai_payment_identifier, ai_receipt_digest, ai_payment_network,
      ai_settlement_reference
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
      $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
    ) RETURNING *`,
    [
      input.id ?? randomUUID(),
      input.slug,
      input.creatorId,
      input.creatorAccountId,
      input.title,
      input.description,
      input.sponsorName,
      input.sponsorUrl,
      input.visibility,
      input.status,
      input.puzzle,
      input.contentHash,
      input.solutionPublicKey,
      input.reward,
      input.contractId,
      input.openingAt,
      input.expiresAt,
      input.refundAccount,
      input.fundingReference,
      input.chainCampaignId,
      receipt?.paymentIdentifier ?? null,
      receipt?.receiptDigest ?? null,
      receipt?.network ?? null,
      receipt?.settlementReference ?? null,
    ],
  );
  return campaignFromRow(result.rows[0]);
}

export class PostgresRepository implements Repository {
  readonly kind = "postgres" as const;

  constructor(private readonly pool: Pool) {}

  async createCampaign(
    input: CampaignCreateData,
    aiReceiptHandle: AiGenerationReceiptHandle | null = null,
  ): Promise<Campaign> {
    try {
      if (!aiReceiptHandle) {
        return await insertCampaign(this.pool, input, null);
      }
      return await transaction(this.pool, async (client) => {
        const stored = await client.query(
          `SELECT * FROM v2_idempotency_records
           WHERE scope = $1
             AND actor_id = $2
             AND idempotency_key = $3
           FOR UPDATE`,
          [
            AI_GENERATION_IDEMPOTENCY_SCOPE,
            AI_GENERATION_IDEMPOTENCY_ACTOR,
            aiReceiptHandle.paymentIdentifier,
          ],
        );
        if (!stored.rowCount) {
          throw new AppError(
            409,
            "AI_RECEIPT_UNVERIFIED",
            "The paid AI generation receipt could not be verified",
          );
        }
        const receipt = verifyAiGenerationReceipt(
          aiReceiptHandle,
          idempotencyFromRow(stored.rows[0]),
        );
        return insertCampaign(client, input, receipt);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (
          uniqueConstraint(error) ===
          "v2_campaigns_ai_payment_identifier_unique"
        ) {
          throw new AppError(
            409,
            "AI_RECEIPT_ALREADY_USED",
            "This paid AI generation receipt is already linked to a campaign",
          );
        }
        throw new AppError(409, "SLUG_OR_ID_TAKEN", "Campaign id or slug is already in use");
      }
      throw error;
    }
  }

  async getCampaign(idOrSlug: string): Promise<Campaign | null> {
    const result = await this.pool.query(
      `SELECT * FROM v2_campaigns
       WHERE id::TEXT = $1 OR LOWER(slug) = LOWER($1)
       LIMIT 1`,
      [idOrSlug],
    );
    return result.rowCount ? campaignFromRow(result.rows[0]) : null;
  }

  async listCampaigns(
    query: ListCampaignsQuery,
  ): Promise<{ campaigns: Campaign[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };
    if (query.status) add("status = ?", query.status);
    if (query.statuses?.length) {
      add("status::TEXT = ANY(?::TEXT[])", query.statuses);
    }
    if (query.creatorId) add("creator_id = ?", query.creatorId);
    if (query.visibility) add("visibility = ?", query.visibility);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const count = await this.pool.query(
      `SELECT COUNT(*)::INTEGER AS total FROM v2_campaigns ${where}`,
      values,
    );
    values.push(query.limit, query.offset);
    const rows = await this.pool.query(
      `SELECT * FROM v2_campaigns ${where}
       ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      campaigns: rows.rows.map(campaignFromRow),
      total: count.rows[0].total,
    };
  }

  async updateCampaignDraft(
    id: string,
    creatorId: string,
    expectedVersion: number,
    patch: CampaignDraftPatch,
  ): Promise<Campaign | null> {
    const columns: Record<keyof CampaignDraftPatch, string> = {
      slug: "slug",
      creatorAccountId: "creator_account_id",
      title: "title",
      description: "description",
      sponsorName: "sponsor_name",
      sponsorUrl: "sponsor_url",
      visibility: "visibility",
      puzzle: "puzzle",
      contentHash: "content_hash",
      solutionPublicKey: "solution_public_key",
      reward: "reward_spec",
      openingAt: "opening_at",
      expiresAt: "expires_at",
      refundAccount: "refund_account",
    };
    const values: unknown[] = [];
    const assignments = Object.entries(patch).map(([key, value]) => {
      values.push(value);
      return `${columns[key as keyof CampaignDraftPatch]} = $${values.length}`;
    });
    if (assignments.length === 0) return this.getCampaign(id);
    values.push(id, creatorId, expectedVersion);
    try {
      const result = await this.pool.query(
        `UPDATE v2_campaigns SET
           ${assignments.join(", ")}, version = version + 1, updated_at = NOW()
         WHERE id = $${values.length - 2}
           AND creator_id = $${values.length - 1}
           AND status = 'DRAFT'
           AND version = $${values.length}
         RETURNING *`,
        values,
      );
      return result.rowCount ? campaignFromRow(result.rows[0]) : null;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(409, "SLUG_TAKEN", "Campaign slug is already in use");
      }
      throw error;
    }
  }

  async transitionCampaign(
    id: string,
    from: CampaignStatus[],
    to: CampaignStatus,
    expectedVersion: number,
    patch: Partial<
      Pick<
        Campaign,
        "fundingReference" | "chainCampaignId" | "contractId" | "openingAt" | "expiresAt"
      >
    > = {},
  ): Promise<Campaign | null> {
    const columns: Record<string, string> = {
      fundingReference: "funding_reference",
      chainCampaignId: "chain_campaign_id",
      contractId: "contract_id",
      openingAt: "opening_at",
      expiresAt: "expires_at",
    };
    const values: unknown[] = [to];
    const assignments = Object.entries(patch).map(([key, value]) => {
      values.push(value);
      return `${columns[key]} = $${values.length}`;
    });
    values.push(id, from, expectedVersion);
    const result = await this.pool.query(
      `UPDATE v2_campaigns SET status = $1,
         ${assignments.length ? `${assignments.join(", ")},` : ""}
         version = version + 1, updated_at = NOW()
       WHERE id = $${values.length - 2}
         AND status = ANY($${values.length - 1}::TEXT[])
         AND version = $${values.length}
       RETURNING *`,
      values,
    );
    return result.rowCount ? campaignFromRow(result.rows[0]) : null;
  }

  async createFundingOrderIdempotent(
    input: FundingOrderCreateData,
  ): Promise<{ fundingOrder: FundingOrder; created: boolean }> {
    try {
      const result = await this.pool.query(
        `INSERT INTO v2_funding_orders (
          id, campaign_id, creator_id, rail, status, idempotency_key,
          origin_asset_id, destination_asset_id, principal_amount_atomic,
          input_amount_atomic, routing_fee_atomic, platform_fee_atomic,
          refund_to, quote, provider_reference, deposit_address,
          deposit_tx_hash, settlement_tx_hash, funding_reference, evidence,
          expires_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20, $21
        )
        ON CONFLICT (creator_id, idempotency_key) DO NOTHING
        RETURNING *`,
        [
          input.id ?? randomUUID(),
          input.campaignId,
          input.creatorId,
          input.rail,
          input.status,
          input.idempotencyKey,
          input.originAssetId,
          input.destinationAssetId,
          input.principalAmountAtomic,
          input.inputAmountAtomic,
          input.routingFeeAtomic,
          input.platformFeeAtomic,
          input.refundTo,
          input.quote,
          input.providerReference,
          input.depositAddress,
          input.depositTxHash,
          input.settlementTxHash,
          input.fundingReference,
          input.evidence,
          input.expiresAt,
        ],
      );
      if (result.rowCount) {
        return { fundingOrder: fundingOrderFromRow(result.rows[0]), created: true };
      }
      const existing = await this.pool.query(
        `SELECT * FROM v2_funding_orders
         WHERE creator_id = $1 AND idempotency_key = $2`,
        [input.creatorId, input.idempotencyKey],
      );
      return { fundingOrder: fundingOrderFromRow(existing.rows[0]), created: false };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const open = await this.pool.query(
          `SELECT id FROM v2_funding_orders
           WHERE campaign_id = $1
             AND status NOT IN ('REFUNDED', 'FAILED', 'EXPIRED')
           LIMIT 1`,
          [input.campaignId],
        );
        throw new AppError(
          409,
          "FUNDING_ORDER_EXISTS",
          "Campaign already has an open funding order",
          open.rowCount ? { fundingOrderId: open.rows[0].id } : undefined,
        );
      }
      throw error;
    }
  }

  async createFundingOrderAndFreezeCampaign(
    input: FundingOrderCreateData,
    campaignExpectedVersion: number,
  ): Promise<
    { fundingOrder: FundingOrder; campaign: Campaign; created: boolean } | null
  > {
    try {
      return await transaction(this.pool, async (client) => {
        const existing = await client.query(
          `SELECT * FROM v2_funding_orders
           WHERE creator_id = $1 AND idempotency_key = $2`,
          [input.creatorId, input.idempotencyKey],
        );
        if (existing.rowCount) {
          const campaign = await client.query(
            "SELECT * FROM v2_campaigns WHERE id = $1",
            [existing.rows[0].campaign_id],
          );
          return campaign.rowCount
            ? {
                fundingOrder: fundingOrderFromRow(existing.rows[0]),
                campaign: campaignFromRow(campaign.rows[0]),
                created: false,
              }
            : null;
        }
        const campaign = await client.query(
          "SELECT * FROM v2_campaigns WHERE id = $1 FOR UPDATE",
          [input.campaignId],
        );
        if (
          !campaign.rowCount ||
          campaign.rows[0].creator_id !== input.creatorId ||
          campaign.rows[0].status !== "DRAFT" ||
          campaign.rows[0].version !== campaignExpectedVersion
        ) {
          throw new CasConflict();
        }
        const inserted = await client.query(
          `INSERT INTO v2_funding_orders (
            id, campaign_id, creator_id, rail, status, idempotency_key,
            origin_asset_id, destination_asset_id, principal_amount_atomic,
            input_amount_atomic, routing_fee_atomic, platform_fee_atomic,
            refund_to, quote, provider_reference, deposit_address,
            deposit_tx_hash, settlement_tx_hash, funding_reference, evidence,
            expires_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18, $19, $20, $21
          )
          RETURNING *`,
          [
            input.id ?? randomUUID(),
            input.campaignId,
            input.creatorId,
            input.rail,
            input.status,
            input.idempotencyKey,
            input.originAssetId,
            input.destinationAssetId,
            input.principalAmountAtomic,
            input.inputAmountAtomic,
            input.routingFeeAtomic,
            input.platformFeeAtomic,
            input.refundTo,
            input.quote,
            input.providerReference,
            input.depositAddress,
            input.depositTxHash,
            input.settlementTxHash,
            input.fundingReference,
            input.evidence,
            input.expiresAt,
          ],
        );
        const frozen = await client.query(
          `UPDATE v2_campaigns SET status = 'FUNDING',
             version = version + 1, updated_at = NOW()
           WHERE id = $1 AND status = 'DRAFT' AND version = $2
           RETURNING *`,
          [input.campaignId, campaignExpectedVersion],
        );
        if (!frozen.rowCount) throw new CasConflict();
        return {
          fundingOrder: fundingOrderFromRow(inserted.rows[0]),
          campaign: campaignFromRow(frozen.rows[0]),
          created: true,
        };
      });
    } catch (error) {
      if (error instanceof CasConflict) return null;
      if (isUniqueViolation(error)) {
        const existing = await this.pool.query(
          `SELECT * FROM v2_funding_orders
           WHERE creator_id = $1 AND idempotency_key = $2`,
          [input.creatorId, input.idempotencyKey],
        );
        if (existing.rowCount) {
          const campaign = await this.pool.query(
            "SELECT * FROM v2_campaigns WHERE id = $1",
            [existing.rows[0].campaign_id],
          );
          if (campaign.rowCount) {
            return {
              fundingOrder: fundingOrderFromRow(existing.rows[0]),
              campaign: campaignFromRow(campaign.rows[0]),
              created: false,
            };
          }
        }
        const open = await this.pool.query(
          `SELECT id FROM v2_funding_orders
           WHERE campaign_id = $1
             AND status NOT IN ('REFUNDED', 'FAILED', 'EXPIRED')
           LIMIT 1`,
          [input.campaignId],
        );
        throw new AppError(
          409,
          "FUNDING_ORDER_EXISTS",
          "Campaign already has an open funding order",
          open.rowCount ? { fundingOrderId: open.rows[0].id } : undefined,
        );
      }
      throw error;
    }
  }

  async getFundingOrder(id: string): Promise<FundingOrder | null> {
    const result = await this.pool.query("SELECT * FROM v2_funding_orders WHERE id = $1", [
      id,
    ]);
    return result.rowCount ? fundingOrderFromRow(result.rows[0]) : null;
  }

  async getFundingOrderByIdempotency(
    creatorId: string,
    key: string,
  ): Promise<FundingOrder | null> {
    const result = await this.pool.query(
      `SELECT * FROM v2_funding_orders
       WHERE creator_id = $1 AND idempotency_key = $2`,
      [creatorId, key],
    );
    return result.rowCount ? fundingOrderFromRow(result.rows[0]) : null;
  }

  async getFundingOrderForCampaign(campaignId: string): Promise<FundingOrder | null> {
    const result = await this.pool.query(
      `SELECT * FROM v2_funding_orders
       WHERE campaign_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [campaignId],
    );
    return result.rowCount ? fundingOrderFromRow(result.rows[0]) : null;
  }

  async transitionFundingOrder(
    id: string,
    from: FundingOrderStatus[],
    to: FundingOrderStatus,
    expectedVersion: number,
    patch: Partial<
      Pick<
        FundingOrder,
        | "providerReference"
        | "depositTxHash"
        | "settlementTxHash"
        | "fundingReference"
        | "evidence"
      >
    > = {},
  ): Promise<FundingOrder | null> {
    const columns: Record<string, string> = {
      providerReference: "provider_reference",
      depositTxHash: "deposit_tx_hash",
      settlementTxHash: "settlement_tx_hash",
      fundingReference: "funding_reference",
      evidence: "evidence",
    };
    const values: unknown[] = [to];
    const assignments = Object.entries(patch).map(([key, value]) => {
      values.push(value);
      return `${columns[key]} = $${values.length}`;
    });
    values.push(id, from, expectedVersion);
    const result = await this.pool.query(
      `UPDATE v2_funding_orders SET status = $1,
         ${assignments.length ? `${assignments.join(", ")},` : ""}
         version = version + 1, updated_at = NOW()
       WHERE id = $${values.length - 2}
         AND status = ANY($${values.length - 1}::TEXT[])
         AND version = $${values.length}
       RETURNING *`,
      values,
    );
    return result.rowCount ? fundingOrderFromRow(result.rows[0]) : null;
  }

  async createClaimIdempotent(
    input: ClaimCreateData,
  ): Promise<{ claim: Claim; created: boolean }> {
    const claimantKey = input.claimantId ?? `anonymous:${input.idempotencyKey}`;
    const result = await this.pool.query(
      `INSERT INTO v2_claims (
        id, campaign_id, claimant_id, status, idempotency_key, payout,
        payout_quote, solution_proof_digest, solution_proof, contract_tx_hash,
        settlement_tx_hash, evidence, expires_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      )
      ON CONFLICT (claimant_id, idempotency_key) DO NOTHING
      RETURNING *`,
      [
        input.id ?? randomUUID(),
        input.campaignId,
        claimantKey,
        input.status,
        input.idempotencyKey,
        input.payout,
        input.payoutQuote,
        input.solutionProofDigest,
        input.solutionProof,
        input.contractTxHash,
        input.settlementTxHash,
        input.evidence,
        input.expiresAt,
      ],
    ).catch((error) => {
      throw error;
    });
    if (result.rowCount) return { claim: claimFromRow(result.rows[0]), created: true };
    const existing = await this.pool.query(
      `SELECT * FROM v2_claims WHERE claimant_id = $1 AND idempotency_key = $2`,
      [claimantKey, input.idempotencyKey],
    );
    return { claim: claimFromRow(existing.rows[0]), created: false };
  }

  async getClaim(id: string): Promise<Claim | null> {
    const result = await this.pool.query("SELECT * FROM v2_claims WHERE id = $1", [id]);
    return result.rowCount ? claimFromRow(result.rows[0]) : null;
  }

  async getClaimByIdempotency(
    claimantId: string,
    key: string,
  ): Promise<Claim | null> {
    const result = await this.pool.query(
      `SELECT * FROM v2_claims
       WHERE claimant_id = $1 AND idempotency_key = $2`,
      [claimantId, key],
    );
    return result.rowCount ? claimFromRow(result.rows[0]) : null;
  }

  async submitClaimAtomically(
    claimId: string,
    claimExpectedVersion: number,
    campaignExpectedVersion: number,
    solutionProofDigest: string,
    solutionProof: Claim["solutionProof"],
  ): Promise<{ claim: Claim; campaign: Campaign } | null> {
    try {
      return await transaction(this.pool, async (client) => {
        const claim = await client.query(
          `SELECT * FROM v2_claims WHERE id = $1 FOR UPDATE`,
          [claimId],
        );
        if (
          !claim.rowCount ||
          !["QUOTED", "AWAITING_PROOF"].includes(claim.rows[0].status) ||
          claim.rows[0].version !== claimExpectedVersion
        ) {
          throw new CasConflict();
        }
        const campaign = await client.query(
          `UPDATE v2_campaigns SET status = 'CLAIMING',
             version = version + 1, updated_at = NOW()
           WHERE id = $1 AND status = 'ACTIVE' AND version = $2
           RETURNING *`,
          [claim.rows[0].campaign_id, campaignExpectedVersion],
        );
        if (!campaign.rowCount) throw new CasConflict();
        const updatedClaim = await client.query(
          `UPDATE v2_claims SET status = 'SUBMITTED',
             solution_proof_digest = $2, solution_proof = $3,
             version = version + 1, updated_at = NOW()
           WHERE id = $1 AND version = $4
           RETURNING *`,
          [claimId, solutionProofDigest, solutionProof, claimExpectedVersion],
        );
        if (!updatedClaim.rowCount) throw new CasConflict();
        return {
          claim: claimFromRow(updatedClaim.rows[0]),
          campaign: campaignFromRow(campaign.rows[0]),
        };
      });
    } catch (error) {
      if (error instanceof CasConflict) return null;
      throw error;
    }
  }

  async transitionClaim(
    id: string,
    from: ClaimStatus[],
    to: ClaimStatus,
    expectedVersion: number,
    patch: Partial<
      Pick<
        Claim,
        | "solutionProofDigest"
        | "solutionProof"
        | "contractTxHash"
        | "settlementTxHash"
        | "evidence"
      >
    > = {},
  ): Promise<Claim | null> {
    const columns: Record<string, string> = {
      solutionProofDigest: "solution_proof_digest",
      solutionProof: "solution_proof",
      contractTxHash: "contract_tx_hash",
      settlementTxHash: "settlement_tx_hash",
      evidence: "evidence",
    };
    const values: unknown[] = [to];
    const assignments = Object.entries(patch).map(([key, value]) => {
      values.push(value);
      return `${columns[key]} = $${values.length}`;
    });
    values.push(id, from, expectedVersion);
    const result = await this.pool.query(
      `UPDATE v2_claims SET status = $1,
         ${assignments.length ? `${assignments.join(", ")},` : ""}
         version = version + 1, updated_at = NOW()
       WHERE id = $${values.length - 2}
         AND status = ANY($${values.length - 1}::TEXT[])
         AND version = $${values.length}
       RETURNING *`,
      values,
    );
    return result.rowCount ? claimFromRow(result.rows[0]) : null;
  }

  async finalizeOneClickPayoutAtomically(
    input: FinalizeOneClickPayoutData,
  ): Promise<{ claim: Claim; campaign: Campaign } | null> {
    return transaction(this.pool, async (client) => {
      const claimResult = await client.query(
        `SELECT * FROM v2_claims WHERE id = $1 FOR UPDATE`,
        [input.claimId],
      );
      if (!claimResult.rowCount) return null;
      let claim = claimFromRow(claimResult.rows[0]);

      const campaignResult = await client.query(
        `SELECT * FROM v2_campaigns WHERE id = $1 FOR UPDATE`,
        [input.campaignId],
      );
      if (!campaignResult.rowCount) return null;
      let campaign = campaignFromRow(campaignResult.rows[0]);

      if (
        claim.campaignId !== campaign.id ||
        claim.payout.kind !== "ONE_CLICK" ||
        !["PAYING", "FAILED", input.target].includes(claim.status) ||
        !["CLAIMING", "CLAIMED"].includes(campaign.status)
      ) {
        return null;
      }
      const terminalReceipt =
        claim.status === input.target
          ? claim.settlementTxHash
          : input.claimPatch?.settlementTxHash ?? claim.settlementTxHash;
      if (!terminalReceipt?.trim()) return null;

      if (claim.status !== input.target) {
        const claimPatch = input.claimPatch ?? {};
        const values: unknown[] = [input.claimId, input.target];
        const assignments = ["status = $2"];
        if (
          Object.prototype.hasOwnProperty.call(
            claimPatch,
            "settlementTxHash",
          )
        ) {
          values.push(claimPatch.settlementTxHash);
          assignments.push(`settlement_tx_hash = $${values.length}`);
        }
        if (
          Object.prototype.hasOwnProperty.call(claimPatch, "evidence")
        ) {
          values.push(claimPatch.evidence);
          assignments.push(`evidence = $${values.length}`);
        }
        const updatedClaim = await client.query(
          `UPDATE v2_claims
           SET ${assignments.join(", ")},
               version = version + 1,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          values,
        );
        if (!updatedClaim.rowCount) {
          throw new Error("Locked 1Click claim disappeared during finalization");
        }
        claim = claimFromRow(updatedClaim.rows[0]);
      }

      if (campaign.status !== "CLAIMED") {
        const updatedCampaign = await client.query(
          `UPDATE v2_campaigns
           SET status = 'CLAIMED',
               version = version + 1,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [campaign.id],
        );
        if (!updatedCampaign.rowCount) {
          throw new Error(
            "Locked 1Click campaign disappeared during finalization",
          );
        }
        campaign = campaignFromRow(updatedCampaign.rows[0]);
      }

      return { claim, campaign };
    });
  }

  async appendEvent(input: EventCreateData): Promise<OperationEvent> {
    const result = await this.pool.query(
      `INSERT INTO v2_operation_events (
        id, aggregate_type, aggregate_id, event_type, actor_id, from_state,
        to_state, idempotency_key, evidence
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT DO NOTHING
      RETURNING *`,
      [
        input.id ?? randomUUID(),
        input.aggregateType,
        input.aggregateId,
        input.eventType,
        input.actorId,
        input.fromState,
        input.toState,
        input.idempotencyKey,
        input.evidence,
      ],
    );
    if (result.rowCount) return eventFromRow(result.rows[0]);
    const existing = await this.pool.query(
      `SELECT * FROM v2_operation_events
       WHERE aggregate_type = $1
         AND aggregate_id = $2
         AND event_type = $3
         AND idempotency_key = $4
       ORDER BY created_at
       LIMIT 1`,
      [
        input.aggregateType,
        input.aggregateId,
        input.eventType,
        input.idempotencyKey,
      ],
    );
    if (!existing.rowCount) {
      throw new AppError(409, "EVENT_CONFLICT", "Operation event could not be recorded");
    }
    return eventFromRow(existing.rows[0]);
  }

  async listEvents(aggregateType: string, aggregateId: string): Promise<OperationEvent[]> {
    const result = await this.pool.query(
      `SELECT * FROM v2_operation_events
       WHERE aggregate_type = $1 AND aggregate_id = $2
       ORDER BY created_at`,
      [aggregateType, aggregateId],
    );
    return result.rows.map(eventFromRow);
  }

  async getLiveLiabilities(): Promise<{
    amountAtomic: string;
    campaignCount: number;
    routingInFlightAmountAtomic: string;
    routingInFlightCampaignCount: number;
  }> {
    const result = await this.pool.query(
      `WITH liabilities AS (
         SELECT
           c.id,
           (c.reward_spec ->> 'amountAtomic')::NUMERIC AS amount_atomic,
           EXISTS (
             SELECT 1
             FROM v2_claims cl
             WHERE cl.campaign_id = c.id
               AND c.status = 'CLAIMING'
               AND cl.payout ->> 'kind' = 'ONE_CLICK'
               AND cl.status IN ('PAYING', 'FAILED')
               AND cl.evidence ->> 'contractState' = 'claimed'
           ) AS routing_in_flight,
           EXISTS (
             SELECT 1
             FROM v2_claims cl
             WHERE cl.campaign_id = c.id
               AND c.status = 'CLAIMING'
               AND cl.payout ->> 'kind' = 'ONE_CLICK'
               AND (
                 (
                   cl.status IN ('PAID', 'RECOVERED')
                   AND NULLIF(cl.settlement_tx_hash, '') IS NOT NULL
                 )
                 OR (
                   cl.status IN ('PAYING', 'FAILED')
                   AND cl.evidence ->> 'contractState' = 'claimed'
                 )
               )
           ) AS released_from_escrow
         FROM v2_campaigns c
         WHERE c.status IN ('SCHEDULED', 'ACTIVE', 'CLAIMING', 'REFUNDING')
           AND c.reward_spec ->> 'type' = 'TOKEN_PRIZE'
       )
       SELECT
         COALESCE(
           SUM(amount_atomic) FILTER (WHERE NOT released_from_escrow),
           0
         )::TEXT AS amount_atomic,
         COUNT(*) FILTER (WHERE NOT released_from_escrow)::INTEGER
           AS campaign_count,
         COALESCE(
           SUM(amount_atomic) FILTER (WHERE routing_in_flight),
           0
         )::TEXT AS routing_in_flight_amount_atomic,
         COUNT(*) FILTER (WHERE routing_in_flight)::INTEGER
           AS routing_in_flight_campaign_count
       FROM liabilities`,
    );
    return {
      amountAtomic: String(result.rows[0].amount_atomic),
      campaignCount: Number(result.rows[0].campaign_count),
      routingInFlightAmountAtomic: String(
        result.rows[0].routing_in_flight_amount_atomic,
      ),
      routingInFlightCampaignCount: Number(
        result.rows[0].routing_in_flight_campaign_count,
      ),
    };
  }

  async reserveIdempotency(
    scope: string,
    actorId: string,
    key: string,
    requestHash: string,
    expiresAt: string,
    processing?: IdempotencyProcessingReservation,
  ): Promise<{ record: IdempotencyRecord; created: boolean }> {
    return transaction(this.pool, async (client) => {
      await client.query(
       `DELETE FROM v2_idempotency_records
         WHERE scope = $1 AND actor_id = $2 AND idempotency_key = $3
           AND expires_at <= NOW()
           AND scope <> 'AI_GENERATE_X402_V2'
           AND NOT (
             state = 'PROCESSING'
             AND authorization_digest IS NOT NULL
           )`,
        [scope, actorId, key],
      );
      const inserted = await client.query(
        `INSERT INTO v2_idempotency_records (
           scope, actor_id, idempotency_key, request_hash, expires_at,
           authorization_digest, processing_stage, response_body
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           COALESCE($8::JSONB, 'null'::JSONB)
         )
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          scope,
          actorId,
          key,
          requestHash,
          expiresAt,
          processing?.authorizationDigest ?? null,
          processing?.stage ?? null,
          processing?.responseBody ?? null,
        ],
      );
      if (inserted.rowCount) {
        return { record: idempotencyFromRow(inserted.rows[0]), created: true };
      }
      const existing = await client.query(
        `SELECT * FROM v2_idempotency_records
         WHERE scope = $1 AND actor_id = $2 AND idempotency_key = $3`,
        [scope, actorId, key],
      );
      return { record: idempotencyFromRow(existing.rows[0]), created: false };
    });
  }

  async getIdempotency(
    scope: string,
    actorId: string,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM v2_idempotency_records
       WHERE scope = $1 AND actor_id = $2 AND idempotency_key = $3
         AND (
           expires_at > NOW()
           OR scope = 'AI_GENERATE_X402_V2'
           OR (
             state = 'PROCESSING'
             AND authorization_digest IS NOT NULL
           )
         )`,
      [scope, actorId, key],
    );
    return result.rowCount ? idempotencyFromRow(result.rows[0]) : null;
  }

  async acquireIdempotencyProcessingLease(
    scope: string,
    actorId: string,
    key: string,
    requestHash: string,
    authorizationDigest: string,
    ownerId: string,
    acquiredAt: string,
    leaseExpiresAt: string,
  ): Promise<{ record: IdempotencyRecord; acquired: boolean }> {
    return transaction(this.pool, async (client) => {
      const acquired = await client.query(
        `UPDATE v2_idempotency_records SET
           processing_owner = $6,
           processing_lease_expires_at = $8,
           processing_version = processing_version + 1,
           updated_at = $7
         WHERE scope = $1 AND actor_id = $2 AND idempotency_key = $3
           AND request_hash = $4 AND state = 'PROCESSING'
           AND authorization_digest = $5
           AND (
             processing_owner IS NULL
             OR processing_lease_expires_at <= $7::TIMESTAMPTZ
           )
         RETURNING *`,
        [
          scope,
          actorId,
          key,
          requestHash,
          authorizationDigest,
          ownerId,
          acquiredAt,
          leaseExpiresAt,
        ],
      );
      if (acquired.rowCount) {
        return {
          record: idempotencyFromRow(acquired.rows[0]),
          acquired: true,
        };
      }
      const current = await client.query(
        `SELECT * FROM v2_idempotency_records
         WHERE scope = $1 AND actor_id = $2 AND idempotency_key = $3`,
        [scope, actorId, key],
      );
      if (!current.rowCount) {
        throw new AppError(
          404,
          "IDEMPOTENCY_NOT_FOUND",
          "Request was not reserved",
        );
      }
      return {
        record: idempotencyFromRow(current.rows[0]),
        acquired: false,
      };
    });
  }

  async advanceIdempotencyProcessing(
    scope: string,
    actorId: string,
    key: string,
    requestHash: string,
    authorizationDigest: string,
    ownerId: string,
    expectedVersion: number,
    fromStage: IdempotencyProcessingReservation["stage"],
    toStage: IdempotencyProcessingReservation["stage"],
    responseBody: JsonValue,
    leaseExpiresAt: string | null,
  ): Promise<IdempotencyRecord | null> {
    const result = await this.pool.query(
      `UPDATE v2_idempotency_records SET
         processing_stage = $9,
         response_body = COALESCE($10::JSONB, 'null'::JSONB),
         processing_owner =
           CASE WHEN $9 = 'SETTLEMENT_UNKNOWN' THEN NULL ELSE $6 END,
         processing_lease_expires_at = $11,
         processing_version = processing_version + 1,
         updated_at = NOW()
       WHERE scope = $1 AND actor_id = $2 AND idempotency_key = $3
         AND request_hash = $4 AND state = 'PROCESSING'
         AND authorization_digest = $5
         AND processing_owner = $6
         AND processing_version = $7
         AND processing_stage = $8
         AND (
           ($8 = 'AUTHORIZED' AND $9 = 'GENERATED')
           OR ($8 = 'GENERATED' AND $9 = 'SETTLING')
           OR ($8 = 'SETTLING' AND $9 = 'SETTLED')
           OR ($8 = 'SETTLING' AND $9 = 'SETTLEMENT_UNKNOWN')
           OR ($8 = 'SETTLEMENT_UNKNOWN' AND $9 = 'SETTLING')
         )
         AND (
           ($9 = 'SETTLEMENT_UNKNOWN' AND $11::TIMESTAMPTZ IS NULL)
           OR ($9 <> 'SETTLEMENT_UNKNOWN' AND $11::TIMESTAMPTZ IS NOT NULL)
         )
       RETURNING *`,
      [
        scope,
        actorId,
        key,
        requestHash,
        authorizationDigest,
        ownerId,
        expectedVersion,
        fromStage,
        toStage,
        responseBody,
        leaseExpiresAt,
      ],
    );
    return result.rowCount ? idempotencyFromRow(result.rows[0]) : null;
  }

  async finishOwnedIdempotency(
    scope: string,
    actorId: string,
    key: string,
    ownerId: string,
    expectedVersion: number,
    expectedStage: IdempotencyProcessingReservation["stage"],
    state: "COMPLETED" | "FAILED",
    responseStatus: number,
    responseBody: JsonValue,
    paymentReference: string | null = null,
  ): Promise<IdempotencyRecord | null> {
    const result = await this.pool.query(
      `UPDATE v2_idempotency_records SET
         state = $7,
         response_status = $8,
         response_body = COALESCE($9::JSONB, 'null'::JSONB),
         payment_reference = $10,
         processing_stage = NULL,
         processing_owner = NULL,
         processing_lease_expires_at = NULL,
         processing_version = processing_version + 1,
         updated_at = NOW()
       WHERE scope = $1 AND actor_id = $2 AND idempotency_key = $3
         AND state = 'PROCESSING'
         AND processing_owner = $4
         AND processing_version = $5
         AND processing_stage = $6
       RETURNING *`,
      [
        scope,
        actorId,
        key,
        ownerId,
        expectedVersion,
        expectedStage,
        state,
        responseStatus,
        responseBody,
        paymentReference,
      ],
    );
    return result.rowCount ? idempotencyFromRow(result.rows[0]) : null;
  }

  async completeIdempotency(
    scope: string,
    actorId: string,
    key: string,
    responseStatus: number,
    responseBody: JsonValue,
    paymentReference: string | null = null,
  ): Promise<IdempotencyRecord> {
    return this.finishIdempotency(
      scope,
      actorId,
      key,
      "COMPLETED",
      responseStatus,
      responseBody,
      paymentReference,
    );
  }

  async failIdempotency(
    scope: string,
    actorId: string,
    key: string,
    responseStatus: number,
    responseBody: JsonValue,
  ): Promise<IdempotencyRecord> {
    return this.finishIdempotency(
      scope,
      actorId,
      key,
      "FAILED",
      responseStatus,
      responseBody,
      null,
    );
  }

  private async finishIdempotency(
    scope: string,
    actorId: string,
    key: string,
    state: "COMPLETED" | "FAILED",
    responseStatus: number,
    responseBody: JsonValue,
    paymentReference: string | null,
  ): Promise<IdempotencyRecord> {
    const result = await this.pool.query(
      `UPDATE v2_idempotency_records SET
         state = $4, response_status = $5,
         response_body = COALESCE($6::JSONB, 'null'::JSONB),
         payment_reference = $7, processing_stage = NULL,
         processing_owner = NULL, processing_lease_expires_at = NULL,
         processing_version = processing_version + 1, updated_at = NOW()
       WHERE scope = $1 AND actor_id = $2 AND idempotency_key = $3
         AND state = 'PROCESSING' AND processing_owner IS NULL
       RETURNING *`,
      [scope, actorId, key, state, responseStatus, responseBody, paymentReference],
    );
    if (!result.rowCount) {
      throw new AppError(409, "IDEMPOTENCY_STATE_CONFLICT", "Request is not processing");
    }
    return idempotencyFromRow(result.rows[0]);
  }

  async enqueueJob(input: JobCreateData): Promise<{ job: Job; created: boolean }> {
    const result = await this.pool.query(
      `INSERT INTO v2_jobs (
        id, type, aggregate_type, aggregate_id, deduplication_key,
        payload, max_attempts, run_after
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (deduplication_key) DO NOTHING
      RETURNING *`,
      [
        input.id ?? randomUUID(),
        input.type,
        input.aggregateType,
        input.aggregateId,
        input.deduplicationKey,
        input.payload,
        input.maxAttempts,
        input.runAfter,
      ],
    );
    if (result.rowCount) return { job: jobFromRow(result.rows[0]), created: true };
    if (input.reactivateDead) {
      const revived = await this.pool.query(
        `UPDATE v2_jobs SET
           status = 'PENDING', payload = $2, attempts = 0,
           max_attempts = $3, run_after = $4,
           lease_owner = NULL, lease_expires_at = NULL,
           last_error = NULL, result = 'null'::JSONB, updated_at = NOW()
         WHERE deduplication_key = $1 AND status = 'DEAD'
         RETURNING *`,
        [
          input.deduplicationKey,
          input.payload,
          input.maxAttempts,
          input.runAfter,
        ],
      );
      if (revived.rowCount) {
        return { job: jobFromRow(revived.rows[0]), created: false };
      }
    }
    const existing = await this.pool.query(
      "SELECT * FROM v2_jobs WHERE deduplication_key = $1",
      [input.deduplicationKey],
    );
    return { job: jobFromRow(existing.rows[0]), created: false };
  }

  async leaseJobs(
    workerId: string,
    limit: number,
    leaseUntil: string,
    current = new Date().toISOString(),
  ): Promise<Job[]> {
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `WITH candidates AS (
           SELECT id FROM v2_jobs
           WHERE (
             status = 'PENDING'
             OR (status = 'RUNNING' AND lease_expires_at <= $4)
           )
             AND run_after <= $4
             AND attempts < max_attempts
           ORDER BY run_after, created_at
           FOR UPDATE SKIP LOCKED
           LIMIT $3
         )
         UPDATE v2_jobs AS jobs SET
           status = 'RUNNING', attempts = jobs.attempts + 1,
           lease_owner = $1, lease_expires_at = $2, updated_at = $4
         FROM candidates
         WHERE jobs.id = candidates.id
         RETURNING jobs.*`,
        [workerId, leaseUntil, limit, current],
      );
      return result.rows.map(jobFromRow);
    });
  }

  async completeJob(id: string, workerId: string, resultValue: JsonValue): Promise<Job | null> {
    const result = await this.pool.query(
      `UPDATE v2_jobs SET status = 'SUCCEEDED', result = $3,
         lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'RUNNING' AND lease_owner = $2
       RETURNING *`,
      [id, workerId, resultValue],
    );
    return result.rowCount ? jobFromRow(result.rows[0]) : null;
  }

  async rescheduleJob(
    id: string,
    workerId: string,
    resultValue: JsonValue,
    runAfter: string,
  ): Promise<Job | null> {
    const result = await this.pool.query(
      `UPDATE v2_jobs SET
         status = 'PENDING', attempts = 0, run_after = $4, result = $3,
         last_error = NULL, lease_owner = NULL, lease_expires_at = NULL,
         updated_at = NOW()
       WHERE id = $1 AND status = 'RUNNING' AND lease_owner = $2
       RETURNING *`,
      [id, workerId, resultValue, runAfter],
    );
    return result.rowCount ? jobFromRow(result.rows[0]) : null;
  }

  async failJob(
    id: string,
    workerId: string,
    error: string,
    retryAt: string,
  ): Promise<Job | null> {
    const result = await this.pool.query(
      `UPDATE v2_jobs SET
         status = CASE WHEN attempts >= max_attempts THEN 'DEAD' ELSE 'PENDING' END,
         run_after = $4, last_error = $3,
         lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'RUNNING' AND lease_owner = $2
       RETURNING *`,
      [id, workerId, error.slice(0, 2_000), retryAt],
    );
    return result.rowCount ? jobFromRow(result.rows[0]) : null;
  }
}
