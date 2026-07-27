-- x402 verification, generation, and settlement form one externally
-- side-effecting work unit. Lease it durably and require every stage/terminal
-- update to compare-and-set the owner, stage, and monotonic version.
ALTER TABLE v2_idempotency_records
    ADD COLUMN IF NOT EXISTS processing_owner TEXT,
    ADD COLUMN IF NOT EXISTS processing_lease_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS processing_version BIGINT NOT NULL DEFAULT 0;

ALTER TABLE v2_idempotency_records
    DROP CONSTRAINT IF EXISTS v2_idempotency_processing_stage_check,
    ADD CONSTRAINT v2_idempotency_processing_stage_check
        CHECK (
            processing_stage IS NULL
            OR processing_stage IN (
                'AUTHORIZED',
                'GENERATED',
                'SETTLING',
                'SETTLED',
                'SETTLEMENT_UNKNOWN'
            )
        ),
    DROP CONSTRAINT IF EXISTS v2_idempotency_processing_lease_check,
    ADD CONSTRAINT v2_idempotency_processing_lease_check
        CHECK (
            (processing_owner IS NULL AND processing_lease_expires_at IS NULL)
            OR
            (processing_owner IS NOT NULL AND processing_lease_expires_at IS NOT NULL)
        ),
    DROP CONSTRAINT IF EXISTS v2_idempotency_processing_version_check,
    ADD CONSTRAINT v2_idempotency_processing_version_check
        CHECK (processing_version >= 0);

CREATE INDEX IF NOT EXISTS v2_idempotency_expired_processing_lease
    ON v2_idempotency_records (processing_lease_expires_at)
    WHERE state = 'PROCESSING'
      AND processing_owner IS NOT NULL;
