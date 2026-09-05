# Product discovery

Started 2026-09-04. This notebook records the leading product direction and its
remaining assumptions. It does not authorize production activation or movement
of funds.
Operational facts and launch dependencies live in [early launch status](early-launch-status.md).

## Starting point

Mike wants room to reshape the product, including substantial changes to the
current pivot. The original inspiration was Coinbase Earn: learn something,
answer questions, and receive a small crypto reward. Crosswords, NEAR, x402,
and Base are ingredients to consider, not reasons to preserve every current
product choice. Simplicity of explanation and an enjoyable experience matter.

Mike clarified that the idea may become better without becoming a strong Base
Batches fit. Accelerator acceptance is not the product's success criterion.
A subtle affinity with Base and x402 is welcome; choosing a primary chain or
reshaping the product around the program remains undecided.

The current implementation is sponsor-funded, free to solve, and pays the
first valid solution. It explicitly excludes public first-N rewards. A program
that rewards many learners therefore requires a new eligibility and budget
model; this is not an existing feature waiting on an environment variable.

## External context, checked September 4

- [Base Batches 004](https://www.base.org/batches) closes applications September
  9, 2026. It targets early-stage businesses in trading, payments, agents,
  financing, and asset issuance. Base should be the primary/default network;
  being fully deployed on Base at application time is not required. Selected
  teams receive an investment offer, not a grant. Applying is still undecided.
- [Coinbase Learning Rewards](https://help.coinbase.com/en/coinbase/getting-started/getting-started-with-coinbase/learning-rewards-faq-and-terms)
  ended May 27, 2025. That is useful historical context, not evidence of
  unsatisfied demand, an available partnership, or why the program ended.
- [Base Account](https://docs.base.org/sdks/base-account/overview) offers passkey
  sign-in and USDC payments. It is a possible onboarding component, not an
  integration we have implemented or tested with our facilitator.

Our interpretation: sponsor-funded onboarding and useful small payments could
provide a stronger Batches argument than a standalone prize crossword. Fit
depends on actual customer demand and a credible commitment to Base, not merely
adding a Base payment option or mentioning x402.

## Three possible shapes

| Working concept | Explanation | Who might pay and why | Main uncertainty |
| --- | --- | --- | --- |
| Daily sponsored puzzle | Learn one useful thing through a short daily puzzle and earn a little USDC. | A sponsor pays for thoughtful exposure to a product or topic. | Do people return for the puzzle, and does the sponsor gain anything lasting? |
| Playable product onboarding | Apps turn a first lesson or first useful action into a small rewarded challenge. | An app team pays to help new users understand and use its product. | Is this more effective than ordinary onboarding or existing quests? |
| Earn, then use | Complete a challenge, earn a small balance, and optionally spend some on a genuinely useful service. | A sponsor funds first use; services earn payment for something the learner wants. | Is the service useful enough without an incentive, and does the extra step help? |

The discussion now leans toward sponsor-funded learning campaigns, with a short
crossword as the first format. The daily ritual and optional earn-then-use
experience remain possible extensions. The working brief below supersedes the
earlier equally open comparison of these three concepts.

Candidate one-sentence explanation: "Apps pay people to learn how to use them."
Candidate player promise: "Learn something useful. Earn your first onchain dollars."

For example, a sponsor could fund a bounded USDC pool for a short challenge
about its app. An eligible learner completes it, receives a predetermined small
reward, and gets a useful next action. Eligibility, reward amount, pool limits,
and fee model remain undecided. Participation would remain free under this
hypothesis; a paid follow-on service would be optional.

## Working product brief

**Sponsor-funded learning campaigns with verifiable on-chain rewards.**

Sponsor explanation: "Fund a short learning experience. Reward the people who
complete it. See exactly where your campaign money goes."

Player explanation: "Learn something. Solve a little puzzle. Earn a reward."

Mike's latest contribution makes the paying customer concrete: a sponsor might
allocate $10,000 to a campaign and want the application to manage small rewards
for many participants, show campaign spending, and potentially support email
follow-up. That figure is an illustrative business scenario, not an approved
deposit, launch budget, or validated demand signal.

### Proposed first-version defaults

- Customer: an app or ecosystem team with a specific topic or product to teach.
  Start with a few campaigns we help produce and review personally. Sponsors
  share campaigns with their existing audiences; new-user acquisition is an
  outcome to validate, not reach we can promise today.
- Experience: a short sponsored lesson and an approachable crossword, a known
  reward, clear eligibility, a campaign deadline, and an optional useful next
  action. Keep the crossword as the first format and retain `crossword.xyz`.
- Rewards: a prefunded pool of USDC, a fixed amount per qualifying completion,
  and one reward per eligible participant per campaign. Enforce available
  budget, show exhaustion clearly, and return unused funds under stated rules.
  This replaces the current single-winner model in the proposed new mode.
- Accounts: allow people to try the puzzle first; verify email before claiming
  a reward. This establishes account control, not unique humanity. Exact
  eligibility and repeat-claim defenses still need definition and testing.
- Contact sharing: keep email off-chain. Separate sign-in from an explicit
  optional choice to share an address with the named sponsor for follow-up.
  Do not make marketing opt-in a reward condition in the proposed initial
  version. Export only those opted-in contacts privately; report opt-in counts
  separately from rewarded completions. Do not publish email/wallet mappings
  or plain email hashes on-chain.
- Sponsor view: show funded budget, reserved/pending rewards, confirmed payouts,
  available balance, explicit fees, and refunds, with campaign-linked transaction
  references. Report completions, opted-in contacts, and useful follow-on actions
  separately so a payment is not presented as proof of conversion.
- Business model: initially quote a campaign setup/platform fee separately
  from the reward pool. Validate pricing with the first clients. The service
  includes content setup, campaign operation, reporting, and support.
- Chain: lean toward Base as the first reward network for the new experience,
  subject to an implementation review. Use one settlement network and USDC
  initially. The existing NEAR deployment remains the actual live system;
  Base rewards and a contract migration have not been implemented or approved.
- x402: retain a real paid service role, starting with optional AI-assisted
  campaign preparation; consider an optional purchase with earned funds later.
  Sponsor/agent API access is a later extension, not a requirement for the first
  customer. The reward pool and payout rules remain separate from service fees.

Illustration: a $10,000 reward pool with a $0.50 reward can cover at most 20,000
qualifying payouts, assuming platform fees and transaction costs are separately
budgeted. That is capacity, not a promise of 20,000 distinct people or leads.

### What the proof means

The intended on-chain accounting proves campaign deposits, enforced budget
limits, recipient addresses, payout amounts, and refunds. Application reports
can link each payout to a completion record. They must distinguish that
application assertion from independently verifiable chain evidence.

A payout does not prove that the recipient is a unique human, learned the
material, became a customer, or was not controlled by the operator. A smart
contract checking our eligibility authorization still trusts that authorization.
The product claim should therefore be verifiable fund distribution, with
separately evaluated participant quality, rather than fully trustless learning
or acquisition. If a sponsor needs stronger eligibility guarantees, that is a
specific capability to build and validate.

### Deliberately open

Exact reward size and fee; the first sponsor and lesson; eligibility controls;
wallet onboarding; the Base versus NEAR implementation decision; and how to
reserve rewards during a claim all remain open. We have substantial reusable
payment and recovery components, but the many-recipient contract, participant
quality controls, and Base integration are not solved by the existing canary.
The first funded pilot should be small and separately scoped.

## Where the technology earns its place

- Base could be the default place for accounts and USDC rewards if we choose
  the Base-first direction. The live NEAR contract remains an asset and source
  of working patterns; the future product's escrow design is an open decision.
- The existing x402 design charges a creator for AI clue generation; that route
  is not enabled in production. It could also serve
  a sponsor/agent API or an optional service bought with earned funds, provided
  there is a real buyer and useful output. These are proposed uses.
- [x402 payment verification and settlement](https://docs.x402.org/core-concepts/facilitator)
  do not establish that someone learned, qualifies for a reward, or deserves a
  payout. Reward eligibility and sponsor budget accounting remain our work.
- The shared facilitator has live NEAR and Base instances. Crossword itself
  is currently NEAR-only for x402. Base support requires application work.
- Cross-chain routing can be reconsidered after choosing the first audience;
  it does not have to be part of the first experience to justify earlier work.

## Earlier discovery questions

1. What should bring someone here: a daily puzzle they enjoy, or an app they
   want to understand? Is the crossword the enduring product or the first format?
2. What outcome will a sponsor pay for: attention, understanding, first useful
   use, or continued use? Which first sponsor can we actually learn from?
3. Who earns: one fastest solver, a bounded group of eligible learners, or
   people completing a specific useful action? What happens when funds run out?
4. How do we limit answer sharing and repeat-account farming without making
   tiny rewards cumbersome? A correct answer, wallet, or AI-resistant-looking
   puzzle is not proof of a unique person or learning.
5. Would we choose Base as the default even without the accelerator? What
   evidence would make us pursue, revise, or drop this direction?

## Small discovery experiment, still proposed

Make one short, manually authored challenge for one willing app team and a
small invited group. First test whether the lesson and next action make sense
without rebuilding the platform. A funded pilot would need its own agreed
reward rules and implementation. Measure understanding, useful follow-on use,
repeat participation, duplicate claims, sponsor willingness to pay again, and
total cost per retained user. Completion counts alone cannot establish demand.

## Decisions

- 2026-09-04: Adopt an exploratory posture and keep a dated launch register.
- 2026-09-04: Treat Batches as an optional opportunity. Continue exploring
  light Base/x402 affinity without making accelerator fit a product requirement.
- 2026-09-04: Leading direction is sponsor-funded learning campaigns with many
  small rewards and verifiable campaign accounting. Mike identifies campaign
  sponsors as potential clients and raises private email follow-up as a useful
  capability. Record the defaults above as recommendations to iterate from.
- Open: first sponsor, price, eligibility, wallet experience, final network and
  contract choice, paid-service scope, and whether to apply to Batches 004.
  No application submitted or new product flow activated.
