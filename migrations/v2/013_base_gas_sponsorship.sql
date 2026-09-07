-- Gas allowances are operator budgets, never campaign prize principal.
CREATE TABLE base_gas_sponsorships (
  allocation_id UUID PRIMARY KEY REFERENCES base_reward_allocations(id),
  signer_epoch NUMERIC(20, 0) NOT NULL,
  digest TEXT NOT NULL CHECK (digest ~ '^0x[0-9a-f]{64}$'),
  policy_hash CHAR(64) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  operation_identity CHAR(64),
  reserved_wei NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (reserved_wei >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 12),
  final_request_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (allocation_id, signer_epoch) REFERENCES base_reward_authorizations(allocation_id, signer_epoch),
  CHECK ((operation_identity IS NULL) = (reserved_wei = 0))
);
CREATE UNIQUE INDEX base_gas_token_hash ON base_gas_sponsorships(token_hash);

-- Commit IN_FLIGHT before an external signing request. Unknown outcomes never auto-retry.
CREATE TABLE base_gas_requests (
  allocation_id UUID NOT NULL REFERENCES base_gas_sponsorships(allocation_id),
  request_hash CHAR(64) NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('pm_getPaymasterStubData', 'pm_getPaymasterData')),
  state TEXT NOT NULL CHECK (state IN ('IN_FLIGHT', 'READY', 'UNKNOWN')),
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (allocation_id, request_hash),
  CHECK ((state = 'READY') = (result IS NOT NULL))
);
