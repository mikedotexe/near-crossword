# Crossword Campaigns v2 migrations

Run `yarn db:migrate:v2` against the same Postgres database used by NextAuth.
The ordered migration set creates the workflow ledger, payout recovery state,
creator authentication tables, event deduplication index, and crash-recoverable
x402 settlement stages, shared abuse-control buckets for costly public
operations, and single-use sanitized AI-generation receipt links on campaigns.
It does not modify the legacy `puzzles` table.

The migration runner holds a Postgres advisory lock, applies every migration in
one transaction, records an immutable checksum, and refuses to continue if an
already-applied file changes.

The API intentionally fails closed in production when `DATABASE_URL` is
missing. An in-memory repository is available only for local demos when both
conditions are true:

```text
NODE_ENV != production
V2_FUNDING_MODE=mock
```

Demo data is process-local, is erased when the server restarts, and must never
be treated as funding or settlement evidence.
