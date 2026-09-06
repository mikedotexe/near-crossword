# Reshape session checkpoint

Last setup session: 2026-09-05, America/Los_Angeles, session 14 after
`8a4b951` (finalized deployment check).

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
  `a373f7e`, followed by `cf560e6`, `6f38ece`, `8d7404e`, `f3b9eb3` and `ce9b527`.
  Session 8 follows Mike's request for the claim-only sponsorship proxy and a
  real fresh-wallet test, with general transfer approval. Exact funded identities
  remain unresolved; no public-chain transfer was sent.
  Subject documentation is maintained in
  [md-CLAUDE-chapters](../md-CLAUDE-chapters/README.md).
- Session 9 prepares a disabled `.env.local` in this worktree and a dedicated
  encrypted Base Sepolia deployer outside the repo, with its password in macOS
  Keychain. Offline recovery passed. Session 10 uses the CDP Base Sepolia faucet
  to fund it with 0.0001 test ETH and 1 native test USDC, then opens the Base
  Sepolia Paymaster configuration page. Session 11 validates the private endpoint
  locally with a read-only chain check and prepares the escrow deployment
  preflight. Session 12 deploys the escrow, records the deployment anchor and
  saves a claim-only CDP allowlist. Session 13 configures a separate local
  eligibility signer, prepares the 1-test-USDC approval preflight, and sends the
  approved allowance transaction. Session 14 verifies approval finality,
  recomputes a stale campaign schedule, and creates campaign `1` with exactly
  one 1-test-USDC slot after explicit approval.
  See [local setup](base-sepolia-local-setup.md). The encrypted deployer is not a
  paymaster or fresh participant wallet, and no mainnet funding or
  transaction-specific approval is implied by creating/funding it.
- The original `/Users/mikepurvis/other/near-crossword` worktree remains on
  `codex/crossword-campaigns` with pre-existing changes. Do not overwrite it or
  assume it is the launch-candidate branch. Recheck both worktrees next session.
- No merge, push, Render configuration change, production migration,
  public-chain transaction, or deployment was performed. The original ignored `.env` was not
  edited or copied. Session 3 applied all nine migrations twice to isolated local
  schemas. Session 5 applied all ten migrations twice to fresh isolated local
  Postgres schemas and tested compiled contracts on disposable loopback Anvil.
  Session 6 applies/replays all eleven migrations and extends the local EVM check
  through real completion/wallet/issuance/receipt recovery. Session 7 adds migration
  012 and local publication plus counterfactual verification acceptance. Session
  8 adds migration 013 and local sponsorship tests. Original env names/presence,
  facilitator documentation and AWS metadata were inspected without exposing or
  reusing a key; no app credential value was printed or copied. Remote secret
  listing was denied, SSH timed out, and no cloud/network access was changed.

## Milestone state

| Work | Current state | Still required |
| --- | --- | --- |
| R1 account/credits | Key accepted; live inference and billing records observed | Intended default organization's credit source/staking linkage and exact farm/pool/rate |
| R2a provider adapter | GLM 5.1 non-thinking default passes live bounded SDK/source requests | Representative quality, reliability, layout and cost evaluation; real credit-exhaustion acceptance |
| R2b lesson/source drafts | Two live synthetic drafts validate; private review API and manual editor implemented | Representative quality evaluation and versioned paid generation orchestration |
| R3a contract design | Implemented locally with shared typed-data fixture | Independent security review and integration review |
| R3b contract/accounting | Base Sepolia escrow deployed and deployment finality verified; campaign `1` funded with 1 native test USDC | Finalized campaign verification, reviewed RPC/finality policy, supervised scanner, scale validation, independent security review and live acceptance |
| R4 workflows | Sponsor/player screens, approved publication, claim recovery and strict Sepolia gas proxy implemented locally; disabled local env, funded test deployer, validated CDP endpoint, deployed escrow, claim-only CDP allowlist, local eligibility signer, 1-test-USDC allowance and funded one-slot campaign | Live wire compatibility and fresh passkey/gas acceptance, operator gas recovery, sponsor wallet funding/control/dashboard, live email acceptance, fraud policy, retention/export |
| R5 Base x402 | Not started | EVM scheme/payer, facilitator configuration, first-wallet and settlement/recovery proof |
| R6 pilot | Gated | Earlier milestones, reviewed release, explicit small budget and identities |

## What landed locally

- Session 14: verified the approval block was finalized, refreshed the
  one-slot campaign schedule because the older preflight had gone stale, and
  sent the approved `createCampaign` transaction. Campaign `1` now holds exactly
  `1000000` atomic units of native Base Sepolia USDC in escrow. The deployer has
  0 USDC, escrow allowance is back to 0, and `totalReserved()`/`outstanding(1)`
  both equal `1000000`. Campaign block finality, provider sponsorship and a fresh
  hosted-wallet claim remain open.
- Session 10: CDP faucet funded the test deployer with Base Sepolia ETH/USDC and
  the Paymaster configuration page was inspected. No runtime code, dependency,
  database or contract change. CDP managed sponsorship uses account billing, not
  an ETH-funded seed wallet. Provider endpoint persistence, contract allowlist and
  all live spending/acceptance remain open.
- Session 11: private CDP endpoint presence/shape was validated from the ignored
  local env, then a read-only chain check returned Base Sepolia. The escrow
  deployment preflight computed the expected contract address, runtime code hash
  and gas envelope without signing or broadcasting. Explicit approval is still
  required before deployment. Contract allowlist and live acceptance remain open.
- Session 12: after explicit approval, `LearningRewards` deployed to Base Sepolia
  at the expected address. The ignored local env now records non-secret chain
  pins. CDP Paymaster was saved with one claim-selector allowlist entry and
  tighter 10-operation per-user cap. The deployment block was not finalized at
  the latest observation. No campaign funding or provider sponsorship request
  has occurred.
- Session 13: generated a separate local eligibility signer, stored it in
  ignored `.env.local` and macOS Keychain without printing it, and recorded only
  its public address. Prepared and, after explicit approval, sent the exact
  1-test-USDC approval transaction. Verified deployment finality. Prepared the
  one-slot `createCampaign` preflight. No campaign creation or claim transaction
  was sent.
- Session 8: private sponsorship permits bind a real session to a signed reward;
  the wallet passes a short-lived token in ERC-7677 context. The proxy checks
  exact canonical account/claim calls, pinned code/factory/EntryPoint/paymaster,
  current nonce and current-state claim simulation as well as finalized accounting.
  Gas reservations and provider request identities commit before any external
  signing request. Cache replay cannot recontact CDP; unknown outcomes retain
  budget and block further requests. Mainnet is deliberately unsupported by this
  initial environment profile. See [chapter 09](../md-CLAUDE-chapters/09-claim-sponsorship.md).
- The facilitator investigation found direct settlement gas, not CDP sponsorship.
  Its dedicated mainnet canary/signer must not become Crossword credentials.
  Actual hosted passkey, CDP stub/expiry compatibility, funded identities and
  provider billing remain unverified. The [acceptance checklist](base-sepolia-sponsorship-acceptance.md)
  records the setup and transfer-specific confirmation still needed.
- Session 7: migration 012 approves a validated connected layout separately from
  v1 funded terms, then commits a publication to both hashes. Owner preview,
  layout approval, existing-funding binding, publication and withdrawal APIs
  enforce immutable revisions. No v1 hash fixture or reward principal changes.
- Public `/learn` and `/learn/:id` plus private `/learn/studio` screens now cover
  manual source/lesson/clue editing, terms, approval, solving, email return paths,
  optional consent and finalized receipt recovery. No AI charge or chain funding
  is triggered by editing. Local-only practice/editor previews cannot pay rewards.
- The Base Account browser adapter is gated, checks identity/network and exact
  claims, requires sponsorship, and never falls back to user-paid gas. The chain
  reader can separately verify pinned ERC-6492 account creation via bounded
  simulation. A synthetic local factory proves this without deploying a wallet.
  This is **not** live Base passkey/paymaster acceptance. Session 8 adds the local
  proxy; provider and hosted-wallet acceptance remain open in chapters 08/09.
- Publication withdrawal blocks new completions/allocations, but authenticated
  recovery includes the committed terms needed to redeem a previous allocation
  even when the public lesson no longer exists. No browser receipt is trusted.
- The SDK's transitive Axios 1.16.0 failed a high-severity audit. It is now resolved
  to patched 1.18.1. The crossword library's answer logging is isolated, and its
  source is explicitly included in Next server tracing. New chapters 07/08 record
  the architecture, acceptance evidence and remaining boundaries.

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

Session 14 checks, Node 20.18.3:

- Approval block `46441008` was finalized before campaign creation. The
  recomputed `createCampaign` terms use starts at 2026-09-05 18:31:50 PDT, ends
  at 2026-09-06 00:31:50 PDT, claim deadline 2026-09-07 00:31:50 PDT, and terms
  hash `0x6f544fbc2b3e1f76ab16fa36aea6b2cd6c76c306bd64a941d91d73968bb01e89`.
  Mike explicitly approved the one-slot campaign transaction.
- `createCampaign` transaction
  `0x1a1f49f3c06d37c1fe2295ad0188f0e27e78a8b1c0b4636a9e7f0f4175bf6182`
  succeeded at block `46444150`, block hash
  `0x6f5c4d4435f429d62e0304dc3621231b305db4c67e82a3745c2dbe70d425f66c`, using
  276,149 gas and 0.000001656894 test ETH. Latest/finalized observation was
  `46444426`/`46443973`, so campaign finality remained pending.
- On-chain state: `campaignCount() = 1`, `totalReserved() = 1000000`,
  `outstanding(1) = 1000000`, campaign sponsor
  `0x3Bb5330334D301Cd1976cA025F0eFDEBeeeE7faA`, signer epoch 1, paid count 0,
  refunded 0, not paused and not closed. Deployer USDC is 0, escrow USDC is
  `1000000`, and allowance is 0.
- No provider sponsorship request, fresh hosted-wallet claim, production
  setting, mainnet transfer or credential print.

Session 13 checks, Node 20.18.3:

- Eligibility signer address is
  `0xD7F85d32390329cce4e7375d121c912fd3119bF5`; it has no spending role.
  Approval transaction
  `0xf472670687b4657841cf4cf7d10c2d5049b26c3e11d0e591f346392f291065f2`
  succeeded at block `46441008`, setting escrow allowance to `1000000` atomic
  units. It used 55,437 gas and 0.000000332622 test ETH. `createCampaign`
  preflight for one 1-USDC slot shows nonce 2, 293,050 estimated gas, 371,660
  suggested gas limit, 0.00000260162 test ETH suggested max cost, starts
  2026-09-05 16:49:54 PDT, and terms hash
  `0xcb93af85bf4d58a2377067d03efc3ead972cdc4f344e0b21e9467dd00a535163`.
  Deployment finality was verified at finalized block `46440531`; approval
  finality remained pending. This preflight was superseded by the session 14
  schedule before sending. No campaign creation or claim transaction was sent.

Session 12 checks, Node 20.18.3:

- `yarn test:contract:base` passed 29/29 before deployment. Base Sepolia
  deployment transaction
  `0x0419e4a8a2334233cec9272a846f95b77cb35915931e5115599d1c454e6a7a03`
  succeeded at block `46440190`, deploying
  `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304`. On-chain checks confirm
  `token() = 0x036CbD53842c5426634e7929541eC2318f3dCF7e`,
  `totalReserved() = 0`, `campaignCount() = 0`, code size 7,940 bytes and
  actual runtime hash
  `0xebc5371a9a09231045c01981600b619436374e6226048855a6116d1d0c2dce00`.
  Deployment spent 0.000010852632 test ETH and left the deployer with
  0.000088826683397187 test ETH plus 1 native test USDC. CDP saved the
  `Crossword Claim` allowlist for selector `0x8bd53692`, 10 operations per user
  and sponsor name `Crossword`. Latest/finalized observation was
  `46440324`/`46439633`, so the deployment block was not finalized yet.

Session 11 checks, Node 20.18.3:

- `.env.local` contains a validly shaped CDP Base Sepolia paymaster endpoint,
  with file mode 0600 and all recorded gates false. The private endpoint returned
  `0x14a34` for read-only `eth_chainId`; its value was not printed. Contract
  build artifacts were current, and `yarn test:contract:base` passed 29/29.
  Deployment preflight estimates
  `LearningRewards(0x036CbD53842c5426634e7929541eC2318f3dCF7e)` at 1,824,295 gas,
  suggests a 2,239,154 gas limit and expects
  `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304` from deployer nonce 0.

Session 10 checks, Node 20.18.3:

- CDP Portal accepted Base Sepolia faucet requests for the test deployer. Public
  RPC returned `0.000100000000000000` ETH and `1000000` native test USDC atomic
  units. Paymaster configuration is visible for Base Testnet (Sepolia), with
  Paymaster enabled, $1 global/per-user visible defaults, 1000 per-user
  operations and no contract allowlist. `.env.local` still has all gates false
  and no saved paymaster endpoint.

Session 9 checks, Node 20.18.3:

- Focused sponsorship tests **8/8**. The ignored local env is mode 0600, chain
  84532, with all twelve included gates/review flags false and endpoint/key slots
  empty. Player/editor previews return 200; disabled paymaster POST returns 404.
- Encrypted wallet recovery derives the address and an offline message signature
  independently recovers it with viem. Base Sepolia read-only RPC verifies chain
  84532 and zero ETH/USDC, nonce 0 and no code at block 46429850.
- No provider request, broadcast, funded transaction, production configuration,
  migration or deployment. Full build, browser, database, contract suites and
  audits were not rerun for this local configuration/documentation-only session.

Session 8 checks, Node 20.18.3:

- Unit **254/254**, Postgres **51/51**, compiled escrow/Postgres **1/1**, browser
  **15/15**, built-production HTTP/packaging **1/1**, lint, standalone typecheck
  and production build pass. All thirteen migrations apply/replay on isolated
  PostgreSQL 16 schemas. No contract or dependency change; standalone Solidity/
  Rust suites and audits were not rerun. No public-chain transaction was sent.
- New tests independently cover global and per-recipient caps across campaigns,
  pre-request intent, token/nonce/claim binding, changed chain/account pins,
  current-state simulation, expiry, provider failures, restart replay and
  same-origin session versus wallet-context HTTP boundaries. Production-off
  sponsorship routes deny requests. Actual hosted passkey/CDP acceptance remains
  unverified. See [QA](../QA.md) and the live-test checklist.

Session 7 checks (historical), Node 20.18.3:

- Unit **245/245**, Postgres **43/43**, compiled EVM/Postgres **1/1**, and built
  production HTTP/packaging **1/1**. All twelve migrations apply/replay; owned
  test servers and database are stopped after verification.
- Solidity **29/29**, including fuzz and stateful solvency; immutable install and
  both high-severity dependency audits pass. Rust unchanged/not rerun.
- Browser **15/15** covers practice persistence, anonymous sign-in return, correct
  answer order, separate consent, receipt-only paid state, sponsor approval/layout/
  binding/publication/withdrawal, recovery of withdrawn lessons and mobile overflow.
  Desktop/player/studio and phone screenshots were inspected; browser mocks do
  not prove real provider acceptance. Lint and standalone typecheck pass.
- Production compilation, private runtime layout loading and disabled production
  previews have been verified. The production build check is now in CI. No
  Render/env/live-chain/provider changes were made. Full detail is in [QA](../QA.md).

Session 6 checks (historical), Node 20.18.3:

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
2. Read chapters 07/08/09 and the Sepolia sponsorship acceptance checklist.
   Verify finalization for the deployed escrow, reuse the encrypted test-deployer
   wallet, do not regenerate it, and keep the CDP endpoint private in ignored env
   or a staging secret store. The next approvals are for independent eligibility
   signer setup and a one-slot test campaign. The facilitator's mainnet keys are
   not reusable. Do not change AWS ingress/IAM to recover credentials without
   specific approval. Keep production flags off, and do not relax unknown-outcome
   handling to make retries work.
3. Prove real fresh Base Account/passkey onboarding and sponsored redemption gas
   against the deployed Base Sepolia escrow. Local ERC-6492 simulation and a
   mocked browser provider are not that acceptance evidence. Build sponsor wallet
   create/fund/control and reporting views. Resolve live email acceptance,
   explicit sponsor export/retention and pilot fraud policy. Account uniqueness
   is not human uniqueness. Keep consent optional and private. Compose funding
   and redemption with the existing reconciled reader. Production activation still
   needs finalized deployment/code/RPC pins, reviewed finality policy and a
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
