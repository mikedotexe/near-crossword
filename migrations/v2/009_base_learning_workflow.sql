-- Additive Base workflow. No existing NEAR campaign, claim, or balance is modified.
CREATE TABLE base_learning_campaigns (
  id UUID PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  creation_key UUID NOT NULL,
  creation_hash CHAR(64) NOT NULL,
  current_revision INTEGER NOT NULL CHECK (current_revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, creation_key)
);

CREATE TABLE base_learning_revisions (
  campaign_id UUID NOT NULL REFERENCES base_learning_campaigns(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  submission JSONB NOT NULL,
  source_manifest JSONB NOT NULL,
  review_hash CHAR(64) NOT NULL,
  public_content JSONB NOT NULL,
  public_terms JSONB NOT NULL,
  terms_hash TEXT NOT NULL CHECK (terms_hash ~ '^0x[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, revision)
);

CREATE TABLE base_learning_approvals (
  campaign_id UUID NOT NULL,
  revision INTEGER NOT NULL,
  reviewer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  review_hash CHAR(64) NOT NULL,
  terms_hash TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, revision),
  FOREIGN KEY (campaign_id, revision) REFERENCES base_learning_revisions(campaign_id, revision)
);

CREATE TABLE base_reward_campaigns (
  campaign_id UUID PRIMARY KEY REFERENCES base_learning_campaigns(id),
  revision INTEGER NOT NULL,
  chain_id INTEGER NOT NULL CHECK (chain_id IN (8453, 84532, 31337)),
  escrow TEXT NOT NULL CHECK (escrow ~ '^0x[0-9a-f]{40}$'),
  on_chain_id NUMERIC(78, 0) NOT NULL CHECK (on_chain_id > 0 AND on_chain_id < 2::NUMERIC ^ 256),
  funding_block_hash TEXT NOT NULL CHECK (funding_block_hash ~ '^0x[0-9a-f]{64}$'),
  funding_block_number NUMERIC(78, 0) NOT NULL CHECK (funding_block_number >= 0),
  next_slot BIGINT NOT NULL DEFAULT 0 CHECK (next_slot BETWEEN 0 AND 4294967295),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (campaign_id, revision) REFERENCES base_learning_approvals(campaign_id, revision),
  UNIQUE (chain_id, escrow, on_chain_id)
);

CREATE TABLE base_reward_allocations (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES base_reward_campaigns(campaign_id),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slot BIGINT NOT NULL CHECK (slot BETWEEN 0 AND 4294967294),
  participant_id TEXT NOT NULL CHECK (participant_id ~ '^0x[0-9a-f]{64}$' AND participant_id <> '0x' || repeat('0', 64)),
  recipient TEXT NOT NULL CHECK (recipient ~ '^0x[0-9a-f]{40}$' AND recipient <> '0x' || repeat('0', 40)),
  amount NUMERIC(78, 0) NOT NULL CHECK (amount > 0 AND amount < 2::NUMERIC ^ 256),
  deadline NUMERIC(20, 0) NOT NULL CHECK (deadline > 0 AND deadline < 2::NUMERIC ^ 64),
  eligibility_receipt UUID NOT NULL,
  email_verified_at TIMESTAMPTZ NOT NULL,
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, user_id),
  UNIQUE (campaign_id, slot),
  UNIQUE (campaign_id, participant_id)
);

CREATE TABLE base_reward_authorizations (
  allocation_id UUID NOT NULL REFERENCES base_reward_allocations(id),
  signer_epoch NUMERIC(20, 0) NOT NULL CHECK (signer_epoch > 0 AND signer_epoch < 2::NUMERIC ^ 64),
  signer TEXT NOT NULL CHECK (signer ~ '^0x[0-9a-f]{40}$'),
  digest TEXT NOT NULL CHECK (digest ~ '^0x[0-9a-f]{64}$'),
  typed_data JSONB NOT NULL,
  checked_block_hash TEXT NOT NULL CHECK (checked_block_hash ~ '^0x[0-9a-f]{64}$'),
  checked_block_number NUMERIC(78, 0) NOT NULL CHECK (checked_block_number >= 0),
  signature TEXT CHECK (signature ~ '^0x[0-9a-fA-F]+$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signed_at TIMESTAMPTZ,
  PRIMARY KEY (allocation_id, signer_epoch),
  CHECK ((signature IS NULL) = (signed_at IS NULL))
);
