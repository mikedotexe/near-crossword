# Reshape session checkpoint

Last implementation session: 2026-09-04, America/Los_Angeles.

Read this after the [work order](reshape-action-plan.md). It is a continuation
record, not evidence of deployment. Live gates remain in
[early launch status](early-launch-status.md).

## Throughline

Sponsor-funded learning campaigns: short lesson, crossword, a fixed small USDC
reward on Base for each eligible participant up to a prefunded limit. x402 pays
for optional campaign preparation. NEAR AI supplies inference, intended to be
funded by the operator's own staking-derived credits. Reward principal never
funds compute stake. Emails/consent stay private; chain receipts prove payouts,
not unique humans or learning. Manual authoring remains valid.

## Working location

- Worktree: `/Users/mikepurvis/other/near-crossword-launch-candidate`
- Branch: `codex/early-launch-discovery`
- Planning baseline: `83d1cb8`; this session follows its R2/R3 work order.
- The original `/Users/mikepurvis/other/near-crossword` worktree remains on
  `codex/crossword-campaigns` with pre-existing changes. Do not overwrite it or
  assume it is the launch-candidate branch. Recheck both worktrees next session.
- No merge, push, Render configuration change, migration, chain transaction,
  or production deployment was performed in this session.

## Milestone state

| Work | Current state | Still required |
| --- | --- | --- |
| R1 account/credits | Pending Mike's account setup evidence | Default organization, exact farm/pool/rate, chosen stake or other credit source, dedicated key, bounded live inference |
| R2a provider adapter | Implemented and locally tested | Live model/schema compatibility, clue quality, latency and usage evaluation |
| R2b lesson/source drafts | Not started | Source-grounded lesson/clue schema, provenance, author review, validation/evaluation fixtures |
| R3a contract design | Written for implementation | Review against executable contract and typed-data fixtures |
| R3b contract/accounting | Not implemented | Solidity, fuzz/invariant tests, typed-data conformance, event reconciliation |
| R4 workflows | Not started | Additive DB/API work, eligibility, wallet control, email/consent, sponsor/participant views |
| R5 Base x402 | Not started | EVM scheme/payer, facilitator configuration, first-wallet and settlement/recovery proof |
| R6 pilot | Gated | Earlier milestones, reviewed release, explicit small budget and identities |

## What landed locally

- `src/server/v2/ai.ts`: `NearAiGenerator` through the existing interface, with
  the pinned compatible SDK, NEAR-only HTTPS endpoints, disabled redirects,
  30-second total deadline, 4,096 output tokens, and no automatic retries.
- Dedicated `NEAR_AI_API_KEY`, optional `NEAR_AI_BASE_URL`, configurable
  `V2_AI_MODEL`; first model candidate is `z-ai/glm-5.3-flash`. No Anthropic
  runtime dependency or fallback. The public catalog did not list Gemma.
- Strict exact-count clue output, normalized distinct answers, and rejection
  of malformed, truncated, or unusable drafts. Safe errors for exhausted
  credits, authentication, rate limits, timeout, and upstream failure.
- The existing paid route uses the new adapter. New work checks provider
  readiness before payment verification; saved terminal results can replay
  without a provider/facilitator. Existing generated settlement recovery does
  not regenerate. The x402 kill switch remains in effect.
- [Base contract design](base-reward-contract.md): prefunded fixed slots,
  recipient-bound EIP-712 claims, random campaign-scoped participant IDs,
  no slot recycling, sponsor pause/epoch rotation, post-deadline refunds, and
  explicit accounting/trust boundaries. This is a specification, not Solidity.

The AI API still returns the existing topic/tone-based clue pairs. It does not
yet generate a source-grounded lesson. The payment scheme/browser payer is
still NEAR. A provider adapter alone does not make the new Base product usable.

## Verification

All checks used local/mocked clients, no paid inference or chain transactions:

- Focused adapter and payment tests: **48/48**.
- Full unit suite: **178/178**.
- Desktop/mobile browser regression suite: **8/8**.
- Lint, typecheck, Next production build: passed.
- Production dependency audit at the project's high-severity threshold: passed.
- Immutable dependency install passed; the existing next-auth/nodemailer peer
  warning remains recorded in [QA](../QA.md) alongside the open live email check.
- Full unit suite and production build also passed under Node 20.20.2, matching
  the deployment's Node 20 major version; initial checks used Node 24.4.0.
  No Rust files changed or Rust checks reran. No Solidity existed to compile.

## Start here next session

1. Read this checkpoint, action plan, launch register, and Base design; inspect
   branch/worktree state before editing. Preserve unrelated original-worktree work.
2. Implement R3b's local contract and tests in `contract-base/`, using pinned
   Foundry/OpenZeppelin dependencies. Add exact Solidity/TypeScript EIP-712
   fixtures using the existing `viem` dependency. Start with prefunding,
   recipient-bound claims, slot/participant replay, and refund boundaries, then
   stateful solvency/race tests. No funded key is needed for local implementation.
3. Add R2b's source-grounded draft type and fixture-driven generation/validation
   without changing the legacy campaign API implicitly. Keep deterministic
   eligibility separate from AI and human review mandatory before publication.
4. When Mike has supplied NEAR AI account/key evidence through secret storage,
   run a bounded live evaluation. Confirm schema support, reasoning/output
   budget, valid clues, cost/latency, and real credit-exhaustion behavior before
   enabling any paid generation. Do not guess a validator/pool or model ID.
5. Update this checkpoint and the launch register with actual new evidence.
   Do not close R2/R3 on the strength of this session alone.

Account setup does not block local contract or source-draft work. Defer service
activation until live provider and payment checks pass; leave production flags
and existing NEAR claims unchanged while building the new path.
