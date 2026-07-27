# Crossword Campaigns contributor guide

## Product invariant

A campaign is never public or claimable until the complete native-USDC prize is
reserved by the v2 contract. The application must never subsidize a prize from
an operator balance or infer settlement from an unrelated shared balance.

## Repository map

- `app/` — Next.js 15 App Router product and `/api/v2` endpoints
- `src/server/v2/` — workflow services, repositories, adapters, and chain worker
- `src/lib/v2/` — browser/server claim-message conformance helpers
- `migrations/v2/` — append-only Postgres workflow schema
- `contract-v2/` — independent pinned-USDC campaign escrow contract
- `src/legacy/`, `contract/` — isolated legacy compatibility; do not migrate or
  redeploy as part of v2 work
- `worker/` — retained upstream agent worker with hardened URL and secret
  handling

## Safety boundaries

- Never broadcast a chain mutation unless
  `V2_CHAIN_BROADCAST_ENABLED=true`; tests must use injected clients.
- Never use a funded key or mainnet route without explicit confirmation of
  network, asset, amount, payer, receiver, and refund/recovery address.
- Operator keys, provider credentials, payment headers, solution signatures,
  raw answers, and private keys must not be logged or returned as evidence.
- x402 is for discrete paid services. Prize principal must use contract escrow.
- 1Click funding is exact-output; winner routing is exact-input.
- Only asset IDs returned by the live token catalog are accepted. Do not invent
  display-name asset IDs.
- All external effects need durable idempotency, bounded retry, and
  reconciliation after ambiguous failure.
- Contract state is authoritative for escrow/claims/refunds. Postgres is
  authoritative for workflow intent and external receipts.

## Claim compatibility

The browser and contract share the fixed
`crossword-campaign-claim:v1` encoding. Any change requires:

1. A new explicit version/domain.
2. Updated Rust and TypeScript conformance fixtures.
3. Replay, recipient-substitution, deadline, nonce, and callback-failure tests.

Do not install dynamic solution access keys. Answers and private keys stay
off-chain.

## Development

Safe local mode requires `V2_FUNDING_MODE=mock` and an explicit demo identity.
It moves no funds and must never be enabled in production. Production fails
closed without Postgres, the v2 contract account, and both pinned USDC IDs.

Before handing off a change, run the commands in `README.md` and classify any
missing live acceptance evidence honestly. Keep `README.md`, `QA.md`, and
`.env.example` aligned with runtime variable names and active routes.
