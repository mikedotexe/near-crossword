CREATE TYPE puzzle_status AS ENUM (
  'generating', 'awaiting_choice', 'awaiting_preview_confirm',
  'awaiting_payment', 'reserved', 'awaiting_activation',
  'activating', 'active', 'delivered', 'cancelled', 'error'
);

CREATE TABLE puzzles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   TEXT UNIQUE,
  job_id          TEXT,
  email           TEXT,
  source_content  TEXT,
  variations_json JSONB,
  chosen_pairs    JSONB,
  reward_amount   TEXT,
  puzzle_data     JSONB,
  preview_text    TEXT,
  scheduled_at    TIMESTAMPTZ,
  uuid            TEXT UNIQUE,
  reserve_tx_hash TEXT,
  activate_tx_hash TEXT,
  answer_pk       TEXT,
  status          puzzle_status NOT NULL DEFAULT 'generating',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error      TEXT,
  retry_count     INTEGER DEFAULT 0
);

CREATE INDEX idx_puzzles_scheduled ON puzzles (status, scheduled_at)
  WHERE status = 'awaiting_activation';

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER puzzles_updated_at
  BEFORE UPDATE ON puzzles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
