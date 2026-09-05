# Reshape session checkpoint

Last implementation session: 2026-09-04, America/Los_Angeles, session 3 after
`a373f7e` (Base escrow and source-grounded drafts).

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
- Planning baseline: `83d1cb8`; prior implementation commits: `8f475e3` and
  `a373f7e`. This session follows Mike's approval of durable claim issuance and
  private sponsor review. An app restart interrupted verification; work resumed
  in the same worktree without losing changes.
- The original `/Users/mikepurvis/other/near-crossword` worktree remains on
  `codex/crossword-campaigns` with pre-existing changes. Do not overwrite it or
  assume it is the launch-candidate branch. Recheck both worktrees next session.
- No merge, push, Render configuration change, production migration, chain
  transaction, or deployment was performed. All nine migrations were applied
  twice to isolated local test schemas only, including new migration 009.

## Milestone state

| Work | Current state | Still required |
| --- | --- | --- |
| R1 account/credits | Key supplied locally; live inference not proven | Default organization/credits, exact farm/pool/rate, and a working bounded inference request; see live check record |
| R2a provider adapter | Implemented and locally tested; live calls time out | Live model/schema compatibility, clue quality, latency and usage evaluation |
| R2b lesson/source drafts | Generator/validation plus private persisted review API implemented | Live evaluation, review UI and versioned paid generation orchestration |
| R3a contract design | Implemented locally with shared typed-data fixture | Independent security review and integration review |
| R3b contract/accounting | Solidity tests plus durable DB allocation/signature recovery pass | Production chain/eligibility/signer adapters, event ingestion/reorg recovery, live reconciliation, and deployment acceptance |
| R4 workflows | Private review API and immutable approval/funding boundary locally tested | Sponsor/participant UI, real completion/wallet verification, email path acceptance, consent/retention and export |
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
- Session 3: migration 009 and `src/server/base/` add private revisions/approval,
  source/review hashes and answer-free public terms, a canonical hash fixture,
  verified funding bindings, unique account/slot allocations, and complete
  EIP-712 records persisted before EOA signing. Retries and rotations preserve
  allocations; no recipient changes or recycling. Capacity races run against
  actual Postgres, not a mock repository.
- Private `/api/base/reviews` routes require real sessions, enforce ownership
  and same-origin mutations, and default off via `BASE_REVIEW_ENABLED=false`.
  Approval binds revision plus both commitments. Funding binding freezes edits.
  Private review can use manually authored source-grounded material; no provider
  request or payment is triggered. See [backend workflow](base-learning-workflow.md).

The public AI API still returns the existing topic/tone-based clue pairs. The
source-grounded generator is separate from the paid route; persisted review is
available only through the gated private API. There is no public Base claim
endpoint, deployed issuer key, production chain/eligibility adapter, or relayer.
The test ports use synthetic evidence. The payment scheme/browser payer is still
NEAR. The live product has not switched networks or gained multi-recipient claims.

## Verification

Session 3 checks use actual isolated Postgres 16 databases with synthetic chain/
eligibility ports and public test signer keys. No live inference or chain calls
were performed. Session 2 live inference attempts remain documented below.

- Full unit suite: **209/209**, including bounded adapters, private/public
  commitments and review request guards, passed on Node 20.18.3.
- New Postgres integration suite: **19/19**, including migration replay,
  private HTTP/session authorization, revision races, exact recovery after
  restart/failure, concurrent exhaustion, signer rotation, deadline boundaries,
  and database uniqueness. Also run on Node 20.18.3 with a UTF-8 Postgres target.
- Base suite: **29/29**, including 256 fuzz cases and a stateful invariant with
  128 sequences / 8,192 calls / zero unexpected reverts. Format check passes.
- Desktop/mobile browser regression suite: **8/8**.
- Lint, typecheck, Next production build: passed.
- Dependencies and lockfile unchanged this session. Session 2 immutable install
  and high-severity audits remain historical evidence in [QA](../QA.md), along
  with the existing next-auth/nodemailer peer warning and open live email check.
- Production build passed under Node 20.18.3. No Rust files changed or Rust
  checks reran this session. Solidity remains pinned to 0.8.30.

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
2. Read `base-learning-workflow.md`. Implement the canonical Base funding/payment
   reader and event ledger with deduplication, finality policy, reorg rewind and
   reconciliation. `BaseChainReader` is only a trusted port now, not a production
   implementation. Choose/verify confirmation and freshness policy for the
   deployment; the fixture's block-age setting is not mainnet policy.
3. Build persisted participant completion and wallet challenges bound to the
   frozen revision, authenticated account and recipient. Implement the real
   eligibility verifier and its private audit receipts. Address verified-email
   persistence for Google accounts, consent/retention and abuse policy. Then
   expose an authenticated claim/recovery API and sponsor/participant UI.
   Review layout viability and policy text before treating approval as publishable.
   Keep chain broadcast and public claim issuance disabled until these checks pass.
4. After the Cloud connectivity/account check, repeat ONE bounded evaluation
   with the dedicated local key. Confirm schema support, valid clues, source
   support, layout, cost/latency, and real exhaustion behavior before paid
   activation. No guessing a validator/pool or assuming advertised Gemma access.
5. Connect AI generation to private review through a new versioned paid workflow,
   not the old clue cache. Update this checkpoint and the launch register with actual new evidence.
   Do not close R2/R3 on the strength of this session alone.

Account setup does not block local contract or source-draft work. Defer service
activation until live provider and payment checks pass; leave production flags
and existing NEAR claims unchanged while building the new path.
