-- A cross-chain route can settle at the requested destination or refund to the
-- winner-controlled NEAR recovery account. Keep that terminal recovery
-- distinct from both a successful destination payout and an unresolved
-- provider failure.
ALTER TABLE v2_claims
    DROP CONSTRAINT IF EXISTS v2_claims_status_check;

ALTER TABLE v2_claims
    ADD CONSTRAINT v2_claims_status_check
    CHECK (status IN (
        'QUOTED', 'AWAITING_PROOF', 'SUBMITTED', 'PAYING',
        'PAID', 'RECOVERED', 'FAILED', 'EXPIRED'
    ));

DROP INDEX IF EXISTS v2_claims_winner;
CREATE UNIQUE INDEX v2_claims_winner
    ON v2_claims (campaign_id)
    WHERE status IN ('SUBMITTED', 'PAYING', 'PAID', 'RECOVERED');
