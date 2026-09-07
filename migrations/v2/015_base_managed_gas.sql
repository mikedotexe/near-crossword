-- Record CDP-managed sponsorship before the browser can submit it. Managed
-- attempts never reuse the proxy's provider-request recovery path.
ALTER TABLE base_gas_sponsorships
  ADD COLUMN sponsorship_mode TEXT NOT NULL DEFAULT 'PROXY'
    CHECK (sponsorship_mode IN ('PROXY', 'CDP_MANAGED')),
  ADD COLUMN managed_attempt_id UUID,
  ADD COLUMN managed_state TEXT
    CHECK (managed_state IN ('RESERVED', 'SUBMITTED', 'UNKNOWN', 'FINALIZED')),
  ADD COLUMN managed_user_operation_hash TEXT
    CHECK (managed_user_operation_hash ~ '^0x[0-9a-f]{64}$'),
  ADD COLUMN managed_transaction_hash TEXT
    CHECK (managed_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  ADD COLUMN managed_updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX base_gas_managed_attempt
  ON base_gas_sponsorships(managed_attempt_id)
  WHERE managed_attempt_id IS NOT NULL;

ALTER TABLE base_gas_sponsorships ADD CHECK (
  (sponsorship_mode = 'PROXY'
    AND managed_attempt_id IS NULL
    AND managed_state IS NULL
    AND managed_user_operation_hash IS NULL
    AND managed_transaction_hash IS NULL
    AND managed_updated_at IS NULL)
  OR
  (sponsorship_mode = 'CDP_MANAGED'
    AND managed_attempt_id IS NOT NULL
    AND managed_state IS NOT NULL
    AND managed_updated_at IS NOT NULL
    AND (managed_state = 'FINALIZED') = (managed_transaction_hash IS NOT NULL))
);
