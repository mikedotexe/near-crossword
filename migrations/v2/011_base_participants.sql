-- Private participant evidence. Never store submitted answers or wallet signatures.
CREATE TABLE base_participant_completions (
  campaign_id UUID NOT NULL,
  revision INTEGER NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  terms_hash TEXT NOT NULL CHECK (terms_hash ~ '^0x[0-9a-f]{64}$'),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, revision, user_id),
  FOREIGN KEY (campaign_id, revision) REFERENCES base_learning_approvals(campaign_id, revision)
);

CREATE TABLE base_wallet_challenges (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL,
  revision INTEGER NOT NULL,
  user_id BIGINT NOT NULL,
  recipient TEXT NOT NULL CHECK (recipient ~ '^0x[0-9a-f]{40}$' AND recipient <> '0x0000000000000000000000000000000000000000'),
  origin TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (campaign_id, revision, user_id) REFERENCES base_participant_completions(campaign_id, revision, user_id),
  CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '5 minutes')
);
CREATE INDEX base_wallet_challenge_owner ON base_wallet_challenges(campaign_id, user_id);

CREATE TABLE base_participant_eligibility (
  id UUID PRIMARY KEY,
  challenge_id UUID NOT NULL UNIQUE REFERENCES base_wallet_challenges(id),
  signature_hash TEXT NOT NULL CHECK (signature_hash ~ '^[0-9a-f]{64}$'),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing allocations predate this verifier and retain their historical opaque receipts.
-- New receipts are checked by the participant verifier; do not invent evidence for old rows.
CREATE TABLE base_participant_consent_events (
  campaign_id UUID NOT NULL REFERENCES base_reward_campaigns(campaign_id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL CHECK (version > 0),
  share_email BOOLEAN NOT NULL,
  email_hash TEXT CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  policy TEXT NOT NULL CHECK (policy = 'private-email-optional-sponsor-contact:v1'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, user_id, version),
  CHECK (share_email = (email_hash IS NOT NULL))
);
