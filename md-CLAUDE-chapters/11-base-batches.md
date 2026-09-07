# Base Batches and product narrative

Started 2026-09-07 for Base Batches 004. This chapter keeps the accelerator
story aligned with the product and the evidence. It does not authorize a
submission, production deployment, mainnet transfer, or activation of a paid
flow.

## Product sentence

Crossword turns sponsor budgets into verifiable learning rewards. A sponsor
publishes a short, source-grounded lesson and crossword, prefunds fixed USDC
rewards on Base, and can reconcile every payout and refund against escrow.
Learners enter through email-backed CDP smart accounts and do not need a seed
phrase or ETH.

The crossword is the first proof format, not the boundary of the company. The
commercial product is campaign creation, reward distribution, and accountable
reporting for sponsors.

## Why Base is central

Base is the default reward and accounting network for the new product:

- Sponsor principal is USDC on Base.
- `LearningRewards` enforces funded campaign terms, one-time reward slots,
  payout limits, pauses, signer changes, deadlines, and refunds.
- Participants use Coinbase Developer Platform email authentication and smart
  accounts. A narrowly scoped paymaster sponsors only an approved escrow claim.
- Public contract events provide the independently inspectable part of a
  sponsor report. Completion, email, and optional contact consent remain private.

NEAR AI and x402 support the product without competing with this story. NEAR AI
creates source-grounded drafts for human review. x402 is the intended metering
and payment boundary for campaign intelligence. Neither service holds sponsor
reward principal, authorizes participants, or settles rewards.

## Program fit

[Base Batches 004](https://www.base.org/batches) is an early-stage accelerator
for Base-first companies in trading, payments, agents, financing, and asset
issuance. Applications close September 9, 2026. Selected teams receive a
$100,000 investment offer subject to diligence and join an eight-week virtual
program. This is an investment program, not a grant.

Use **Payments** as the primary category. The payment problem is many small
sponsor-funded transfers with understandable onboarding, exact budget controls,
and credible reporting. Gamified learning is the first use case.

Batch 003 selection emphasized clarity, demonstrated mastery, velocity,
founder-market fit, Base alignment, and traction. The application should
therefore lead with the sponsor problem and show working proof early. Do not
lead with a list of protocols.

## Evidence map

| Application claim | Current evidence | Honest qualifier |
| --- | --- | --- |
| Base-native reward accounting exists | Base Sepolia escrow at `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304` | Testnet; independent review and mainnet deployment remain open |
| A gasless USDC reward can reach a fresh account | Finalized transaction `0x35860a8044d025b6086acbacc02a3f173520b88410fc9338c6267117dc6f1255` | Backend acceptance used a throwaway local Coinbase Smart Account |
| Email-first CDP onboarding works | Fresh email OTP and CDP smart-account creation accepted locally on 2026-09-06 | The same CDP User Wallet has not yet completed the funded claim journey |
| Sponsor review and participant screens exist | Live public synthetic demos plus gated private review/publication implementation | Sponsor funding controls, export, and reporting are incomplete |
| Source-grounded AI drafts work | Two bounded GLM 5.1 drafts passed validation with recorded billing | Representative sponsor quality and paid x402 orchestration remain open |
| Sponsor spend is verifiable | Escrow events, canonical indexer, reconciliation, and finalized recovery are implemented/tested | Chain receipts prove money movement, not unique humans or learning |

## Submission posture

Call the current stage **MVP / Base Sepolia pilot**. Do not call it mainnet,
production reward distribution, revenue, traction, or a finished self-serve
platform unless dated evidence is added first.

The application should use this progression:

1. Sponsors spend meaningful budgets on education and acquisition but receive
   opaque distribution reports and force users through wallet friction.
2. Crossword turns a campaign budget into fixed, prefunded USDC rewards that
   are simple to receive and inspect.
3. The working MVP already proves escrow, a sponsored smart-account payout,
   source-grounded content, private sponsor review, and email-first onboarding.
4. The next milestone is one design-partner campaign with multiple real
   recipients, sponsor reporting, and measured repeat intent.

Avoid these claims:

- "Trustless learning" or "proof that someone learned." The app attests
  eligibility; the contract proves distribution and budget constraints.
- "Thousands of users" or sponsor demand without real data.
- "x402-powered rewards." x402 pays for a separate campaign-intelligence
  service; Base escrow pays participants.
- "No wallet." The learner has a smart account; the product removes wallet
  ceremony and gas requirements.
- "Onchain email leads." Email and consent are deliberately private and
  optional.

## Deadline work

Before submission:

1. Completed September 7: deploy the Base-first public home, practice lesson,
   and non-persisting sponsor demo to `crossword.xyz`; verify desktop/mobile and
   public metadata.
2. Add `https://crossword.xyz` to the intended CDP project's allowed domains and
   configure same-project public/server credentials in Render without enabling
   production sponsorship.
3. Complete the second one-slot Base Sepolia campaign through the CDP User Wallet
   participant path, or preserve the current qualifier if it is not complete.
4. Record real stage, team, traction, financing, location, and contact facts from
   Mike. Never infer them from the repository.
5. Record a 90-120 second founder video with the sponsor problem, product demo,
   Base proof, and next milestone. Use a stable public URL.
6. Review every response in the offline draft, then submit once. The application
   page does not save drafts.

The prepared responses and video script live in
[`docs/base-batches-004-application-draft.md`](../docs/base-batches-004-application-draft.md).

## Decision log

- 2026-09-07: Prepare a Base Batches 004 application. Product quality remains the
  governing goal; accelerator language must follow working evidence.
- 2026-09-07: Use Payments as the primary category and Base as the default reward
  network. Present x402 and NEAR AI as supporting infrastructure.
- 2026-09-07: Keep Crossword as the product name and describe the commercial
  surface as verifiable sponsor-funded learning rewards.
- Open: first design partner, pricing, traction, company/founder facts, financing,
  video URL, mainnet timing, and exact production pilot scope.
