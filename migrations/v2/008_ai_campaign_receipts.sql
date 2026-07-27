-- A paid AI generation can be linked to at most one campaign. Only sanitized,
-- publicly auditable receipt data is copied from the durable idempotency record;
-- payment authorizations, payer identity, prompts, and generated answers remain
-- outside the campaign record.
ALTER TABLE v2_campaigns
    ADD COLUMN IF NOT EXISTS ai_payment_identifier TEXT,
    ADD COLUMN IF NOT EXISTS ai_receipt_digest TEXT,
    ADD COLUMN IF NOT EXISTS ai_payment_network TEXT,
    ADD COLUMN IF NOT EXISTS ai_settlement_reference TEXT;

ALTER TABLE v2_campaigns
    ADD CONSTRAINT v2_campaigns_ai_receipt_complete
    CHECK (
        (
            ai_payment_identifier IS NULL
            AND ai_receipt_digest IS NULL
            AND ai_payment_network IS NULL
            AND ai_settlement_reference IS NULL
        )
        OR
        (
            ai_payment_identifier IS NOT NULL
            AND ai_receipt_digest IS NOT NULL
            AND ai_payment_network IS NOT NULL
            AND ai_settlement_reference IS NOT NULL
            AND ai_payment_identifier ~ '^[A-Za-z0-9._:-]{8,200}$'
            AND ai_receipt_digest ~ '^[0-9a-f]{64}$'
            AND ai_payment_network IN ('near:mainnet', 'near:testnet')
            AND char_length(ai_settlement_reference) BETWEEN 8 AND 256
        )
    );

CREATE UNIQUE INDEX v2_campaigns_ai_payment_identifier_unique
    ON v2_campaigns (ai_payment_identifier)
    WHERE ai_payment_identifier IS NOT NULL;
