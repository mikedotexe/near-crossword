# Base Batches 004 application draft

Status: prepared offline on 2026-09-07; not submitted. Applications close
September 9, 2026. The [application](https://www.base.org/batches/apply) requires
written and video material and does not save drafts.

Replace every `MIKE:` field with a verified answer before submission. Recheck
product URLs after deployment and keep the testnet qualifiers unless stronger
evidence is recorded in the launch register.

## Recommended application settings

- Company name: **Crossword**
- Primary category: **Payments**
- Stage: **MVP**
- Website/product URL: `https://crossword.xyz`
- Demo URL: `https://crossword.xyz/learn/practice`
- Public Base Sepolia contract:
  `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304`
- Contract explorer:
  `https://sepolia.basescan.org/address/0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304`
- Finalized sponsored payout:
  `https://sepolia.basescan.org/tx/0x35860a8044d025b6086acbacc02a3f173520b88410fc9338c6267117dc6f1255`

## Company

### What are you building?

Crossword turns sponsor budgets into verifiable learning rewards. A company
publishes a short, source-grounded lesson and crossword, prefunds a campaign in
USDC on Base, and distributes fixed rewards to eligible learners. Participants
enter through email-backed Coinbase Developer Platform smart accounts, so they
do not need a seed phrase or ETH. Sponsors can reconcile deposits, payouts, and
refunds against onchain escrow while completion data and optional contact
consent stay private.

Think of it as the next generation of Coinbase Earn, offered as infrastructure
that any company can use. The crossword is our first learning format; the core
product is understandable onboarding plus accountable micropayment distribution.

### Website/Product URL

`https://crossword.xyz`

Verified September 7, 2026: the Base-first home, practice lesson, sponsor demo,
metadata, and social image are live on this domain. Desktop and mobile layouts
passed the launch-candidate browser suite before deployment.

### X URL

`MIKE: company or product X URL`

## Team

### Founder name and role

`MIKE: full name — Founder / role wording`

### Brief previous professional experiences

`MIKE: 2-4 concise sentences. Prioritize shipped payment, crypto, protocol,
developer-tool, founder, or distribution work that explains why you can win.`

### Hardest problem or adversity; how you navigated it and what you learned

`MIKE: personal factual answer. Aim for one specific situation, the decision you
made, the measurable result, and the operating lesson you still use. Do not use
the recent wallet compromise unless you genuinely want that to represent you.`

### Contact and team facts

- Email: `MIKE: email`
- Telegram: `MIKE: handle or URL`
- X: `MIKE: personal X URL`
- LinkedIn: `MIKE: LinkedIn URL`
- Team size: `MIKE: confirm number`
- Primary location: `MIKE: city, region, country`
- Founder video URL: `MIKE: public Loom/YouTube/other URL`

## Product And Traction

### What problem are you solving?

Companies spend meaningful budgets teaching and acquiring users, but campaign
distribution is usually opaque and crypto rewards still make recipients manage
wallets and gas before they understand the product. Small payouts are especially
hard: the operational burden and trust gap can be larger than the reward itself.
Crossword gives sponsors a simple learning experience, invisible smart-account
onboarding, and a Base ledger that makes the campaign budget auditable.

### Why are you working on this idea?

The original Crossword smart contract was inspired by Coinbase Earn: learn one
useful thing, answer a question, and receive a small amount of a network's token.
The first version proved that learning and onchain rewards feel naturally linked,
but a single-winner puzzle was too narrow. Rebuilding it as sponsor-funded,
many-recipient campaigns revealed the larger product: companies need a reliable
way to distribute small rewards and prove where the campaign money went.

### What is your unique insight or advantage?

Most learn-and-earn products treat the token as promotion and the ledger as a
backend detail. We treat reward distribution itself as the product. A sponsor
should be able to fund once, set exact per-person terms, and reconcile every
payout and refund without trusting a spreadsheet. At the same time, a learner
should experience email, a two-minute lesson, and a small USDC reward rather than
wallet setup. Our advantage is having already worked through both halves: strict
onchain campaign accounting and consumer-friendly smart-account delivery.

The other insight is architectural: content generation, sponsor principal, and
participant rewards must be separate economic flows. NEAR AI can prepare
source-grounded drafts, and x402 can meter that service, without taking money
from the reward pool that was promised to learners.

### How long have you been working on it?

`MIKE: choose the form's accurate range and add one sentence distinguishing the
original Crossword project from the current sponsor-learning pivot.`

### Current stage

Recommended selection: **MVP**.

Qualifier for free text: The Base product is a working Sepolia pilot. The public
practice and sponsor flows are ready for product review; production-funded Base
campaigns remain gated pending final acceptance and a deliberately scoped
mainnet pilot.

### Demo URL

`https://crossword.xyz/learn/practice`

The sponsor workflow is at `https://crossword.xyz/learn/sponsor-demo`. It is a
synthetic non-persisting demo and says that saving is disabled.

### What have you built to date?

We have built a full Base campaign and participant path:

- A Solidity USDC escrow for prefunded fixed rewards, one-time eligibility,
  campaign limits, pauses, signer rotation, deadlines, and refunds.
- Canonical event ingestion and reconciliation that fail closed on stale,
  orphaned, or contradictory chain state.
- A private sponsor workflow for source material, human review, immutable
  crossword layouts, reward-term approval, funding linkage, and publication.
- A participant workflow for lesson completion, optional contact consent,
  wallet-control proof, durable claim issuance, and finalized recovery.
- Email OTP and smart-account onboarding through Coinbase Developer Platform.
- A claim-only ERC-4337 paymaster proxy with narrow contract/function, recipient,
  campaign, amount, deadline, and one-use authorization checks.
- Source-grounded lesson generation through NEAR AI, with human review required.

On Base Sepolia, the escrow is deployed and a fresh zero-ETH Coinbase Smart
Account has received a finalized 1 test USDC reward with sponsored gas. A fresh
CDP email account also created its participant smart account locally; the final
combined CDP User Wallet reward acceptance remains in progress.

### Current traction

`MIKE: supply exact active users, paying users, revenue, TVL/reward volume, and
sponsor conversations. Use zero or pre-revenue where accurate. Do not count
automated tests, the developer, or test USDC as user/revenue traction.`

Suggested honest opening if still accurate:

> Pre-revenue and entering design-partner pilots. The current evidence is product
> velocity rather than market traction: a working Base Sepolia contract, a
> finalized sponsored smart-account payout, and end-to-end sponsor/learner
> software built in several days. Our next validation is one sponsor campaign
> with multiple real recipients and a measured repeat-purchase decision.

### Dune dashboard or public smart contracts

- Dune: none yet.
- Base Sepolia `LearningRewards`:
  `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304`
- Finalized sponsored payout:
  `0x35860a8044d025b6086acbacc02a3f173520b88410fc9338c6267117dc6f1255`

Before submission: decide whether to include the implementation repository. Do
not imply that testnet USDC is TVL or revenue.

### Capital raised and runway

`MIKE: exact capital raised, source/type, monthly burn if comfortable, and runway.
If bootstrapped, say so plainly.`

### Fundraising goals and VC plans

`MIKE: confirm intended raise and timing. Suggested structure: amount, 12-18
month milestones, and why accelerator timing helps. Do not invent a target.`

## Why Base

### Why do you want to join Base Batches?

Base Batches is unusually aligned with the problem we are solving: making small
onchain payments useful to ordinary people. We want Base's product and go-to-
market support to turn a technically working reward rail into a repeatable
sponsor business, then prove it with design partners and measurable campaigns.

### What part of the product is onchain or uses Base?

Base is the default reward and accounting network. Sponsors prefund USDC into a
Base escrow whose terms fix the reward amount, claim cap, campaign window,
eligibility signer, and refund deadline. Every payout and refund emits a public
record that can be reconciled to the sponsor's budget. Participants receive USDC
in CDP smart accounts, and a scoped paymaster covers only valid reward claims.

Source material, completion evidence, email, and optional contact consent remain
offchain for privacy. The application authorizes eligibility; the contract
proves budget constraints and money movement, not that a person learned or is a
unique human.

### Does the product have a token?

No. Rewards use USDC on Base. There is no planned Crossword token.

### Anything else or pitch deck

Crossword began as a NEAR smart-contract puzzle inspired by Coinbase Earn. The
current pivot keeps that original emotional insight and rebuilds the business
around Base: any sponsor can fund a useful learning campaign; any learner can
receive an onchain dollar without first becoming a wallet expert; and anyone can
inspect how the reward budget moved.

The technology is already beyond a mockup, but we are early enough for Batches
to matter. Our next eight-week shape is concrete: ship the first mainnet design-
partner campaigns, add sponsor reporting and private opt-in export, measure
fraud and repeat intent, and turn campaign setup into a paid, repeatable motion.

Pitch deck URL: `MIKE: optional public deck URL`

### Referral

`MIKE: exact person/source or "Base website" if that is accurate.`

## Founder video script

Target length: 90-120 seconds. Record the founder on camera, then share the
screen for the product and Base proof. Do not spend time on a protocol inventory.

### 0:00-0:20 — Problem and product

"I'm `MIKE: name`, founder of Crossword. Companies spend real money teaching and
acquiring users, but reward distribution is opaque and crypto onboarding often
asks people to manage a wallet and gas before they understand the product.
Crossword turns one sponsor budget into many small, verifiable learning rewards."

### 0:20-0:45 — Learner demo

Show `crossword.xyz/learn/practice`.

"A learner reads a two-minute, source-grounded lesson and solves a small
crossword. In a funded campaign, email verification creates their CDP smart
account behind the scenes. They never need a seed phrase or ETH, and the reward
is USDC on Base."

### 0:45-1:10 — Sponsor and proof

Show the sponsor demo, then the escrow and payout links.

"The sponsor reviews the lesson, puzzle, and exact campaign terms before
funding. Base escrow reserves the full reward pool, enforces fixed payouts and
claim limits, and records every payout and refund. This contract is deployed on
Base Sepolia, and this finalized transaction paid 1 test USDC to a fresh,
zero-ETH Coinbase Smart Account with sponsored gas."

### 1:10-1:35 — Insight and why now

"Crossword started years ago from the same insight as Coinbase Earn: learning
and a first onchain reward belong together. The larger opportunity is giving any
company that capability with transparent campaign accounting. Base and CDP now
make the learner experience simple enough, while smart accounts and USDC make
micropayment distribution practical."

### 1:35-1:55 — Ask and next milestone

"We're applying to Base Batches to turn this working payment path into a
repeatable sponsor product. Our next milestone is `MIKE: precise design-partner
and campaign target`, then measuring completion quality, fraud, cost per useful
user, and whether the sponsor buys again."

## Final submission checklist

- [ ] Every `MIKE:` field is resolved with a factual answer.
- [x] `crossword.xyz` shows the Base-first product and both demo URLs return 200.
- [ ] CDP production domain is configured only when the participant pilot is
  intentionally enabled.
- [ ] Contract and transaction links open without authentication.
- [ ] Product stage and traction agree with the dated launch register.
- [ ] Video is 1-5 minutes, publicly viewable, audible, and demonstrates product.
- [ ] Financing and program investment acknowledgements are reviewed carefully.
- [ ] No secret, private sponsor material, learner data, or crossword answer set
  appears in the submission.
- [ ] The final application is reviewed offline before the one-way form entry.
