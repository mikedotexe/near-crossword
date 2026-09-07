# Private review and reward issuance

`BASE_REVIEW_ENABLED` defaults false. The private Base API requires real database
sessions, owner authorization, same-origin mutations, bounded input and no-store
responses. Creation is idempotent; revisions are immutable. Approval binds both
the private review hash and answer-free public terms. Verified funding freezes
the approved revision. Approval alone is not publication.

`BaseRewardIssuer` reserves a unique participant/slot and persists the full
EIP-712 tuple before signing. Recovery reuses that allocation, recipient, amount
and deadline. Rotation changes the signer epoch, not the reservation. Slots are
never recycled, even after expiry or an ambiguous signer failure. Only verified
chain receipts establish payment; an authorization is not a paid reward.

The chain reader, eligibility verifier and signer are explicit server ports.
The implemented RPC/accounting path must use `ReconciledBaseChainReader` so a
stale, unreconciled or halted ledger cannot be bypassed by a fresh RPC response.
Never implement them from browser flags, supplied receipts or answer claims.
Session 6 implements persisted participant completion, expiring wallet proofs,
private claim/recovery APIs, Google verified-email persistence and separate optional
contact consent. Read [chapter 06](06-participants-and-recovery.md) for request
shapes, supported wallets and remaining policy/UX work. The production composition
uses separate default-off participant/signing gates; no funded key is configured.
Session 7 adds the review/player UI, approved layouts and publication (chapter 07),
plus pinned counterfactual verification and a gated Base Account adapter (chapter
08). Real passkey/paymaster acceptance and the secure sponsorship proxy remain open.

Schema, API shapes, commitments and existing database test evidence are in the
[backend workflow](../docs/base-learning-workflow.md). Keep private contact export,
consent, retention and abuse policies explicit before launching a sponsor pilot.
