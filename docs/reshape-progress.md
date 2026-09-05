# Reshape session checkpoint

Last implementation session: 2026-09-04, America/Los_Angeles, session 6 after
`8d7404e` (reconciled Base accounting and contributor chapters).

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
  `a373f7e`, followed by `cf560e6`, `6f38ece` and `8d7404e`. Session 6 follows Mike's
  request for participant completion, wallet verification and claim/recovery APIs.
  Subject documentation is maintained in
  [md-CLAUDE-chapters](../md-CLAUDE-chapters/README.md).
- The original `/Users/mikepurvis/other/near-crossword` worktree remains on
  `codex/crossword-campaigns` with pre-existing changes. Do not overwrite it or
  assume it is the launch-candidate branch. Recheck both worktrees next session.
- No merge, push, Render configuration change, production migration, chain
  public-chain transaction, or deployment was performed. The original ignored `.env` was not
  edited or copied. Session 3 applied all nine migrations twice to isolated local
  schemas. Session 5 applied all ten migrations twice to fresh isolated local
  Postgres schemas and tested compiled contracts on disposable loopback Anvil.
  Session 6 applies/replays all eleven migrations and extends the local EVM check
  through real completion/wallet/issuance/receipt recovery. No live key was read.

## Milestone state

| Work | Current state | Still required |
| --- | --- | --- |
| R1 account/credits | Key accepted; live inference and billing records observed | Intended default organization's credit source/staking linkage and exact farm/pool/rate |
| R2a provider adapter | GLM 5.1 non-thinking default passes live bounded SDK/source requests | Representative quality, reliability, layout and cost evaluation; real credit-exhaustion acceptance |
| R2b lesson/source drafts | Two live synthetic drafts validate; private persisted review API implemented | Human quality/layout review, review UI and versioned paid generation orchestration |
| R3a contract design | Implemented locally with shared typed-data fixture | Independent security review and integration review |
| R3b contract/accounting | Pinned RPC, canonical ledger and real participant/issuer composition pass Postgres/compiled-EVM checks | Reviewed deployment/RPC/finality policy, supervised scanner, scale validation, independent security review and live acceptance |
| R4 workflows | Review/approval, persisted completion, EOA/deployed-wallet control, gated claim/recovery, Google email persistence and optional consent locally tested | Publication/layout and sponsor/player UI, funding-binding API, fresh Base Account/sponsored gas, live email acceptance, fraud policy, retention/export |
| R5 Base x402 | Not started | EVM scheme/payer, facilitator configuration, first-wallet and settlement/recovery proof |
| R6 pilot | Gated | Earlier milestones, reviewed release, explicit small budget and identities |

## What landed locally

- `src/server/v2/ai.ts`: shared `NearAiStructuredClient` and `NearAiGenerator`
  through the existing clue interface, with
  the pinned compatible SDK, NEAR-only HTTPS endpoints, disabled redirects,
  30-second total deadline, 4,096 output tokens, and no automatic retries.
- Dedicated `NEAR_AI_API_KEY`, optional `NEAR_AI_BASE_URL`, configurable
  `V2_AI_MODEL`; live-tested local default is `zai-org/GLM-5.1-FP8` with
  `chat_template_kwargs.enable_thinking=false` for this exact model only.
  Other models keep provider reasoning defaults; no automatic failover.
  No Anthropic runtime dependency. Gemma has an advertised direct endpoint but
  direct TLS connections fail from this host; it remains absent from the gateway.
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
  only synthetic material, sanitized outcome/count/usage and safe support/billing
  identifiers, no x402. `scripts/diagnose-near-ai.ts` separates non-inference auth
  and billing checks from one-call bounded chat/stream probes. No raw prompt,
  output, reasoning, credential or provider-error-body logging.
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
- Session 5: `RpcBaseChainReader` verifies native token, deployed code hash,
  chain and deployment anchor; reads state at canonical finalized block hashes.
  Migration 010 and `BaseChainIndexer` store canonical/orphan blocks, immutable
  event logs and reconciled snapshots. Bounded rewind never recycles allocations;
  finalized contradictions and accounting mismatches halt without advancing state.
- `ReconciledBaseChainReader` is the required issuer-facing wrapper: healthy
  ledger within 60 seconds, exact current finalized snapshot and matching pins.
  A fresh RPC result cannot bypass a stale or halted ledger. `base:reconcile`
  runs one explicitly configured read-only-chain batch and defaults disabled.
- Subject chapters cover product boundaries, NEAR AI, Base accounting, private
  review/issuance and operations, with links to authoritative evidence records.
  Contributor instructions require maintaining these chapters alongside code.
- Session 6: migration 011 stores completion against immutable approved terms,
  five-minute SIWE wallet challenges and private eligibility receipts. Ordered
  answers and raw wallet signatures are not stored. Expired/foreign proofs fail;
  identical retries preserve receipt, recipient and allocation. EOA and deployed
  ERC-1271 control use canonical finalized RPC; no counterfactual preparation.
- `/api/base/participants/:id` adds completion, wallet-challenge, claim/recovery
  and separately versioned optional contact consent. Real sessions, same-origin
  mutations, 16-KiB stream limits, strict input and durable rate limits apply.
  `BASE_PARTICIPANT_ENABLED` and `BASE_CLAIM_ISSUANCE_ENABLED` default false.
  The optional dedicated EOA key composes only with the reconciled reader and
  real eligibility verifier; no endpoint sends a chain transaction.
- Paid recovery requires canonical finalized RewardPaid evidence matching the
  entire allocation and contract uniqueness flags. Stale/catching-up/halted
  ledgers fail closed. GET never returns signatures; already-paid POST retries
  return receipts without signing. Unfinalized observations are not paid status.
- The Google server sign-in event now persists verified email only for the
  linked subject and matching email. Email changes clear inherited verification.
  Contact-sharing defaults false, is independently withdrawable, and is tied to
  the consenting email. Actual auth callback, export/retention and fraud-policy
  acceptance remain open. See [chapter 06](../md-CLAUDE-chapters/06-participants-and-recovery.md).

The public AI API still returns the existing topic/tone-based clue pairs. The
source-grounded generator is separate from the paid route; persisted review is
available only through the gated private API. Authenticated Base claim routes and
the real eligibility composition are implemented locally, but remain disabled
and unconfigured in production. There is no deployed issuer key or relayer.
Tests use synthetic source material and keys on local databases/EVM, not live Base.
The payment scheme/browser payer is still
NEAR. The live product has not switched networks or gained multi-recipient claims.

## Verification

Session 6 checks, Node 20.18.3:

- Unit suite **238/238**; Postgres suite **40/40**, adding participant
  proof/HTTP/consent/auth coverage. Details are recorded in [QA](../QA.md). All eleven migrations
  apply/replay on isolated Postgres 16 schemas.
- Expanded compiled-contract acceptance **1/1**: actual completion, EOA and
  deployed ERC-1271 wallet verification, durable issuance/replay, two payments,
  exact finalized receipt recovery and wallet revocation. Original funding,
  rotation/pause/refund/surplus checks remain. The test owns/stops its loopback EVM.
- Lint, standalone typecheck and Next production build pass. No dependencies,
  Solidity/Rust or UI changes; prior Solidity, browser and audit results below
  remain historical, not rerun this session. Real inbox/OAuth callback and fresh
  Base Account/paymaster compatibility are not covered by local API/contract tests.
- One initial test expected immediate recovery during a reorg rewind. It now
  explicitly tests CATCHING_UP denial, then rescans before expecting healthy
  recovery. Production accounting guards were not weakened to satisfy the test.
- No provider calls, funded keys, production migration/configuration, public-chain
  transaction, staking, push or deployment. Default-off launch gates remain off.

Session 5 checks (historical), Node 20.18.3:

- Full unit suite **232/232**; Postgres integration **30/30**, including 11 new
  canonical-ledger/reorg/health-gate cases. All ten migrations apply and replay.
- Compiled-contract acceptance **1/1** using pinned Anvil 1.7.1 and actual
  Postgres: funding, reward, rotation, pause, expiry refund, unallocated surplus
  and duplicate scan reconcile through the same RPC/guard/indexer implementation.
  The test owns and stops its loopback EVM and drops its random database schema.
- Base Solidity suite **29/29**, including 256 fuzz cases and the 8,192-call
  invariant, passes. Solidity sources are unchanged. Existing timestamp and
  synthetic-transfer Forge lint warnings remain documented, not new failures.
- Lint, typecheck, Next production build, immutable install and full high-severity
  dependency audit pass. A standalone typecheck initially overlapped the build's
  generated-file replacement; the sequential repeat passed. Anvil is a new pinned
  dev dependency; the existing nodemailer peer warning remains.
- Browser and Rust checks were not rerun for this backend-only change; previous
  evidence remains historical. The accounting CLI's disabled gate was exercised
  without opening a database/RPC connection. No external inference, public-chain
  transaction, production migration/configuration or deployment occurred.

Session 4 checks (historical):

- Full unit suite **221/221** on Node 20.18.3, including model-specific thinking
  behavior and new diagnostic authentication, redaction, deadline, stream
  completion and missing-billing-record tests. Lint, typecheck and Next production
  build pass on the same Node version.
- Live GLM 5.1 SDK probe and two source drafts passed. The updated app evaluator
  used its ordinary 30-second deadline on Node 20.18.3 and completed in 13.728 s.
  Both drafts' source validation passed; required human review was preserved.
  Observed provider billing was $0.0022806 and $0.002725 for the source drafts.
- No dependency/lockfile, database, contract, frontend or deployed configuration
  changes. Database, Rust/Solidity, browser and audit checks were not rerun in
  session 4; their prior evidence below remains historical.

Session 3 checks (historical) use actual isolated Postgres 16 databases with synthetic chain/
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

See [live NEAR AI observations](near-ai-evaluation-2026-09-04.md) for the working
recipe and the preserved earlier failures. Protected auth and real completions
now rule out a universally invalid key. They do not explain every model/route
failure or establish staking-credit linkage. No paid flag changed. Mike's next
account task is to confirm credit source and exact staking configuration, not to
replace the key or add stake simply to obtain an inference response.

## Start here next session

1. Read this checkpoint, action plan, launch register, and Base design; inspect
   branch/worktree state before editing. Preserve unrelated original-worktree work.
2. Read chapters 03/04/06 and `base-learning-workflow.md`. Build the sponsor review
   and participant UI over the existing private APIs, with a reviewed deterministic
   layout/publication boundary and owner-only funding-binding workflow. Preserve
   funded commitments; layout/policy changes may require a new terms version.
   Keep participant issuance and chain broadcast disabled during implementation.
3. Prove fresh Base Account onboarding, wallet-specific signatures and sponsored
   redemption gas; current support is EOA/deployed ERC-1271 only. Resolve live
   email acceptance, explicit sponsor export/retention and pilot fraud policy.
   Account uniqueness is not human uniqueness. Keep consent optional and private.
   Compose funding and redemption with the existing reconciled reader. Production activation
   still needs reviewed deployment/code/RPC pins, finalized-lag policy and a
   supervised scan cadence. Benchmark the bounded rebuild before large campaigns.
4. Keep the verified GLM 5.1 recipe for representative source/lesson evaluation.
   Human-review clue correctness, factual support and layout viability; measure
   acceptable-draft cost/latency and actual exhaustion before paid activation.
   Mike separately verifies staking-credit linkage and exact farm configuration.
   No broad model sweep, guessed validator/pool or assumed Gemma access is needed.
5. Connect AI generation to private review through a new versioned paid workflow,
   not the old clue cache. Update this checkpoint and the launch register with actual new evidence.
   Do not close R2/R3 on the strength of this session alone.

Account setup does not block local contract or source-draft work. Defer service
activation until live provider and payment checks pass; leave production flags
and existing NEAR claims unchanged while building the new path.
