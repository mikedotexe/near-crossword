# Reshape session checkpoint

Last implementation session: 2026-09-04, America/Los_Angeles, session 2 after
`8f475e3` (NEAR AI adapter and Base design).

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
- Planning baseline: `83d1cb8`; implementation baseline: `8f475e3`. This session
  follows R2b/R3b and Mike's newly supplied NEAR AI key.
- The original `/Users/mikepurvis/other/near-crossword` worktree remains on
  `codex/crossword-campaigns` with pre-existing changes. Do not overwrite it or
  assume it is the launch-candidate branch. Recheck both worktrees next session.
- No merge, push, Render configuration change, migration, chain transaction,
  or production deployment was performed in this session.

## Milestone state

| Work | Current state | Still required |
| --- | --- | --- |
| R1 account/credits | Key supplied locally; live inference not proven | Default organization/credits, exact farm/pool/rate, and a working bounded inference request; see live check record |
| R2a provider adapter | Implemented and locally tested; live calls time out | Live model/schema compatibility, clue quality, latency and usage evaluation |
| R2b lesson/source drafts | Generator, provenance, fixtures, and validation implemented | Live evaluation; persisted human review and versioned paid/API workflow in R4/R5 |
| R3a contract design | Implemented locally with shared typed-data fixture | Independent security review and integration review |
| R3b contract/accounting | Solidity, replay/race/token tests, stateful solvency, event tests pass | Database issuance, event ingestion/reorg recovery, live reconciliation, and deployment acceptance |
| R4 workflows | Not started | Additive DB/API work, eligibility, wallet control, email/consent, sponsor/participant views |
| R5 Base x402 | Not started | EVM scheme/payer, facilitator configuration, first-wallet and settlement/recovery proof |
| R6 pilot | Gated | Earlier milestones, reviewed release, explicit small budget and identities |

## What landed locally

- `src/server/v2/ai.ts`: shared `NearAiStructuredClient` and `NearAiGenerator`
  through the existing clue interface, with
  the pinned compatible SDK, NEAR-only HTTPS endpoints, disabled redirects,
  30-second total deadline, 4,096 output tokens, and no automatic retries.
- Dedicated `NEAR_AI_API_KEY`, optional `NEAR_AI_BASE_URL`, configurable
  `V2_AI_MODEL`; first model candidate is `z-ai/glm-5.3-flash`. No Anthropic
  runtime dependency or fallback. Gemma is absent from the gateway catalog but
  has an advertised direct endpoint; connectivity and model access are unproven.
- Strict exact-count clue output, normalized distinct answers, and rejection
  of malformed, truncated, or unusable drafts. Safe errors for exhausted
  credits, authentication, rate limits, timeout, and upstream failure.
- The existing paid route uses the new adapter. New work checks provider
  readiness before payment verification; saved terminal results can replay
  without a provider/facilitator. Existing generated settlement recovery does
  not regenerate. The x402 kill switch remains in effect.
- `src/server/v2/learning-draft.ts`: bounded pasted-source input, source manifest
  hashes, lesson paragraphs and clues with exact quoted references, unique
  source-backed answers, and mandatory `REQUIRES_REVIEW`. Quotation validation
  does not prove factual support. The generator does not make eligibility decisions.
- [Base escrow](../contract-base/README.md): separately implemented fixed slots,
  recipient-bound EIP-712 claims, campaign participant uniqueness, sponsor
  pause/epoch rotation, post-deadline refunds, and public accounting events.
  Solidity/viem share a digest/signature fixture; no deployment was performed.
- Pinned Forge/OpenZeppelin tooling and forge-std submodule, a dedicated CI job,
  and an exit-code-preserving test launcher. The global Forge is not changed.
- `scripts/evaluate-near-ai.ts`: one opt-in bounded source-draft request using
  only synthetic material, sanitized outcome/count/usage reporting, no x402.

The public AI API still returns the existing topic/tone-based clue pairs. The
source-grounded generator is separate, with no public route or persisted approval
yet. The payment scheme/browser payer is still NEAR. The live product has not
switched networks or gained multi-recipient claims.

## Verification

Automated checks used local/mocked clients and no chain transactions. Separate
bounded live inference attempts are documented below; none delivered a draft.

- Full unit suite: **203/203**, including shared typed data and source drafts,
  passed on deployment-target Node 20.20.2.
- Base suite: **29/29**, including 256 fuzz cases and a stateful invariant with
  128 sequences / 8,192 calls / zero unexpected reverts. Format check passes.
- Desktop/mobile browser regression suite: **8/8**.
- Lint, typecheck, Next production build: passed.
- Production and full dependency audits at the high-severity threshold: passed.
  The broader audit found a pre-existing ESLint `js-yaml` issue; pinning the
  compatible 4.3.1 patch resolved it. Lint and the Node 20 build were rerun.
- Immutable dependency install passed; the existing next-auth/nodemailer peer
  warning remains recorded in [QA](../QA.md) alongside the open live email check.
- Production build passed under Node 20.20.2. No Rust files changed or Rust
  checks reran in this session. Solidity compiles with pinned 0.8.30.

See [live NEAR AI observations](near-ai-evaluation-2026-09-04.md). GLM and a
catalog-ready Qwen model timed out; direct endpoints reset connections; the
older Qwen 3.5 ID returns model-not-found. No successful inference, usage/cost,
or staking-credit linkage is established. No model default or paid flag changed.
Mike has been asked to try a tiny Cloud prompt in the key's organization and
confirm credits. Do not repeat a broad model sweep or assume a larger stake is
the solution before checking that evidence.

## Start here next session

1. Read this checkpoint, action plan, launch register, and Base design; inspect
   branch/worktree state before editing. Preserve unrelated original-worktree work.
2. Initialize the pinned submodule and dependencies, then review the local
   contract/typed-data boundaries. Begin additive, versioned database/API work
   for Base campaigns, one durable allocation per participant/slot, recipient
   ownership, exact-authorization recovery, and canonical event ingestion.
   Do not reuse NEAR payloads or mutate old liabilities implicitly.
3. Connect the source-draft generator to a private sponsor review workflow with
   persisted source/content hashes, reviewer identity, and approval state.
   Define canonical public terms before funding/publication. Use a new paid
   workflow version/idempotency scope for lesson output, not the old clue cache.
4. After the Cloud connectivity/account check, repeat ONE bounded evaluation
   with the dedicated local key. Confirm schema support, valid clues, source
   support, layout, cost/latency, and real exhaustion behavior before paid
   activation. No guessing a validator/pool or assuming advertised Gemma access.
5. Update this checkpoint and the launch register with actual new evidence.
   Do not close R2/R3 on the strength of this session alone.

Account setup does not block local contract or source-draft work. Defer service
activation until live provider and payment checks pass; leave production flags
and existing NEAR claims unchanged while building the new path.
