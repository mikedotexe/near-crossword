# Product discovery

Started 2026-09-04. This is a discussion notebook, not an approved roadmap.
Operational facts and launch dependencies live in [early launch status](early-launch-status.md).

## Starting point

Mike wants room to reshape the product, including substantial changes to the
current pivot. The original inspiration was Coinbase Earn: learn something,
answer questions, and receive a small crypto reward. Crosswords, NEAR, x402,
and Base are ingredients to consider, not reasons to preserve every current
product choice. Simplicity of explanation and an enjoyable experience matter.

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

Current assistant hypothesis, not a team decision: begin by exploring playable
product onboarding, with a short crossword as the first format. Keep a daily
ritual and an optional earn-then-use experience available as directions to test.

Candidate one-sentence explanation: "Apps pay people to learn how to use them."
Candidate player promise: "Learn something useful. Earn your first onchain dollars."

For example, a sponsor could fund a bounded USDC pool for a short challenge
about its app. An eligible learner completes it, receives a predetermined small
reward, and gets a useful next action. Eligibility, reward amount, pool limits,
and fee model remain undecided. Participation would remain free under this
hypothesis; a paid follow-on service would be optional.

## Where the technology earns its place

- Base could be the default place for accounts and USDC rewards if we choose
  the Base-first direction. The live NEAR contract remains an asset and source
  of working patterns; the future product's escrow design is an open decision.
- x402 currently charges a creator for AI clue generation. It could also serve
  a sponsor/agent API or an optional service bought with earned funds, provided
  there is a real buyer and useful output. These are proposed uses.
- [x402 payment verification and settlement](https://docs.x402.org/core-concepts/facilitator)
  do not establish that someone learned, qualifies for a reward, or deserves a
  payout. Reward eligibility and sponsor budget accounting remain our work.
- The shared facilitator has live NEAR and Base instances. Crossword itself
  is currently NEAR-only for x402. Base support requires application work.
- Cross-chain routing can be reconsidered after choosing the first audience;
  it does not have to be part of the first experience to justify earlier work.

## Questions to explore

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
- Open: primary audience, Base commitment, reward model, paid service, sponsor,
  business model, and whether to apply to Batches 004. No application submitted.
