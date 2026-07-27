-- x402 settlement is an external side effect. Persist only a digest of the
-- exact authorization and the non-secret generated result before settlement,
-- so an interrupted request can resume without generating or authorizing
-- again. PROCESSING rows are intentionally retained past expires_at.
ALTER TABLE v2_idempotency_records
    ADD COLUMN IF NOT EXISTS authorization_digest TEXT,
    ADD COLUMN IF NOT EXISTS processing_stage TEXT;

ALTER TABLE v2_idempotency_records
    DROP CONSTRAINT IF EXISTS v2_idempotency_authorization_digest_check,
    ADD CONSTRAINT v2_idempotency_authorization_digest_check
        CHECK (
            authorization_digest IS NULL
            OR authorization_digest ~ '^[0-9a-f]{64}$'
        ),
    DROP CONSTRAINT IF EXISTS v2_idempotency_processing_stage_check,
    ADD CONSTRAINT v2_idempotency_processing_stage_check
        CHECK (
            processing_stage IS NULL
            OR processing_stage IN (
                'AUTHORIZED',
                'GENERATED',
                'SETTLING',
                'SETTLEMENT_UNKNOWN'
            )
        );

CREATE INDEX IF NOT EXISTS v2_idempotency_manual_reconciliation
    ON v2_idempotency_records (updated_at)
    WHERE state = 'PROCESSING'
      AND processing_stage IN ('SETTLING', 'SETTLEMENT_UNKNOWN');
