-- NextAuth auth tables (snake_case, matching dashboard pattern)
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255),
    email           VARCHAR(255) NOT NULL UNIQUE,
    email_verified  TIMESTAMPTZ,
    image           VARCHAR(255),
    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type                VARCHAR(255) NOT NULL,
    provider            VARCHAR(255) NOT NULL,
    provider_account_id VARCHAR(255) NOT NULL,
    refresh_token       TEXT,
    access_token        TEXT,
    expires_at          BIGINT,
    token_type          VARCHAR(255),
    scope               VARCHAR(255),
    id_token            TEXT,
    session_state       VARCHAR(255),
    UNIQUE(provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires         TIMESTAMPTZ NOT NULL,
    session_token   VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS verification_tokens (
    identifier  VARCHAR(255) NOT NULL,
    token       VARCHAR(255) NOT NULL,
    expires     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (identifier, token)
);

-- Async puzzle generation jobs
CREATE TYPE job_status AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE puzzle_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_email      VARCHAR(255) NOT NULL,
    input_mode      VARCHAR(20) NOT NULL,
    pdf_base64      TEXT,
    youtube_url     TEXT,
    pasted_text     TEXT,
    tone            VARCHAR(50) DEFAULT 'Educational',
    objective       TEXT,
    variations_json JSONB,
    error_message   TEXT,
    status          job_status NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    retry_count     INTEGER DEFAULT 0
);

CREATE INDEX idx_puzzle_jobs_pending ON puzzle_jobs(created_at) WHERE status = 'pending';
CREATE INDEX idx_puzzle_jobs_user ON puzzle_jobs(user_id);

-- Reuse existing trigger function from migration 001
CREATE TRIGGER puzzle_jobs_updated_at
    BEFORE UPDATE ON puzzle_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
