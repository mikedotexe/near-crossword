-- Read-only chain observations. No NEAR records or reserved claim allocations are changed.
CREATE TABLE base_chain_deployments (
  id UUID PRIMARY KEY,
  chain_id INTEGER NOT NULL CHECK (chain_id IN (8453, 84532, 31337)),
  escrow TEXT NOT NULL CHECK (escrow ~ '^0x[0-9a-f]{40}$'),
  pins JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  state TEXT NOT NULL DEFAULT 'CATCHING_UP' CHECK (state IN ('CATCHING_UP', 'HEALTHY', 'HALTED')),
  failure_code TEXT CHECK (failure_code IN ('BASE_FINALITY_CONFLICT', 'BASE_REORG_TOO_DEEP', 'BASE_RECONCILIATION_MISMATCH')),
  tip_number NUMERIC(78, 0), tip_hash TEXT,
  finalized_number NUMERIC(78, 0), finalized_hash TEXT,
  totals JSONB,
  checked_at TIMESTAMPTZ,
  UNIQUE (chain_id, escrow),
  CHECK ((tip_number IS NULL) = (tip_hash IS NULL)),
  CHECK ((finalized_number IS NULL) = (finalized_hash IS NULL)),
  CHECK (finalized_number IS NULL OR tip_number IS NOT NULL),
  CHECK (tip_number >= 0 AND (finalized_number IS NULL OR finalized_number BETWEEN 0 AND tip_number)),
  CHECK (tip_hash ~ '^0x[0-9a-f]{64}$' AND finalized_hash ~ '^0x[0-9a-f]{64}$'),
  CHECK ((state = 'HALTED') = (failure_code IS NOT NULL))
);

CREATE TABLE base_chain_blocks (
  deployment_id UUID NOT NULL REFERENCES base_chain_deployments(id),
  block_hash TEXT NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_number NUMERIC(78, 0) NOT NULL CHECK (block_number >= 0),
  parent_hash TEXT NOT NULL CHECK (parent_hash ~ '^0x[0-9a-f]{64}$'),
  block_timestamp BIGINT NOT NULL CHECK (block_timestamp >= 0),
  logs_hash TEXT NOT NULL CHECK (logs_hash ~ '^0x[0-9a-f]{64}$'),
  canonical BOOLEAN NOT NULL DEFAULT TRUE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  orphaned_at TIMESTAMPTZ,
  PRIMARY KEY (deployment_id, block_hash),
  CHECK (canonical = (orphaned_at IS NULL))
);
CREATE UNIQUE INDEX base_chain_canonical_height ON base_chain_blocks(deployment_id, block_number) WHERE canonical;

CREATE TABLE base_chain_events (
  deployment_id UUID NOT NULL,
  block_hash TEXT NOT NULL,
  transaction_hash TEXT NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index INTEGER NOT NULL CHECK (log_index >= 0),
  transaction_index INTEGER NOT NULL CHECK (transaction_index >= 0),
  data TEXT NOT NULL CHECK (data ~ '^0x([0-9a-f]{2})*$'),
  topics JSONB NOT NULL CHECK (jsonb_typeof(topics) = 'array'),
  PRIMARY KEY (deployment_id, block_hash, transaction_hash, log_index),
  UNIQUE (deployment_id, block_hash, log_index),
  FOREIGN KEY (deployment_id, block_hash) REFERENCES base_chain_blocks(deployment_id, block_hash)
);

CREATE TABLE base_chain_campaign_snapshots (
  deployment_id UUID NOT NULL REFERENCES base_chain_deployments(id),
  on_chain_id NUMERIC(78, 0) NOT NULL CHECK (on_chain_id > 0),
  block_hash TEXT NOT NULL,
  accounting JSONB NOT NULL,
  PRIMARY KEY (deployment_id, on_chain_id),
  FOREIGN KEY (deployment_id, block_hash) REFERENCES base_chain_blocks(deployment_id, block_hash)
);
