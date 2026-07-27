# Crossword Campaigns

**Fund with anything. Win anywhere.**

Crossword Campaigns turns the original NEAR Crossword into a sponsor-funded
campaign platform. A creator writes a puzzle, locks a complete USDC prize before
publication, and shares a campaign page. Solving is free; the first valid
solution wins.

The v2 design makes two workflows possible:

1. **Cross-chain jackpot** — fund with an asset currently supported by NEAR
   Intents, solve without a NEAR wallet, and route the prize to a supported
   destination.
2. **x402 campaign** — pay once for AI-assisted puzzle creation through x402,
   then publish a separately funded prize with independent creation and payout
   receipts.

“Any asset” always means a route returned by the live 1Click catalog and quote
API. It is not a promise that every asset has liquidity.

## Product boundaries

- Sponsored, free-to-play, winner-take-all campaigns only in v1.
- Prize escrow is pinned native USDC on NEAR.
- Prize principal, routing costs, and platform fees are separate ledger values.
- x402 pays for discrete services. It never substitutes for funded escrow.
- Paid entry, raffles, pooled bounties, arbitrary merchant URLs, exact-asset
  escrow, and public first-N rewards are intentionally excluded.
- Creators know their answers and can collude or self-claim. V1 addresses this
  honestly with sponsor identity, public evidence, beta caps, and reputation;
  it does not claim an impossible cryptographic guarantee.

## Architecture

```text
Creator / solver
      │
      ▼
Next.js App Router + /api/v2
      │
      ├── Postgres workflow ledger
      │     campaigns · funding orders · claims · events · durable jobs
      │
      ├── 1Click adapters
      │     exact-output funding · exact-input payout · live token catalog
      │
      ├── x402 AI service
      │     payment-identifier deduplication · single-use campaign receipt
      │
      └── gated chain worker
            │
            ▼
      Crossword Campaigns v2 contract
      pinned NEP-141 USDC escrow · claim proofs · expiry/refunds
```

Postgres is canonical for workflow intent and external receipts. The contract
is canonical for escrow, claims, and refunds. Every paid or chain operation uses
idempotency keys, compare-and-set transitions, bounded retry, and durable
reconciliation.

An x402-paid AI result returns a minimal versioned receipt handle. Campaign
creation verifies that handle against the completed durable payment record and
copies only a public receipt digest, network, and settlement reference into the
campaign evidence. Each paid generation can be linked to one campaign; manual
campaigns remain valid without one. Prompts, generated answers, payer identity,
raw payment headers, and payment authorization never enter campaign evidence.

The browser derives a transient ed25519 solution key from a canonical,
domain-separated answer representation. Only the public key is stored with the
campaign. A claim signature binds the contract, campaign, receiver or 1Click
deposit account, payout digest, nonce, and deadline. Answer material and private
keys are neither sent to the API nor persisted in browser storage.

## Application routes

- `/explore` — browse public, funded campaigns
- `/create` — manual or x402-assisted campaign builder
- `/campaigns/[slug]` — rules, prize state, timing, and evidence
- `/campaigns/[slug]/play` — anonymous solving and winner payout choice
- `/dashboard` — creator campaigns and recovery actions
- `/legacy` — isolated access to the original claim flow

The old `crossword.puzzle.near` contract and its funds are untouched. The
original contract source remains in `contract/`; the independent v2 contract is
in `contract-v2/`. The former market-agent worker remains only as source
history: no package script compiles or starts it, and `worker:start` is an alias
for the gated v2 reconciliation worker.

## Local development

Requirements:

- Node 20 and Yarn 4
- Rust stable plus `wasm32-unknown-unknown`
- Postgres for persistent development; deterministic in-memory mode is
  available only outside production

Install and run the safe local mode:

```bash
corepack enable
yarn install --immutable
cp .env.example .env.local
V2_FUNDING_MODE=mock \
NEXT_PUBLIC_V2_DEMO_USER_ID=creator@example.test \
NEXT_PUBLIC_APP_URL=http://localhost:3000 \
DATABASE_URL= \
yarn dev
```

Mock mode moves no funds, accepts no payment as settled, and loses its state
when the process restarts. It is designed for product and browser testing.

For Postgres-backed development:

```bash
docker compose up -d postgres
yarn db:migrate:v2
yarn dev
```

The chain worker refuses to lease work unless
`V2_CHAIN_BROADCAST_ENABLED=true`. Keep it false for normal development. A
configured staging operator can start the worker with:

```bash
yarn worker:v2
```

Set `V2_NEAR_NETWORK` explicitly to `testnet` or `mainnet`; production refuses
to start without it, and the server rejects a mismatch with
`NEXT_PUBLIC_NEAR_NETWORK`.

Never enable broadcasting with a funded key until the contract account, pinned
USDC token, network, operator, campaign amounts, and recovery destinations have
been independently checked.

## Verification

```bash
yarn lint
yarn typecheck
yarn audit:production
yarn test:unit
yarn test:browser
yarn test:contract:v2
yarn contract:v2:build
yarn build
```

The browser suite runs against explicit local mock mode. 1Click has no testnet
environment, so automated routing tests use deterministic adapters and NEAR
testnet token fixtures. Mainnet acceptance requires explicit small-value human
approval and must include both successful settlement and refund recovery.

See [QA.md](QA.md) for the acceptance matrix and
[contract-v2/README.md](contract-v2/README.md) for the claim encoding and escrow
state machine. [docs/launch-runbook.md](docs/launch-runbook.md) separates
staging, approved mainnet canaries, cutover, and rollback.

## Production configuration

Production fails closed without:

- `DATABASE_URL`
- `NEXT_PUBLIC_APP_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `RESEND_API_KEY`
- `V2_NEAR_NETWORK`
- `NEXT_PUBLIC_NEAR_NETWORK`
- `V2_CONTRACT_ID`
- `NEXT_PUBLIC_V2_CONTRACT_ID`
- `V2_USDC_ASSET_ID`
- `V2_USDC_CONTRACT_ID`
- `NEXT_PUBLIC_V2_USDC_CONTRACT_ID`
- `V2_TRUSTED_CLIENT_IP_HEADER`

The 1Click, x402, email, and chain-worker settings are documented in
[.env.example](.env.example). Secrets, operator keys, payment credentials, and
provider bearer tokens are server-only.

No v2 mainnet contract deployment or funded acceptance campaign is implied by this
repository. Launch still requires contract audit, staging evidence, explicit
small-value approvals, reconciliation of the legacy account, and transfer of
upgrade authority to the selected multisig.
