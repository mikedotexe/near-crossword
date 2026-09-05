# Base learning reward contract design

Status: R3 local implementation checkpoint, 2026-09-04. The specification now has
a [Solidity implementation and tests](../contract-base/README.md). It is not
deployed, independently audited, or connected to application claim issuance.
See the [work order](reshape-action-plan.md) and [session checkpoint](reshape-progress.md).

## First-version decision

A sponsor prefunds a fixed number of equal USDC reward slots. After learning,
solving, and satisfying the campaign's participant policy, the application
assigns a slot and signs a recipient-bound authorization. Anyone may relay that
authorization, but payment can only reach its named recipient. The contract
enforces the campaign budget, slot/participant uniqueness, deadline, and amount.

Use a separate non-upgradeable Solidity deployment, initially one contract
holding separately accounted campaigns. Keep the existing NEAR contracts,
liabilities, and claim encodings intact. No bridging, any-token funding, reward
top-ups, variable rewards, or platform deductions from reward principal in v1.
Compute stake, inference credits, x402 revenue, and relayer gas are not escrow.

Use pinned OpenZeppelin implementations of `EIP712`, `SignatureChecker`,
`SafeERC20`, and `ReentrancyGuard`; pin the compiler and dependencies in the
implementation PR. Do not write a custom signature recovery or token wrapper.
[OpenZeppelin cryptography](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography)
provides both typed-data hashing and EOA/deployed-contract signature checks.

## Network and funding

The token is an immutable constructor parameter, restricted to the reviewed
network/token pair by deployment tooling. Local tests inject a test token.
Deployment must validate chain ID, token code, decimals, and source verification;
an environment variable alone is not proof of a correct deployment.

| Environment | Chain ID | Native USDC token |
| --- | --- | --- |
| Base mainnet | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | 84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

Token addresses were checked against [Circle's registry](https://developers.circle.com/stablecoins/usdc-contract-addresses)
on September 4. Recheck them at deployment. Store USDC amounts as integer atomic
units; do not use floating point or substitute a bridged lookalike token.

`createCampaign` pulls exactly `rewardAtomic * maxClaims` from `msg.sender`
using an existing allowance. The sponsor is also the immutable refund recipient.
Check the contract balance delta against the full amount and revert the entire
operation on mismatch. Unsolicited transfers cannot fund a campaign. Checked
arithmetic, nonzero amounts, and a nonzero slot count are mandatory.

## Campaign record

| Field | Meaning and mutability |
| --- | --- |
| `campaignId: uint256` | Contract-assigned monotonic ID, never reused |
| `sponsor: address` | Funding caller, controller, and immutable refund recipient |
| `rewardAtomic: uint256` | Fixed reward per slot, immutable |
| `maxClaims: uint32` | Fixed slot count, immutable; slots are `[0, maxClaims)` |
| `fundedAtomic: uint256` | Exact original principal, immutable |
| `startsAt: uint64` | Unix seconds, immutable, at or after creation time |
| `endsAt: uint64` | Application completion/issuance cutoff, immutable, after `startsAt` |
| `claimDeadline: uint64` | Final redemption cutoff, immutable, after `endsAt` |
| `termsHash: bytes32` | Nonzero commitment to the reviewed public terms, immutable |
| `eligibilitySigner: address` | Nonzero sponsor-selected issuer; sponsor can rotate |
| `signerEpoch: uint64` | Starts at 1, increments on every rotation, never reused |
| `paused: bool` | Sponsor-controlled claim pause; initially false |
| `closed: bool` | Terminal cancellation/refund marker |
| `paidCount: uint32` | Number of successfully transferred rewards |
| `refundedAtomic: uint256` | Principal successfully returned to the sponsor |

Track used slots and claimed participant IDs per campaign. Expose read-only
campaign state, slot/participant use, campaign outstanding principal, and
`totalReserved`. Paid amount can be derived from `paidCount * rewardAtomic`.

The public terms commitment covers the content revision, reward/count, timing,
eligibility policy version, privacy/consent terms, and signer-control policy.
Define canonical serialization and shared hash fixtures before API integration.
Publication must verify that the committed public terms match the fixed on-chain
reward, count, and timing fields; a hash alone cannot establish that consistency.
Do not put raw answers, answer hashes, email addresses, or private consent
records in the public terms object. The contract stores the commitment but
cannot verify the truth of a lesson or enforce off-chain policies.

## Authorization and redemption

EIP-712 domain:

```text
name = "Crossword Learning Rewards"
version = "1"
chainId = current chain ID
verifyingContract = deployed escrow address
```

Exact first-version type, including field order:

```text
Claim(uint256 campaignId,uint32 slot,bytes32 participantId,address recipient,uint256 amount,uint64 deadline,uint64 signerEpoch)
```

`participantId` is a random nonzero, campaign-scoped 32-byte identifier persisted
against an authenticated application account. It is not an email hash, wallet
address, or cross-campaign tracking ID. The application proves recipient wallet
control before first issuance and fixes that binding. Email and sponsor-contact
consent remain in separate private records; consent is not a reward condition.

`claim(authorization, signature)` requires:

1. Campaign exists, is not closed or paused, and has started.
2. `block.timestamp <= authorization.deadline <= campaign.claimDeadline`.
3. Epoch equals the campaign's current epoch; signature validates for its
   current eligibility signer and the exact domain and typed fields.
4. Slot is in range and unused; participant ID is nonzero and unclaimed.
5. Recipient is neither zero nor the escrow itself; amount equals the fixed
   reward and the campaign has sufficient outstanding principal.
6. Mark slot/participant used, increment paid count, and decrement total
   reserved principal before transferring the exact reward with `SafeERC20`.
   A failed transfer reverts all effects and emits no successful reward event.

Submission is permissionless so the operator can sponsor gas and a participant
can recover independently. `msg.sender` is never substituted for the signed
recipient. Front-running can submit the same payment, but cannot redirect it.
Use the reentrancy guard on every token-moving entry point.

[EIP-712](https://eips.ethereum.org/EIPS/eip-712) binds structured data to a
domain; it does not itself prevent replay. Used-slot and used-participant
checks supply replay protection, including across replacement signatures.
EOA and deployed ERC-1271 eligibility signers are supported. Counterfactual
signer validation is out of scope. Receiving USDC does not require the reward
recipient to implement the issuer's signature interface; wallet-control proof
and the separate x402 payer flow need their own compatibility tests.

## Backed inventory and issuance

All slots are backed when the campaign is funded. The application does not
make a second on-chain reservation transaction for each learner. It must uphold
these issuance rules in Postgres, with transactional uniqueness constraints:

- At most one participant/account binding per campaign and at most one binding
  for each `(chainId, contract, campaignId, slot)`.
- Allocate only after completion, email verification, wallet-control proof, and
  the chosen abuse checks, during `[startsAt, endsAt)`. Check finalized funding
  and current campaign/signer state before issuing. Signing authority remains
  trusted: the contract cannot prove when an off-chain signature was issued.
- Persist the complete authorization tuple before signing. Retries sign/replay
  that same tuple. If signing or HTTP delivery fails, retain the allocated slot;
  do not infer that no signature exists from a lost response.
- Set `deadline = claimDeadline` in the first application version. No slot is
  recycled or transferred to another participant, even after a short-lived
  authorization expires or a signer rotates. Unused principal is refunded only
  at the campaign's terminal refund boundary.
- Recipient changes after issuance are unsupported in v1. Rotation recovery
  reissues only the same participant, slot, recipient, amount, and deadline under
  the new epoch, after checking whether the original has already been paid.
- Reconcile claims sent by any relayer, not just transactions we submitted.
  A timeout is pending/unknown, never proof of non-payment. Query receipt and
  slot/participant state before retrying; reuse the original authorization.

This bounds issued rewards without overbooking when the issuer follows the
policy. A malicious issuer can sign conflicting slots or invent participants;
the contract prevents overspending, not dishonest eligibility. A PostgreSQL
reservation is not an irrevocable on-chain entitlement. Describe it as an
authorized reward awaiting payment, subject to expiry/pause/issuer rotation.
Show "paid" only after the required chain confirmation policy is satisfied.

Unavailable inventory means no new promise, even if the on-chain paid count is
still below the cap. Show funded, paid, privately allocated, and unallocated
amounts distinctly. Allocation data comes from the application, not the chain.
Abuse resistance and abandoned allocations need pilot measurement; initial
simplicity deliberately trades some campaign utilization for reliable backing.

## Control, expiry, and refunds

- Sponsor alone can pause/unpause or rotate the eligibility signer. Emit an
  event for every change. Rotation always increments the epoch, including when
  returning to an old signer. Neither action edits the fixed terms or deadline.
- A pause stops claims, not the passage of time. It cannot enable early refunds.
  Claimants may miss expiry during a pause, so this control must be visible in
  campaign terms and operational support. No automatic deadline extension.
- The sponsor may cancel only before `startsAt`, with zero paid claims. Mark
  closed, clear the campaign's liability, and return its full principal atomically.
  All later authorizations for that campaign then fail.
- After `claimDeadline` (strictly greater, not equal), anyone can call
  `refundExpired(campaignId)`. Close the campaign and transfer only its remaining
  principal to its immutable sponsor, even if paused. Repeated calls cannot pay
  again. A token failure leaves state retryable. Zero remainder can close with
  a zero-amount event without attempting a zero-value token transfer.
- No sponsor withdrawal during an active claim window. No platform-wide admin
  withdrawal, arbitrary token call, or sweep of USDC surplus in v1. Unattributed
  donations stay outside campaign accounting and cannot be reclaimed as rewards.

The initial application default is a 24-hour redemption grace period after
`endsAt`, displayed before funding. The contract accepts any strictly later
`claimDeadline`; pilot review may change the default, not funded campaigns.
There is no complete availability guarantee: issuer outages, sponsor controls,
chain failures, and the USDC token's own controls can delay or prevent payment.

## Events and accounting

Emit sufficient fields to reconstruct funding and successful effects:

- `CampaignFunded`: campaign ID, sponsor, token, principal, reward, slot cap,
  starts/end/claim times, terms hash, signer, and initial epoch.
- `RewardPaid`: campaign ID, slot, opaque participant ID, recipient, amount.
- `CampaignPauseChanged`: campaign ID and paused state.
- `EligibilitySignerChanged`: campaign ID, previous/new signer, new epoch.
- `CampaignRefunded`: campaign ID, sponsor, amount, and cancellation/expiry reason.

For each campaign, at every completed transaction:

```text
paidAtomic = paidCount * rewardAtomic
0 <= paidCount <= maxClaims
fundedAtomic = paidAtomic + outstandingAtomic + refundedAtomic
totalReserved = sum(outstandingAtomic for all campaigns)
USDC.balanceOf(escrow) >= totalReserved
```

Record events by chain, contract, transaction hash, and log index with block hash
and number. Deduplicate replay, rewind orphaned observations, and distinguish
submitted, included, and confirmed/finalized transactions. The exact Base
confirmation threshold is an activation prerequisite, not an invented guarantee.
Rebuild campaign totals from canonical events and compare with contract getters
and token balance. An unrelated transfer is never campaign funding evidence.

Public receipts prove token movement and the enforced budget, recipient, and
uniqueness rules. They do not prove unique humans, truthful learning outcomes,
email ownership, or honest sponsor/issuer behavior. Opaque participant IDs still
link a wallet to this campaign publicly; explain that before wallet binding.

## Implementation and acceptance checklist

`contract-base/` now pins Solidity 0.8.30, Forge 1.7.1, OpenZeppelin 5.6.1, and
forge-std 1.16.2. The `viem` helper and Solidity tests share a digest/signature
fixture. Local funding/claim/refund events and stateful solvency tests pass.
The database/API integration and live event ingestion below remain next work;
these tests are not a production deployment or audit.

- Unit tests for exact prefunding, bad timing/amounts, token failures, fee-on-
  transfer rejection, unauthorized controls, unknown campaigns, and cancellation.
- Fixed TypeScript/Solidity digest and signature fixtures for the exact typed
  struct, EOA and ERC-1271 signers, and domain/field substitution rejection.
- Replay tests for slot, participant, recipient, chain, deployment, amount,
  deadline, and epoch; signer rotation back to an old key must not revive permits.
- Exhaustion/race tests: at most N rewards, exactly one success for conflicting
  slot or participant claims, no loss of other campaigns' reserved principal.
- Boundary tests at start/end/deadline, paused expiry, zero-remainder closure,
  failed claim/refund transfer rollback, and immutable refund recipient.
- Stateful invariant/fuzz tests across funding, claims, rotation, pause,
  donation, and refund; include a malicious reentrant token fixture.
- Later database/API tests for concurrent allocation, duplicate participant
  attempts, crash-before/after-signing, lost receipts, reorg replay, and consent
  isolation. These are R4 integration requirements, not satisfied by Solidity tests.

Before deployment, review sponsor/issuer identities, key storage and rotation,
gas sponsorship budget, claim confirmation policy, contract limits, independent
security findings, and exact pilot terms. Implementing local code does not
authorize deployment or spending. R3 remains open until its executable tests
and reconciliation evidence exist.
