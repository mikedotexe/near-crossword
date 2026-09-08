# Crossword

Sponsor-funded learning rewards on Base.

Crossword lets a company publish a short, source-grounded lesson and crossword,
prefund fixed USDC rewards, and reconcile every payout and refund against
onchain escrow. Learners enter through email-backed Coinbase Developer Platform
smart accounts, so the intended experience requires neither a seed phrase nor
ETH.

- Live product: [crossword.xyz](https://crossword.xyz)
- Practice lesson: [crossword.xyz/learn/practice](https://crossword.xyz/learn/practice)
- Sponsor workflow: [crossword.xyz/learn/sponsor-demo](https://crossword.xyz/learn/sponsor-demo)
- Launch status and open gates: [docs/early-launch-status.md](docs/early-launch-status.md)
- Base Batches narrative: [md-CLAUDE-chapters/11-base-batches.md](md-CLAUDE-chapters/11-base-batches.md)

The public practice and sponsor pages are no-payment demos. Production reward
publication, participant wallets, paymaster sponsorship, and chain broadcasting
remain disabled until the acceptance evidence in the launch register is
complete.

## Why this exists

The original Crossword was inspired by Coinbase Earn: learn one useful thing,
answer a question, and receive a small onchain reward. This version turns that
idea into infrastructure any sponsor can use.

That original NEAR product has real mainnet history: 160 distinct puzzles were
solved and 157 rewards totaling 2,623 NEAR were successfully paid between June
2022 and January 2024. The [repeatable chain audit](md-CLAUDE-chapters/12-near-mainnet-traction.md)
keeps this historical proof separate from traction for the new Base product.

A sponsor can turn one campaign budget into many small rewards without asking
learners to acquire gas. Base provides the public accounting layer. Private
source material, completion evidence, email, and optional contact consent stay
offchain.

The crossword is the first learning format, not the boundary of the product.
The commercial surface is campaign creation, accountable reward distribution,
and sponsor reporting.

## Product flow

1. A sponsor supplies sources and reviews the lesson, puzzle, and exact reward
   terms.
2. The full campaign reward pool is reserved in USDC escrow on Base.
3. A learner completes the lesson through an email-backed CDP smart account.
4. The application issues a one-time eligibility claim after verifying the
   completion and wallet binding.
5. A narrow ERC-4337 proxy sponsors only the approved escrow claim.
6. Contract events and the canonical indexer reconcile payouts, remaining
   obligations, and refunds.

The contract proves budget constraints and money movement. It does not claim to
prove that a person learned something or that every account belongs to a unique
human.

## Working Base proof

The Base Sepolia pilot includes:

- `LearningRewards` escrow at
  [`0x77fd...A304`](https://base-sepolia.blockscout.com/address/0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304)
- A
  [finalized sponsored payout](https://base-sepolia.blockscout.com/tx/0x35860a8044d025b6086acbacc02a3f173520b88410fc9338c6267117dc6f1255)
  of 1 test USDC to a fresh, zero-ETH Coinbase Smart Account
- Tested EOA, deployed ERC-1271, and undeployed ERC-6492 authorization paths
- Durable publication, claim issuance, chain reconciliation, and recovery
- Local email OTP and CDP smart-account creation
- CDP-managed Paymaster integration with pre-send database gas reservation

The combined email-backed CDP account plus funded sponsored claim is still an
open acceptance item. Testnet USDC is not revenue, TVL, or user traction.

## Architecture

```text
Sponsor sources and campaign terms
              |
              v
Private review + immutable publication commitment
              |
              +--------------------------+
              |                          |
              v                          v
      Postgres workflow             Base USDC escrow
      lessons, consent,             funded terms,
      claims, recovery              payouts, refunds
              |                          ^
              v                          |
Learner email OTP -> CDP smart account -> claim-only paymaster
```

Postgres is canonical for private workflow intent and external receipts. Base is
canonical for campaign funds, claims, and refunds. Paid and chain operations use
idempotency keys, compare-and-set transitions, bounded retries, and durable
reconciliation.

The independent Solidity package is in [`contract-base`](contract-base/README.md).
The sponsor and participant backend is documented in
[`docs/base-learning-workflow.md`](docs/base-learning-workflow.md). The complete
implementation sequence lives in
[`docs/reshape-progress.md`](docs/reshape-progress.md).

## Supporting services

Base is the reward and accounting network. Two other systems have deliberately
narrower roles:

- **NEAR AI** prepares source-grounded lesson drafts for mandatory human review.
  The local adapter uses `NEAR_AI_API_KEY`; bounded GLM 5.1 checks are recorded
  in [`docs/near-ai-evaluation-2026-09-04.md`](docs/near-ai-evaluation-2026-09-04.md).
- **x402** is the intended payment boundary for campaign-intelligence services.
  It does not hold sponsor principal or pay learner rewards. Production x402 is
  currently disabled.

The original NEAR winner-take-all campaign application remains available at
[`/legacy`](https://crossword.xyz/legacy). Its contracts and outstanding state
are preserved and tracked separately in the launch register.

## Local development

Requirements:

- Node 20 and Yarn 4
- Rust stable plus `wasm32-unknown-unknown`
- Postgres for persistent development
- Foundry, provisioned through the repository helper, for Solidity tests

Install and run the no-payment public experience:

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
when the process restarts.

For Postgres-backed development:

```bash
docker compose up -d postgres
yarn db:migrate:v2
yarn dev
```

Developer-only learning previews require `BASE_UI_PREVIEW_ENABLED=true` and are
available at `/learn/preview` and `/learn/studio/preview`. They always return 404
in production. The public `/learn/practice` and `/learn/sponsor-demo` routes are
synthetic and nonpaying.

## Activation boundaries

Base capabilities fail closed. Their settings are documented in
[`.env.example`](.env.example), including:

- `BASE_REVIEW_ENABLED`
- `BASE_PUBLICATION_ENABLED`
- `BASE_ACCOUNT_ENABLED`
- `CDP_PARTICIPANT_AUTH_ENABLED`
- `BASE_PARTICIPANT_ENABLED`
- `BASE_CLAIM_ISSUANCE_ENABLED`
- `BASE_SPONSORED_GAS_ENABLED`
- `BASE_CDP_MANAGED_PAYMASTER_ENABLED`
- `BASE_PAYMASTER_PROXY_ENABLED`
- `BASE_INDEXER_ENABLED`

CDP server credentials, paymaster endpoints, eligibility keys, deployer keys,
and participant tokens are server-only. Never place a seed phrase or funded
deployer key in the web environment. The retained NEAR worker also refuses chain
operations unless its separate explicit broadcast gate is enabled.

Use the [Base Sepolia acceptance checklist](docs/base-sepolia-sponsorship-acceptance.md)
and [launch runbook](docs/launch-runbook.md) before changing any gate. A public
demo deployment is not evidence that the funded production journey is ready.

## Verification

```bash
yarn lint
yarn typecheck
yarn audit:production
yarn test:unit
yarn test:integration:base
yarn test:browser
yarn test:contract:v2
yarn contract:v2:build
yarn contract:base:fmt
yarn test:contract:base
yarn contract:base:build
yarn build
```

The browser suite uses explicit local fixtures. Postgres integration tests
require `TEST_DATABASE_URL` pointing at a disposable database. The launch
candidate passed 256 unit tests, 55 Base/Postgres integration tests, 18 browser
tests, 30 Rust contract tests, 29 Solidity contract tests, lint, typecheck, and
the production build before the September 7 deployment.

See [`QA.md`](QA.md) for the acceptance matrix and
[`md-CLAUDE-chapters`](md-CLAUDE-chapters/README.md) for the subject-oriented
engineering record.
