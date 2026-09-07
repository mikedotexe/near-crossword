-- Preserve every sponsorship attempt while allowing an explicitly reviewed,
-- expired stub-only operation to receive a new short-lived provider permit.
ALTER TABLE base_gas_sponsorships
  ADD COLUMN permit_epoch INTEGER NOT NULL DEFAULT 0
  CHECK (permit_epoch BETWEEN 0 AND 12);

ALTER TABLE base_gas_requests
  ADD COLUMN permit_epoch INTEGER NOT NULL DEFAULT 0
  CHECK (permit_epoch BETWEEN 0 AND 12);

ALTER TABLE base_gas_requests DROP CONSTRAINT base_gas_requests_pkey;
ALTER TABLE base_gas_requests
  ADD PRIMARY KEY (allocation_id, permit_epoch, request_hash);

CREATE TABLE base_gas_recovery_reviews (
  allocation_id UUID NOT NULL REFERENCES base_gas_sponsorships(allocation_id),
  from_permit_epoch INTEGER NOT NULL CHECK (from_permit_epoch BETWEEN 0 AND 11),
  to_permit_epoch INTEGER NOT NULL CHECK (to_permit_epoch = from_permit_epoch + 1),
  operation_identity CHAR(64) NOT NULL,
  prior_expires_at TIMESTAMPTZ NOT NULL,
  max_valid_until TIMESTAMPTZ NOT NULL,
  finalized_block_hash TEXT NOT NULL CHECK (finalized_block_hash ~ '^0x[0-9a-f]{64}$'),
  finalized_block_number NUMERIC(78, 0) NOT NULL CHECK (finalized_block_number >= 0),
  finalized_block_timestamp BIGINT NOT NULL CHECK (finalized_block_timestamp >= 0),
  reviewed_by TEXT NOT NULL CHECK (reviewed_by ~ '^[a-zA-Z0-9:_-]{3,100}$'),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  PRIMARY KEY (allocation_id, from_permit_epoch),
  CHECK (max_valid_until <= prior_expires_at),
  CHECK (consumed_at IS NULL OR consumed_at >= reviewed_at)
);
