# Private learning review and Base issuance

Local R3/R4 checkpoint, 2026-09-04, session 3. This is a backend slice, not a
public earning workflow or deployment. Production remains the NEAR application.
See the [work order](reshape-action-plan.md) and [launch register](early-launch-status.md).

Session 5 adds a read-only RPC/accounting adapter, canonical event ledger and
reconciled-reader guard. See the [Base accounting chapter](../md-CLAUDE-chapters/03-base-accounting.md).
Session 6 adds the real participant eligibility verifier, gated signing composition
and authenticated claim/recovery routes. See the [participant chapter](../md-CLAUDE-chapters/06-participants-and-recovery.md).
Neither the new routes nor their signer are enabled/configured in production.

## Implemented boundary

Migration `009_base_learning_workflow.sql` adds separate Base review, approval,
funding-binding, allocation, and authorization tables. It does not change NEAR
campaigns, claims, accounts, balances, or the existing x402 result cache.
The Base tables reference the existing NextAuth users. Account deletion is
restricted while these audit records reference it; private-data retention and
account anonymization policy still need design before launch.

`BASE_REVIEW_ENABLED=true` enables only the private review API. It defaults off,
requires actual database sessions, rejects demo identities, and requires a
mutation Origin matching `NEXTAUTH_URL`. JSON bodies are bounded by the existing
256 KiB HTTP limit; source content has the stricter generator limits. Mutations
also use account/IP rate limits. Every response is no-store. Nonowners receive
404 for a campaign, including edits and approval.

| Route | Private behavior |
| --- | --- |
| `GET /api/base/reviews` | Current user's most recent 100 draft summaries |
| `POST /api/base/reviews` | Create with UUID `Idempotency-Key` and `{source, draft, terms}` |
| `GET /api/base/reviews/:id` | Owner's complete private review material and approval |
| `PUT /api/base/reviews/:id` | Append revision using `{expectedRevision, submission}` |
| `POST /api/base/reviews/:id/approve` | Approve `{revision, reviewHash, termsHash}` as signed-in owner |

`source` is the bounded pasted-source input from the existing learning generator.
`draft` contains only `title`, `paragraphs`, and `entries`, including their private
evidence and answers. It can be manually written. The existing NEAR AI generator
can supply these fields, but this API does not call inference, accept model
metadata as proof, or perform settlement. Generated drafts are not automatically
approved. The separate paid source-draft orchestration remains R5.

Creation retries with the same user/key/material reuse the campaign; different
material conflicts. Editing uses optimistic revision checks and removes current
approval by appending a new unapproved revision. Prior revisions and approvals
remain available in the private ledger. Approval records reviewer identity,
time, private review hash, and public terms hash. After a verified funding
binding, edits are rejected. Review approval is not publication: crossword
layout viability, final eligibility/privacy text, and sponsor UX remain open.

## Versioned commitments

`review.ts` defines the ordered serialization and
`src/server/base/fixtures/terms-v1.json` pins a public conformance vector. These
are application-specific versioned JSON encodings, not a claim of RFC 8785.

- Sources are trimmed/validated by the existing schema; SHA-256 of each UTF-8
  text forms the private source manifest. URLs are references, never fetched.
- The private `reviewHash` is SHA-256 of compact JSON for
  `{version: "private-learning-review:v1", submission}`. Parse through the
  schema before hashing, including after a JSONB round-trip, to restore field
  order. The submission includes private answers and sources. Never publish
  this hash or use it as the on-chain terms commitment.
- Public content is exactly `{title, paragraphs: string[], clues: [{clue,length}]}`.
  Array order is significant. No answers, answer hashes, evidence quotations,
  email, or consent records are included. `contentHash` is Keccak-256 of its
  compact UTF-8 JSON. Answer lengths are public crossword information.
- Public terms use exactly the key order in the conformance fixture:
  version, application campaign UUID, revision, content hash, chain/deployment/
  token/sponsor/initial signer, atomic reward string, slot count, integer Unix
  timestamps, and the three policy-version identifiers. Addresses are lowercase;
  amounts have no leading zeroes; numbers are safe integers. `termsHash` is
  Keccak-256 of this compact UTF-8 JSON. The campaign UUID prevents copying
  another campaign's commitment into an independently owned draft.
- The three policy identifiers name the work-order rules: verified email plus
  wallet control and completion; private email with separate optional sponsor
  contact consent; sponsor pause/rotation without deadline extension. Final
  participant-facing policy text/consent records must exist before publication.

No source-only edit changes the public content hash, but every edit increments
the revision and requires fresh private approval. Public changes always change
the terms commitment. Future layout or policy changes that affect the published
experience need reviewed versioning before funding, not silent hash changes.

## Issuer and authenticated participant API

`BaseRewardIssuer` requires explicitly injected chain, eligibility, and signer
adapters. Session 6's participant API composes the reconciled RPC reader, durable
completion/wallet verifier and explicitly gated EOA eligibility key. The private
routes require real database sessions and remain off by default. A funding-binding
HTTP endpoint, public player/review UI and relayer still need implementation.
Tests use public synthetic keys and isolated databases/local EVMs, never live funds.

The trusted chain adapter must independently verify the pinned deployment and
native token and read canonical finalized campaign/slot/participant state. It
must supply a deployment-reviewed maximum finalized-block age; the 300-second
test fixture is not a Base mainnet confirmation policy. State observations must
be no older than 60 seconds. Unexpected backwards epochs/blocks or a changed
block hash at the same height stop issuance for reconciliation. This is not
itself event ingestion; the required reconciled reader integrates those guards.

The trusted eligibility adapter must validate completion for the frozen revision,
the selected abuse policy, and a fresh wallet-control challenge bound to the
authenticated account, campaign, and recipient. It returns an opaque private
audit-receipt UUID; the participant verifier now durably stores its evidence. The
issuer itself also requires a non-future `users.email_verified` timestamp inside
the allocation transaction. A Google login without that persisted timestamp is
not implicitly treated as verified. The Google server sign-in event now persists
the provider-verified linked email; live auth acceptance remains open.

After independent funding verification matches every fixed term and the full
principal, binding freezes the approved revision. Initial binding requires an
untouched epoch-1 campaign with no payouts; later rotations use the same binding.
The issuer serializes reservations per campaign and enforces unique account,
slot, and opaque participant bindings. All integer atomic amounts remain exact.

The full EIP-712 tuple, domain, digest, issuer epoch/address, and checked block
are committed before invoking the signer. A signing timeout or response loss
never frees capacity. Repeated signing may occur concurrently for the same tuple;
the first persisted valid signature wins and all callers return that value.
No recipient change or slot recycling is supported. Rotation preserves the
participant, slot, recipient, amount, and deadline, with an additional epoch
record. The EOA signer adapter is checked with viem before storage/response;
deployed ERC-1271 issuers are supported by the contract but not this issuer yet.

New allocations require `[startsAt, endsAt)`. Recovery of an existing allocation
is allowed through `claimDeadline`, including a replacement epoch, after renewed
eligibility/wallet checks and on-chain non-consumption checks. An issuer timeout
is ambiguous; recovery does not imply the original signature was never created.
The issuer's authorization response is never labeled paid. A separate authenticated
recovery read derives paid status from reconciled finalized receipts. A final state/use check happens after signing;
sponsor pause/rotation or payment can still occur after that check, and the
contract remains the final authority at redemption.

Adapter calls have one attempt and cancellation deadlines: 10 seconds for chain
reads, 15 seconds for eligibility/signing. Adapters must honor their AbortSignal.
Database transactions use 3-second lock and 5-second statement timeouts. Failures
are sanitized before HTTP logging; do not log private proofs or authorizations.

## Verification and next work

Run `yarn test:integration:base` with `TEST_DATABASE_URL` explicitly pointing to a
disposable local Postgres database. The harness refuses remote hosts and never
falls back to `DATABASE_URL`. It creates/drops only its own random schema, runs
all eleven migrations twice, and exercises actual constraints, concurrent
connections, durable replay, and session-authenticated route handlers. CI uses
its existing Postgres 16 service for this additional test step.

Next: sponsor/participant UI and safe publication/layout, fresh-wallet onboarding
and sponsored gas, sponsor export/retention and eligibility policy, reviewed
deployment/finality/supervision, and a separately versioned paid source-draft flow.
Do not enable funded issuance until these complete journeys have acceptance evidence.
