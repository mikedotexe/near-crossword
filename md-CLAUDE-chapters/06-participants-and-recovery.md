# Participants and recovery

Implemented locally in sessions 6-7, 2026-09-04. This remains gated and undeployed;
chapter 07 covers the new player experience. Keep the [work order](../docs/reshape-action-plan.md)
and [launch register](../docs/early-launch-status.md) separate from local evidence.

## Entry points and gates

`BASE_PARTICIPANT_ENABLED` defaults false. All routes below require a real,
unexpired database session, not a demo identity. The campaign ID is the application
UUID. It must reference an approved, funding-bound immutable revision. Approval
alone do not publish a campaign. Session 7 requires an active publication for new
production completions/allocations; existing allocations recover after withdrawal.

| Route under `/api/base/participants/:id` | Request and result |
| --- | --- |
| `POST /completion` | `{revision, answers: string[]}`; returns `COMPLETED` and its original timestamp |
| `POST /wallet-challenge` | `{revision, recipient}`; returns `{challengeId, message, expiresAt}` |
| `POST /claim` | `{recipient, proof: {challengeId, signature}}`; returns private `AUTHORIZED` tuple/signature, or the already-finalized `PAID` receipt |
| `GET /claim` | Own completion, verified-email/consent state and allocation/recovery status; never returns signatures or private answers |
| `PUT /consent` | `{expectedVersion, shareEmail: boolean}`; explicit independent opt-in or withdrawal |

Mutations require JSON and an Origin matching `NEXTAUTH_URL`; cross-site fetches
are rejected. Bodies are stream-bounded to 16 KiB, schemas reject extra fields,
and responses/errors are no-store. Shared account/IP limits cover reads as well
as writes. Completion attempts additionally have a 20/hour campaign/account cap;
the lower process-local rolling limit complements the durable fixed-window bucket.
The production ingress must overwrite the configured trusted client-IP header.

Issuance has a second default-off gate, `BASE_CLAIM_ISSUANCE_ENABLED`, and requires
`BASE_ELIGIBILITY_PRIVATE_KEY`, a dedicated EOA eligibility key. Never reuse a
sponsor, treasury, participant, staking or operator-funding key. The API composes
the real verifier and signer with `ReconciledBaseChainReader`, never bare RPC.
Pinned Base deployment/RPC settings and fresh healthy accounting are mandatory.
Read recovery does not need signing enabled. No endpoint broadcasts transactions.
Signing still creates a redeemable authorization and requires deployment review.

## Completion and wallet evidence

`PostgresParticipantRepository` and additive migration 011 persist correct
completion against user, approved revision and public terms hash. The ordered
answer array follows the approved clue order, trims surrounding whitespace and
accepts ASCII letters case-insensitively (3-24 letters per answer). Whole-puzzle
digests are compared in constant time; no per-answer correctness is returned.
Submitted answers and their digests are never persisted or logged. Existing
completions replay without moving their timestamp; completion reserves no funds.
New completion requires the open completion window and an unpaused, open campaign.

Completion requires sign-in but not verified email. The player screen permits
anonymous solving, then submits the completed board after sign-in. There
is no anonymous completion credential that can be copied between accounts.
Wallet challenges and allocations require persisted verified email.

The server constructs SIWE messages using pinned viem, with a cryptographic nonce,
domain, chain, claim URI, purpose statement, campaign/revision/terms resources and
opaque challenge ID. Email and internal user ID are not in the message. The DB
binds it to the authenticated account and recipient. Messages expire after at most
five minutes, capped by the new-allocation or existing-redemption deadline.
The verifier accepts only the stored message, never an arbitrary browser message.

Wallet control uses EIP-191 EOA verification or ERC-1271 at a pinned canonical
finalized block on the configured deployment's chain. Contract code takes
precedence, with no EOA fallback after contract rejection. Contract reads have a
200,000-gas ceiling, bounded transport, no CCIP lookup or transaction sending.
Session 7 adds a separate default-off ERC-6492 path with pinned factory and
implementation code, canonical creation/predicted-recipient checks and bounded
simulation. Delegation preparation remains unsupported. See chapter 08; real
fresh passkey/paymaster acceptance remains a pilot gate, not proven by the local
synthetic CREATE2/ERC-1271 fixture.

After verification, a unique private eligibility receipt records the challenge
and signature hash, not the signature. The same proof can replay the same receipt
within its original expiry; this is idempotent single-purpose use, not a renewed
challenge or a new allocation. Every issuance retry rechecks wallet authority and
expiry. Failed signing keeps the original recipient/slot. After expiry, obtain a
new challenge for the same allocated recipient; no deadline extension or slot
recycling is allowed. Old allocation audit receipts are preserved, not backfilled
with invented evidence from the new verifier.

Sources for the wallet interfaces: [SIWE verification](https://viem.sh/docs/siwe/actions/verifySiweMessage),
[viem signature verification](https://github.com/wevm/viem/blob/main/src/actions/public/verifyHash.ts),
[ERC-6492](https://eips.ethereum.org/EIPS/eip-6492). Our implementation deliberately
supports a narrower wallet set than viem's general-purpose verification action.

## Paid versus recoverable

`ParticipantRecovery` obtains the current healthy finalized snapshot, matches it
to the approved funding terms, and checks only the signed-in user's allocation.
`readRewardReceipt` requires both contract uniqueness flags and exactly one
canonical finalized `RewardPaid` event matching campaign, slot, participant,
recipient and amount. It checks ledger version before/after reads. Missing,
orphaned, duplicate or contradictory evidence fails closed. A browser-provided
transaction hash is not accepted as payment evidence.

`PAID` includes the actual transaction/block hash, block number and log index.
Already-paid POST retries return this receipt without another signature, even if
the supplied proof expired or signing is disabled. Unpaid allocations report
`RECOVERABLE`, `PAUSED`, `CLOSED`, `EXPIRED` or `NOT_STARTED`. Without an allocation,
the API reports `NOT_ALLOCATED`, `EXHAUSTED`, `COMPLETION_CLOSED` or the relevant
campaign restriction. Responses include the finalized `asOf` block. `RECOVERABLE`
means no matching finalized payment yet, not proof that no transaction is pending.
It requires a fresh proof and POST to obtain/replay an authorization. No slot is
released on an HTTP error, slow finality, pause, timeout or expiry.
The private response also includes committed reward terms for browser recovery
when a sponsor has withdrawn the public lesson. It contains no answer/signature.

## Email, consent and remaining policy

The NextAuth server-side Google sign-in event persists verification only when the
provider's verified email and subject match the actual linked user/account.
Unverified/mismatched profiles cannot stamp `users.email_verified`. The adapter
clears inherited verification when an email changes without new verification.
Magic-link behavior remains unchanged; actual inbox/production callback acceptance
is still L05, not established by database tests.

Contact sharing defaults false and never gates completion or payment. Consent is
an append-only optimistic-versioned history per user/campaign, with a private email
hash binding opt-in to that email. An email change or unverified email suppresses
sharing until renewed consent. Withdrawal and identical update retries are tested.
No export endpoint exists yet. Final consent copy, authorized sponsor export,
retention/deletion schedules and anonymization remain required before a pilot.

Current abuse controls are verified account/email, rate limits, wallet control and
one allocation per campaign/account. They do not prevent multiple accounts/emails,
multiple people sharing a wallet, sponsor self-claims or answer sharing, and do not
prove unique humans or learning. Pilot eligibility/fraud policy and any stronger
deduplication must be reviewed explicitly before enabling funded issuance.
