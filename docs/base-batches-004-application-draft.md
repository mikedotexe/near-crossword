# Base Batches 004 application draft

Status: prepared offline on 2026-09-07; not submitted. Applications close
September 9, 2026. The [application](https://www.base.org/batches/apply) requires
written and video material and does not save drafts.

The founder video is the only required material still missing. Keep the testnet
qualifiers unless stronger evidence is recorded in the launch register.

## Recommended application settings

- Company name: **Crossword**
- Primary category: **Payments**
- Stage: **MVP**
- Website/product URL: `https://crossword.xyz`
- Demo URL: `https://crossword.xyz/learn/practice`
- Public Base Sepolia contract:
  `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304`
- Contract explorer:
  `https://base-sepolia.blockscout.com/address/0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304`
- Finalized sponsored payout:
  `https://base-sepolia.blockscout.com/tx/0x35860a8044d025b6086acbacc02a3f173520b88410fc9338c6267117dc6f1255`
- Exact app-committed pilot funding:
  `https://base-sepolia.blockscout.com/tx/0x4c9199cfaa7f8c138bc64da55a2ab7cddbe7a8eab77e9f7adfff99b13a1cbd99`

## Company

### What are you building?

Crossword turns sponsor budgets into verifiable learning rewards. A company
publishes a short, source-grounded lesson and crossword, prefunds a campaign in
USDC on Base, and distributes fixed rewards to eligible learners. Participants
enter through email-backed Coinbase Developer Platform smart accounts, so they
do not need a seed phrase or ETH. Sponsors can reconcile deposits, payouts, and
refunds against onchain escrow while completion data and optional contact
consent stay private.

Think of it as a small, reusable successor to Coinbase Earn that any company can
use. The crossword is our first learning format; the core product is
understandable onboarding plus accountable micropayment distribution.

### Website/Product URL

`https://crossword.xyz`

Verified September 7, 2026: the Base-first home, practice lesson, sponsor demo,
metadata, and social image are live on this domain. Desktop and mobile layouts
passed the launch-candidate browser suite before deployment.

### X URL

`https://x.com/mikedotexe`

## Team

### Founder name and role

Mike Purvis, solo founder and engineer.

### Brief previous professional experiences

I was an early NEAR Protocol engineer, joining nine months before mainnet, and
have spent roughly six years building blockchain infrastructure and developer
products. I now work with FastNear and independently operate an x402 facilitator
across Base and NEAR. Before crypto, I shipped web, mobile, payment-adjacent, and
cloud systems for organizations ranging from startups to Fortune 500 teams.

### Hardest problem or adversity; how you navigated it and what you learned

My previous startup, CronCat, raised money from angel investors and a venture
fund, but ultimately failed. The difficult part was not a single technical
problem; it was accepting that investor belief and ambitious infrastructure did
not create enough customer pull. I learned that persistence can quietly become
attachment, and that a founder has to test the plain commercial promise early.
That lesson shapes Crossword. I am keeping the team and product small, being
direct about having no paying sponsor traction yet, and making one paid sponsor
campaign with repeat intent the next test before treating it as a large company.

### Contact and team facts

- Email: `mikedotexe@gmail.com`
- Telegram: `@mikedotexe`
- X: `https://x.com/mikedotexe`
- LinkedIn: `https://www.linkedin.com/in/mikerobertpurvis`
- Team size: **1**
- Primary location: **Portland, Oregon, United States**
- Founder video URL: `VERIFY: public Loom/YouTube/other URL`

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

Recommended selection: **4+ years**.

The original NEAR Crossword repository dates to May 2021. The current
sponsor-funded, Base-first product is a new September 2026 pivot that reused the
original learn-and-earn insight while replacing the product and payment model.

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
- Managed CDP gas sponsorship with a claim-only provider allowlist, pre-send
  database budget reservation, one-use authorization and finalized recovery.
- Source-grounded lesson generation through NEAR AI, with human review required.
- A legacy NEAR mainnet product with 160 distinct puzzle solves and 157
  successful payouts totaling 2,623 NEAR between June 2022 and January 2024.

On Base Sepolia, the escrow is deployed and a fresh zero-ETH Coinbase Smart
Account has received a finalized 1 test USDC reward with sponsored gas. A fresh
CDP email account also created its participant smart account locally. A separate
one-slot campaign commits to the exact sponsor-approved application revision and
is funded, finalized, and locally bound. Its first payout attempt returned an
unknown outcome and was not retried. It remains audit evidence; full combined
CDP User Wallet acceptance is an explicit next pilot milestone.

### Current traction

Pre-revenue, with one founder, zero paying sponsors, and no current external
active users on the new Base product. Test USDC is not revenue or TVL. The
original NEAR version did reach real mainnet use: its contracts recorded 160
distinct successful puzzle solves and 157 payouts totaling 2,623 NEAR between
June 2022 and January 2024. Those are historical winner and payout events, not
160 unique people or current Base users. The next validation is one Base design-
partner campaign with multiple real recipients and a measured repeat-purchase
decision. There are no sponsor conversations to report yet.

### Dune dashboard or public smart contracts

- Dune: none yet.
- Base Sepolia `LearningRewards`:
  `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304`
- Finalized sponsored payout:
  `0x35860a8044d025b6086acbacc02a3f173520b88410fc9338c6267117dc6f1255`
- Exact app-committed pilot funding:
  `0x4c9199cfaa7f8c138bc64da55a2ab7cddbe7a8eab77e9f7adfff99b13a1cbd99`
- NEAR mainnet contracts: `crossword.puzzle.near` and
  `shitzu.crossword.puzzle.near`
- Reproducible NEAR evidence:
  `md-CLAUDE-chapters/12-near-mainnet-traction.md`

Before submission: decide whether to include the implementation repository. Do
not imply that testnet USDC is TVL or revenue.

### Capital raised and runway

Crossword is bootstrapped and has raised no outside capital. It is a solo project
with low current cash burn; the primary investment has been founder time and the
existing infrastructure used to ship the MVP. I previously raised money from a
couple of angel investors and a venture fund for CronCat, a separate web3 startup
that ultimately failed. None of that capital belongs to Crossword.

### Fundraising goals and VC plans

I am not currently running a conventional VC process. The immediate goal is to
prove sponsor demand, run paid Base campaigns, and finance the product through
campaign revenue. I would consider strategic capital that materially accelerates
distribution on Base. The long-term dream is for Crossword to become useful
enough to Coinbase that acquisition is a natural outcome, echoing Coinbase's
acquisition of Earn.com. That is an ambition, not a dependency in the operating
plan.

## Why Base

### Why do you want to join Base Batches?

Crossword is built around a product truth that Base makes possible: a person's
first onchain reward can feel like email and arrive whole, without gas or wallet
homework. We want Base's product and go-to-market support to turn that working
payment rail into a repeatable sponsor business with measurable campaigns.

### What part of the product is onchain or uses Base?

Base is the native reward and accounting network, not one option in a chain
selector. Sponsors prefund USDC into a Base escrow whose terms fix the reward
amount, claim cap, campaign window, eligibility signer, and refund deadline.
Every payout and refund emits a public record that can be reconciled to the
sponsor's budget. Participants receive USDC in CDP smart accounts, and a scoped
paymaster covers only valid reward claims.

That choice also defines the economics. A learner on Base receives the full
advertised reward and never pays gas. Crossword's campaign and reporting fee is
separate from sponsor principal, and Base campaigns carry no chain-integration
surcharge. A future sponsor that insists on another network would pay for a
custom integration and provide its settlement and gas infrastructure. Base gets
the simplest and least expensive product because CDP's managed paymaster and
smart-account stack make that experience possible.

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

This is intentionally a small, legible product. We are not claiming to reinvent
education or prove that somebody learned. We think sponsor-funded lessons plus
accountable micropayments are useful, and the next job is to prove that modest
claim with one real sponsor and a group of real learners.

The technology is already beyond a mockup, but we are early enough for Batches
to matter. Our next eight-week shape is concrete: ship the first mainnet design-
partner campaigns, add sponsor reporting and private opt-in export, measure
fraud and repeat intent, and turn campaign setup into a paid, repeatable motion.

Pitch deck URL: none. The live product, sponsor demo, and public transaction proof
are the current application materials.

### Referral

Base website.

## Founder video script

Target length: 2-3 minutes. Record the founder on camera, then share the screen
for the product, historical evidence, and Base proof. Do not spend time on a
protocol inventory.

### 0:00-0:20 — Problem and product

"I'm Mike Purvis, the solo founder of Crossword. Companies spend real money teaching and
acquiring users, but reward distribution is opaque and crypto onboarding often
asks people to manage a wallet and gas before they understand the product.
Crossword turns one sponsor budget into many small, verifiable learning rewards."

### 0:20-0:45 — Learner demo

Show `crossword.xyz/learn/practice`.

"A learner reads a two-minute, source-grounded lesson and solves a small
crossword. In a funded campaign, email verification creates their CDP smart
account behind the scenes. They never need a seed phrase or ETH, and the reward
is USDC on Base. They receive the full advertised amount because gas and our
campaign fee stay outside the reward pool."

### 0:45-1:10 — Sponsor and proof

Show the sponsor demo, then the escrow and payout links.

"The sponsor reviews the lesson, puzzle, and exact campaign terms before
funding. Base escrow reserves the full reward pool, enforces fixed payouts and
claim limits, and records every payout and refund. This contract is deployed on
Base Sepolia, and this finalized transaction paid 1 test USDC to a fresh,
zero-ETH Coinbase Smart Account with sponsored gas."

### 1:10-1:35 — Insight and why now

"Crossword started years ago from the same insight as Coinbase Earn: learning
and a first onchain reward belong together. That was not just a prototype. The
original NEAR contracts recorded 160 distinct mainnet puzzle solves and 157
successful payouts totaling 2,623 NEAR. Now the larger opportunity is giving any
company that capability with transparent campaign accounting."

### 1:35-1:55 — Why Base and supporting rails

"Base and CDP now make the learner experience simple enough, while smart accounts
and USDC make micropayment distribution practical. Base is the native reward
product. NEAR AI helps turn sponsor source material into drafts for human review,
and x402 gives us a clean way to meter campaign intelligence without touching
the reward principal."

### 1:55-2:15 — Ask and next milestone

"We're applying to Base Batches to turn this working payment path into a
repeatable sponsor product. Our next milestone is one paid design partner, one
mainnet campaign, and at least 100 real completions, then measuring completion
quality, fraud, cost per useful user, and whether the sponsor buys again."

## Final submission checklist

- [ ] Founder video URL is added.
- [x] `crossword.xyz` shows the Base-first product and both demo URLs return 200.
- [x] CDP production domain and Base Sepolia managed Paymaster are configured;
  the production participant and sponsorship gates remain disabled.
- [x] Campaign `3` is parked as immutable acceptance evidence; no retry or
  submission claim depends on recovering its unknown payout attempt.
- [x] Contract and transaction links open without authentication. Public-facing
  links use Base Sepolia Blockscout to avoid BaseScan's embedded-browser check.
- [x] Product stage and traction agree with the dated launch register.
- [ ] Video is 1-5 minutes, publicly viewable, audible, and demonstrates product.
- [ ] Financing and program investment acknowledgements are reviewed carefully.
- [ ] No secret, private sponsor material, learner data, or crossword answer set
  appears in the submission.
- [ ] The final application is reviewed offline before the one-way form entry.
