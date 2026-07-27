# Crossword Campaigns escrow contract v2

This is a new, independent contract. It does not migrate or modify the legacy
`crossword.puzzle.near` state.

The contract escrows one pinned NEP-141 USDC contract. A campaign is funded
either atomically through `ft_transfer_call` or by an operator after an external
Intents/x402 transfer has arrived. External funding is allocated only after a
creator-signed on-chain authorization fixes every campaign term and an
`ft_balance_of` callback proves the contract has enough unreserved USDC. The
operator cannot author or modify a prize, solution key, controller, refund
account, amount, rail, sponsor, or schedule.

## Direct funding message

Call USDC `ft_transfer_call` with the exact prize amount and this JSON `msg`:

```json
{
  "action": "create_campaign",
  "campaign": {
    "campaign_id": "campaign-id",
    "creator_id": "creator.near",
    "controller_id": "controller.near",
    "content_hash": "<base64 32-byte SHA-256>",
    "solution_public_key": "<base64 32-byte ed25519 key>",
    "opens_at_ms": 1735689600000,
    "expires_at_ms": 1736294400000,
    "refund_account_id": "creator.near"
  },
  "funding_reference": "direct:<globally-unique-reference>",
  "funding_deadline_ms": 1735689900000
}
```

Invalid or duplicate messages return the full token amount to the FT contract
instead of accepting it. `funding_deadline_ms` is the short-lived quote
deadline, must not exceed campaign expiry, and prevents an old direct-funding
message from remaining usable for the entire campaign window.

## External funding authorization

Before sending an Intents/x402 deposit, the creator calls the payable
`authorize_external_funding` method. The predecessor must be the immutable
creator, controller, and refund account, and cannot be the configured operator.
Attach enough NEAR to cover measured storage; excess is returned automatically.

```json
{
  "args": {
    "campaign": {
      "campaign_id": "campaign-id",
      "creator_id": "creator.near",
      "controller_id": "creator.near",
      "content_hash": "<base64 32-byte SHA-256>",
      "solution_public_key": "<base64 32-byte ed25519 key>",
      "opens_at_ms": 1735689600000,
      "expires_at_ms": 1736294400000,
      "refund_account_id": "creator.near"
    },
    "amount": "25000000",
    "funding_reference": "intents:<globally-unique-provider-reference>",
    "funding_rail": "intents",
    "sponsor_id": "sponsor.near",
    "funding_deadline_ms": 1735689900000
  }
}
```

After the provider transfer is final, the operator can submit only:

```json
{
  "args": {
    "campaign_id": "campaign-id",
    "funding_reference": "intents:<globally-unique-provider-reference>"
  }
}
```

The authorization creates no token liability and changes no reserved balance.
`funding_deadline_ms` is the last instant when the operator may start
allocation and cannot exceed campaign expiry. The application sets it to the
provider deposit deadline plus a bounded 15-minute finality/allocation grace;
provider deposit instructions themselves still disappear at the earlier quote
deadline. An allocation started on time
locks that authorization until its balance callback resolves; the callback may
finish after the funding deadline. If it finishes after campaign expiry, the
resulting prize is immediately eligible for permissionless refund to the
immutable creator recovery account.

An unstarted expired authorization cannot be allocated. Anyone may call
`cleanup_expired_external_funding_authorization`, or the creator may call
`revoke_external_funding_authorization` at any time while no allocation is
pending. Both release the campaign ID and return the released storage deposit
to the immutable creator. A replacement quote with a new reference
automatically cleans an expired authorization for the same campaign ID.
Retired references are permanent single-use tombstones and can never fund a
different campaign; the small storage cost of that tombstone remains retained.

This is the late-transfer recovery boundary: a provider transfer whose
allocation did not start by the authorization deadline can never be attributed
under expired or replacement terms. The application therefore hides provider
deposit instructions until the authorization is final, stops exposing them at
the quote deadline, and relies on the provider's configured origin-chain
refund/recovery path for a transfer that misses that boundary. The attached
storage allowance is the authorization-spam defense; unused allowance is
returned immediately.

## Claim permit

`get_claim_message` returns the exact bytes a solver must sign. The encoding is:

1. ASCII `crossword-campaign-claim:v1`
2. For contract ID, campaign ID, and receiver ID: a four-byte little-endian
   length followed by UTF-8 bytes
3. The 32-byte payout digest
4. The claim nonce as little-endian `u64`
5. The deadline in milliseconds as little-endian `u64`

The 64-byte ed25519 signature is submitted to `claim`. It binds the destination
and payout quote, so a relayer cannot substitute either. A nonce is consumed
before the token transfer starts. A failed transfer reopens the campaign but
requires a fresh signature over the next nonce.

`claim` receives one Rust `ClaimArgs` parameter, named `args`, so its JSON
wire format is explicitly nested:

```json
{
  "args": {
    "campaign_id": "campaign-id",
    "receiver_id": "winner.near",
    "payout_digest": "<base64 32-byte digest>",
    "nonce": 0,
    "deadline_ms": 1735689900000,
    "signature": "<base64 64-byte ed25519 signature>"
  }
}
```

The v2 server client already submits this format. A direct flat JSON call is
rejected before any payout begins.

[`fixtures/claim-permit-v1.json`](fixtures/claim-permit-v1.json) contains a
fixed seed, public key, message, digest, and signature for cross-language
conformance tests. The seed is intentionally public test material.

## Lifecycle and accounting

Campaigns move through:

```text
Scheduled -> Active -> Claiming -> Claimed
Scheduled/Active -> Refunding -> Refunded
```

`total_reserved` changes only when funding is accepted or a claim/refund
callback succeeds. `get_accounting` independently sums live campaign
liabilities so operators and indexers can assert the internal invariant.

Failed claims return to `Active`. Failed refunds stay in `Refunding` and can be
retried by anyone; the destination can never be changed. Before opening, the
creator, controller, or configured operator may initiate cancellation. The
operator relay supports authenticated creator requests in the web workflow but
still cannot change the immutable refund account or amount.
