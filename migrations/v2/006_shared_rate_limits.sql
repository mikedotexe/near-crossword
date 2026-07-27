-- Costly public operations must share abuse counters across application
-- instances. Buckets contain hashed/opaque keys rather than email addresses or
-- other customer data and can be removed after their retry horizon.
CREATE TABLE IF NOT EXISTS v2_rate_limit_buckets (
    bucket_key          TEXT NOT NULL,
    window_started_at   TIMESTAMPTZ NOT NULL,
    request_count       INTEGER NOT NULL CHECK (request_count > 0),
    expires_at          TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (bucket_key, window_started_at)
);

CREATE INDEX IF NOT EXISTS v2_rate_limit_buckets_expiry
    ON v2_rate_limit_buckets (expires_at);
