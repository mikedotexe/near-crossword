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
Migration 010 adds the reconciled canonical/orphan event ledger. Migration 011
adds private completion, expiring wallet challenges, durable eligibility receipts
and optional contact-consent history. These are append-only additions tested on
disposable local databases, not production migrations. Existing allocation receipt
IDs are preserved rather than backfilled with fabricated participant evidence.
Migration 012 adds immutable layout approvals and publication/withdrawal records.
It does not rewrite v1 funded terms or previous approvals. Migration 013 adds
private short-lived gas permit hashes, lifetime reserved allowances and durable
upstream request identities/results. Unknown outcomes are never TTL-deleted or
automatically released. Migration 014 adds numbered permit epochs and append-only
operator reviews for expired, finalized, stub-only attempts; it never deletes a
request or releases reserved gas allowance. Migration 015 adds a separate
CDP-managed sponsorship mode: one server-side gas reservation precedes the SDK
call, provider operation reporting is immutable, and ambiguous outcomes remain
blocked until finalized reward evidence appears. No campaign prize principal funds gas. All fifteen migrations
apply/replay in local integration tests; production application remains gated.

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
