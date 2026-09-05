# Crossword Campaigns v2 migrations

Run `yarn db:migrate:v2` against the same Postgres database used by NextAuth.
The ordered migration set creates the workflow ledger, payout recovery state,
creator authentication tables, event deduplication index, and crash-recoverable
x402 settlement stages, shared abuse-control buckets for costly public
operations, and single-use sanitized AI-generation receipt links on campaigns.
Migration 009 adds separate Base learning review/approval and reward allocation/
authorization tables, referencing existing users but not changing NEAR liabilities.
See [the private workflow](../../docs/base-learning-workflow.md). This migration
is locally tested, not yet applied to production. No migration modifies the
legacy `puzzles` table.

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

The new Base workflow deliberately has no memory/demo repository. Its integration
suite requires `TEST_DATABASE_URL` naming a disposable local Postgres target and
runs with `yarn test:integration:base`; it uses an isolated random schema and runs
the ordered migrations twice. It never uses `DATABASE_URL` as a fallback.
