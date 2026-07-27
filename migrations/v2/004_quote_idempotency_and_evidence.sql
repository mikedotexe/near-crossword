-- A retry may repair a crash between a durable state transition and event
-- publication. Keep that repair append-only while preventing duplicate
-- receipts for the same operation.
CREATE UNIQUE INDEX IF NOT EXISTS v2_operation_events_idempotent_transition
    ON v2_operation_events (
        aggregate_type,
        aggregate_id,
        event_type,
        idempotency_key
    )
    WHERE idempotency_key IS NOT NULL;
