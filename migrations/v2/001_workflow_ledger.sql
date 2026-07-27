-- Crossword Campaigns v2 uses application-generated UUIDs so this migration
-- does not require pgcrypto or uuid-ossp.
CREATE TABLE IF NOT EXISTS v2_campaigns (
    id                    UUID PRIMARY KEY,
    slug                  TEXT NOT NULL,
    creator_id            TEXT NOT NULL,
    creator_account_id    TEXT,
    title                 TEXT NOT NULL,
    description           TEXT,
    sponsor_name          TEXT,
    sponsor_url           TEXT,
    visibility            TEXT NOT NULL DEFAULT 'PUBLIC'
                              CHECK (visibility IN ('PUBLIC', 'UNLISTED')),
    status                TEXT NOT NULL DEFAULT 'DRAFT'
                              CHECK (status IN (
                                  'DRAFT', 'FUNDING', 'SCHEDULED', 'ACTIVE',
                                  'CLAIMING', 'CLAIMED', 'REFUNDING',
                                  'REFUNDED', 'CANCELLED'
                              )),
    puzzle                JSONB NOT NULL,
    content_hash          TEXT,
    solution_public_key   TEXT,
    reward_spec           JSONB NOT NULL,
    contract_id           TEXT,
    opening_at            TIMESTAMPTZ,
    expires_at            TIMESTAMPTZ,
    refund_account        TEXT,
    funding_reference     TEXT,
    chain_campaign_id     TEXT,
    version               INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (char_length(slug) BETWEEN 3 AND 80),
    CHECK (char_length(title) BETWEEN 3 AND 160),
    CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS v2_campaigns_slug_unique
    ON v2_campaigns (LOWER(slug));
CREATE INDEX IF NOT EXISTS v2_campaigns_public_feed
    ON v2_campaigns (status, opening_at, created_at DESC)
    WHERE visibility = 'PUBLIC';
CREATE INDEX IF NOT EXISTS v2_campaigns_creator
    ON v2_campaigns (creator_id, created_at DESC);

CREATE TABLE IF NOT EXISTS v2_funding_orders (
    id                       UUID PRIMARY KEY,
    campaign_id              UUID NOT NULL REFERENCES v2_campaigns(id) ON DELETE RESTRICT,
    creator_id               TEXT NOT NULL,
    rail                     TEXT NOT NULL CHECK (rail IN ('DIRECT_NEAR', 'ONE_CLICK', 'MOCK')),
    status                   TEXT NOT NULL CHECK (status IN (
                                 'QUOTED', 'AWAITING_DEPOSIT', 'DEPOSIT_DETECTED',
                                 'PROCESSING', 'SETTLED', 'ALLOCATING', 'ALLOCATED',
                                 'INCOMPLETE', 'REFUNDED', 'FAILED', 'EXPIRED'
                             )),
    idempotency_key          TEXT NOT NULL,
    origin_asset_id          TEXT NOT NULL,
    destination_asset_id     TEXT NOT NULL,
    principal_amount_atomic  NUMERIC(78, 0) NOT NULL CHECK (principal_amount_atomic > 0),
    input_amount_atomic      NUMERIC(78, 0) NOT NULL CHECK (input_amount_atomic > 0),
    routing_fee_atomic       NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (routing_fee_atomic >= 0),
    platform_fee_atomic      NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (platform_fee_atomic >= 0),
    refund_to                TEXT NOT NULL,
    quote                    JSONB NOT NULL,
    provider_reference       TEXT,
    deposit_address          TEXT NOT NULL,
    deposit_tx_hash          TEXT,
    settlement_tx_hash       TEXT,
    funding_reference        TEXT,
    evidence                 JSONB NOT NULL DEFAULT '{}'::JSONB,
    expires_at               TIMESTAMPTZ NOT NULL,
    version                  INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (creator_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS v2_funding_orders_open_campaign
    ON v2_funding_orders (campaign_id)
    WHERE status NOT IN ('REFUNDED', 'FAILED', 'EXPIRED');
CREATE UNIQUE INDEX IF NOT EXISTS v2_funding_reference_unique
    ON v2_funding_orders (funding_reference)
    WHERE funding_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS v2_funding_orders_reconcile
    ON v2_funding_orders (status, updated_at)
    WHERE status IN (
        'AWAITING_DEPOSIT', 'DEPOSIT_DETECTED', 'PROCESSING',
        'SETTLED', 'ALLOCATING', 'INCOMPLETE'
    );

CREATE TABLE IF NOT EXISTS v2_claims (
    id                       UUID PRIMARY KEY,
    campaign_id              UUID NOT NULL REFERENCES v2_campaigns(id) ON DELETE RESTRICT,
    claimant_id              TEXT,
    status                   TEXT NOT NULL CHECK (status IN (
                                 'QUOTED', 'AWAITING_PROOF', 'SUBMITTED',
                                 'PAYING', 'PAID', 'FAILED', 'EXPIRED'
                             )),
    idempotency_key          TEXT NOT NULL,
    payout                   JSONB NOT NULL,
    payout_quote             JSONB,
    solution_proof_digest    TEXT,
    solution_proof           JSONB,
    contract_tx_hash         TEXT,
    settlement_tx_hash       TEXT,
    evidence                 JSONB NOT NULL DEFAULT '{}'::JSONB,
    expires_at               TIMESTAMPTZ NOT NULL,
    version                  INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        solution_proof_digest IS NULL
        OR solution_proof_digest ~ '^[0-9a-f]{64}$'
    ),
    UNIQUE (claimant_id, idempotency_key)
);

-- Quotes do not reserve the prize. The first submitted proof wins the database
-- race; the contract remains authoritative for the on-chain race.
CREATE UNIQUE INDEX IF NOT EXISTS v2_claims_winner
    ON v2_claims (campaign_id)
    WHERE status IN ('SUBMITTED', 'PAYING', 'PAID');
CREATE INDEX IF NOT EXISTS v2_claims_reconcile
    ON v2_claims (status, updated_at)
    WHERE status IN ('SUBMITTED', 'PAYING');

CREATE TABLE IF NOT EXISTS v2_operation_events (
    id                    UUID PRIMARY KEY,
    aggregate_type        TEXT NOT NULL,
    aggregate_id          TEXT NOT NULL,
    event_type            TEXT NOT NULL,
    actor_id              TEXT,
    from_state            TEXT,
    to_state              TEXT,
    idempotency_key       TEXT,
    evidence              JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS v2_operation_events_aggregate
    ON v2_operation_events (aggregate_type, aggregate_id, created_at);

CREATE TABLE IF NOT EXISTS v2_jobs (
    id                    UUID PRIMARY KEY,
    type                  TEXT NOT NULL,
    aggregate_type        TEXT NOT NULL,
    aggregate_id          TEXT NOT NULL,
    deduplication_key     TEXT NOT NULL UNIQUE,
    status                TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN (
                                  'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD'
                              )),
    payload               JSONB NOT NULL DEFAULT '{}'::JSONB,
    attempts              INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts          INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
    run_after             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_owner           TEXT,
    lease_expires_at      TIMESTAMPTZ,
    last_error            TEXT,
    result                JSONB NOT NULL DEFAULT 'null'::JSONB,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS v2_jobs_ready
    ON v2_jobs (run_after, created_at)
    WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS v2_jobs_expired_lease
    ON v2_jobs (lease_expires_at)
    WHERE status = 'RUNNING';

CREATE TABLE IF NOT EXISTS v2_idempotency_records (
    scope                 TEXT NOT NULL,
    actor_id              TEXT NOT NULL,
    idempotency_key       TEXT NOT NULL,
    request_hash          TEXT NOT NULL,
    state                 TEXT NOT NULL DEFAULT 'PROCESSING'
                              CHECK (state IN ('PROCESSING', 'COMPLETED', 'FAILED')),
    response_status       INTEGER,
    response_body         JSONB NOT NULL DEFAULT 'null'::JSONB,
    payment_reference     TEXT,
    expires_at            TIMESTAMPTZ NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scope, actor_id, idempotency_key),
    CHECK (request_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS v2_idempotency_expiry
    ON v2_idempotency_records (expires_at);
