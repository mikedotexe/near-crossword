-- Layout is an additional off-chain commitment. Existing v1 funded terms are unchanged.
CREATE TABLE base_learning_layouts (
  campaign_id UUID NOT NULL,
  revision INTEGER NOT NULL,
  layout JSONB NOT NULL,
  layout_hash TEXT NOT NULL CHECK (layout_hash ~ '^0x[0-9a-f]{64}$'),
  terms_hash TEXT NOT NULL,
  reviewer_id BIGINT NOT NULL REFERENCES users(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, revision),
  FOREIGN KEY (campaign_id, revision) REFERENCES base_learning_approvals(campaign_id, revision)
);

CREATE TABLE base_learning_publications (
  campaign_id UUID PRIMARY KEY REFERENCES base_reward_campaigns(campaign_id),
  revision INTEGER NOT NULL,
  publication_hash TEXT NOT NULL CHECK (publication_hash ~ '^0x[0-9a-f]{64}$'),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_at TIMESTAMPTZ,
  FOREIGN KEY (campaign_id, revision) REFERENCES base_learning_layouts(campaign_id, revision)
);
