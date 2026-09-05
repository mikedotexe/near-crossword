# Crossword Campaigns v2 acceptance matrix

This matrix separates automated evidence from staging and mainnet gates. A mock
quote, unit test, or rendered page is not settlement evidence.

## Automated on every change

| Area | Required evidence |
| --- | --- |
| Contract | Direct funding, external allocation, duplicate references, wrong amounts, schedules, signature validity, receiver substitution, replay, expired permits, concurrent solvers, failed callbacks, retry, expiry, double-refund prevention, and solvency invariants |
| Workflow API | Authentication, canonical immutable revisions, quote expiry, principal/fee separation, idempotency reuse, duplicate observations, worker retry/restart, reconciliation, and sanitized events |
| Browser | Manual creation, x402 challenge behavior, campaign browsing, mobile play, per-campaign reload recovery, payout selection, private-draft honesty, and legacy access |
| Security | SSRF/private-network blocking, payload limits, rate limiting, secret redaction, unauthorized mutation rejection, answer-field rejection, canonical hash checking, and absence of private keys in logs/local storage |
| Build | ESLint, TypeScript, Next production build, Rust format/clippy/tests, and release WASM |

Run:

```bash
yarn lint
yarn typecheck
yarn audit:production
yarn test:unit
# Set TEST_DATABASE_URL to a disposable local Postgres target, never production.
yarn test:integration:base
yarn test:integration:base-chain
yarn test:browser
cargo fmt --manifest-path contract-v2/Cargo.toml --check
cargo clippy --manifest-path contract-v2/Cargo.toml --locked --all-targets -- -D warnings
yarn test:contract:v2
yarn contract:v2:build
yarn build
# Requires that production build and a disposable TEST_DATABASE_URL.
yarn test:acceptance:base-build
```

## Current local implementation evidence

### Reshape session 7, 2026-09-04

- Unit suite **245/245**, Postgres integration **43/43**, compiled EVM/Postgres
  acceptance **1/1**, and built-production HTTP/packaging acceptance **1/1**.
  Twelve migrations apply/replay on disposable local PostgreSQL 16. No live keys,
  production migrations, public-chain calls or paid inference were used.
- Publication tests cover ownership, same-origin private layout approval, stale
  commitments, revision/funding races, concurrent publication, answer-free public
  fields, withdrawal blocking new completions/allocations, and unchanged recovery
  of existing allocations. Existing v1 funded terms and fixtures are unchanged.
- Real compiled escrow acceptance now pays three recipients: EOA, deployed
  ERC-1271, and a synthetic counterfactual CREATE2 wallet. ERC-6492 verification
  leaves the recipient undeployed. Later deployment and authority revocation are
  checked without falling back to an old key. This is not a hosted Base passkey,
  bundler, CDP or sponsored-gas test.
- Production HTTP acceptance starts/stops its own built Next server, authenticates
  a synthetic database session, exercises actual private layout generation,
  verifies dependency tracing, and asserts both practice routes return 404 even
  with the preview flag set. This check is included in CI after `yarn build`.
- Solidity **29/29**, including 256 fuzz runs and 128 invariant sequences with
  8,192 calls and zero unexpected reverts. Rust was not changed or rerun.
- Immutable install and high-severity production/full-tree audits pass after
  resolving the SDK's transitive Axios 1.16.0 to patched 1.18.1. Existing
  next-auth/nodemailer and transitive peer warnings remain. The real email gate
  remains open; no production mail/provider credentials were read.
- Browser checks found and fixed webpack's rewriting of module resolution for
  the layout source, async consent feedback, review-grid input styling and footer
  contrast. The dependency upgrade initially invalidated a running dev cache;
  checks were restarted against the clean install rather than weakening assertions.
- Browser **15/15** including eight existing regressions; desktop/phone player
  and studio screenshots inspected. Lint and standalone typecheck pass. Production
  build and built-server checks are recorded in the session checkpoint. The secure
  claim-specific paymaster proxy and real fresh-wallet sponsorship remain **OPEN**
  in launch item L14; the browser must not receive a raw keyed CDP URL.

### Reshape session 6, 2026-09-04 (historical)

- Full unit suite **238/238**, Postgres integration **40/40**, expanded compiled
  EVM/Postgres acceptance **1/1**, lint, typecheck and Next production build pass
  on Node 20.18.3. All eleven migrations apply/replay on isolated local Postgres
  16 schemas; no production database or secrets were used.
- Participant tests cover whole-puzzle completion without retained answers,
  revision binding, unverified email, account/campaign/recipient/origin/expiry
  substitutions, wrong signatures, idempotent eligibility receipts, saved-slot
  signing recovery, session isolation, real HTTP completion/challenge/claim flow,
  body limits, cross-site rejection and durable completion rate limits.
- Receipt tests distinguish authorization, unfinalized payment, reorg catch-up,
  finalized matching payment, wrong recipient, orphaned evidence and stale/halted
  accounting. Paid POST recovery needs no new signature. One initial assertion
  expected recovery during CATCHING_UP; the corrected test verifies denial, then
  explicitly rescans replacement history before expecting a healthy result.
- The compiled-contract acceptance now verifies actual EOA and deployed ERC-1271
  wallet signatures, persisted completion/eligibility, issuer replay, two on-chain
  local payouts and exact transaction receipt recovery. Contract-wallet revocation
  invalidates new control proofs without hiding its prior paid receipt. Earlier
  funding, rotation, pause, refund and surplus coverage remains. Anvil and random
  schemas are cleaned up by the harness; the disposable Postgres server is stopped.
- Optional consent defaults off, supports optimistic/idempotent opt-in and
  withdrawal, is isolated by account/campaign, and is suppressed after an email
  change. Google verification tests require the linked subject and matching
  verified email; actual NextAuth adapter tests prove email changes clear inherited
  verification and unrelated updates preserve it.
- No dependency, Solidity, Rust or UI changes. Solidity/browser/audit checks were
  not rerun; their historical evidence below remains separate. No live OAuth or
  inbox acceptance, fresh Base Account onboarding, sponsored gas, funded public
  transaction, provider inference, Render change, staking, push or deployment.
  New participant/signing flags remain default off. See [chapter 06](md-CLAUDE-chapters/06-participants-and-recovery.md)
  for current limits, API shapes and remaining launch gates.

### Reshape session 5, 2026-09-04

- Full unit suite **232/232**, Postgres integration **30/30**, compiled-contract
  RPC/Postgres acceptance **1/1**, Base Solidity **29/29**, lint, typecheck and
  Next production build pass on Node 20.18.3. All ten migrations apply/replay in
  isolated local schemas; no production schema was touched.
- Accounting tests cover deployment/token/code/hash pins, exact finalized reads,
  redacted failures, cancellation, duplicate events, contract/event disagreement,
  canonical replay, concurrent scanners, bounded catch-up/reorgs, retained and
  returning orphan blocks, finalized-history halts, insolvency and issuer health
  gating. Anvil exercises the compiled contract through funding, payout, rotation,
  pause and refund; token donations remain surplus. Synthetic RPC transcript
  tests exercise reorg/finality failure cases not claimed as live Base evidence.
- Pinned Anvil 1.7.1 added as a dev dependency. Immutable install and full
  high-severity audit pass; CI now includes the local EVM integration. The existing
  next-auth/nodemailer peer warning and documented Forge timestamp/test-transfer
  lint warnings remain. No Solidity contract behavior changed.
- A standalone typecheck overlapped Next's regeneration of `.next/types` and
  initially reported missing generated files. The build and sequential typecheck
  repeat pass; no application type workaround was needed.
- Browser and Rust checks were not rerun for this backend-only change. No new
  provider request, public-chain transaction, production migration, Render change,
  funded key, signing configuration or deployment. The opt-in accounting CLI
  rejects its disabled gate before database/RPC access. Production configuration,
  supervised indexing, scale, independent review and live acceptance remain open.
- Implementation subjects and operational recovery are maintained under
  [md-CLAUDE-chapters](md-CLAUDE-chapters/README.md), linked from contributor guidance.

### Reshape session 4, 2026-09-04

- Unit suite **221/221**, lint, typecheck and Next production build pass on
  Node 20.18.3. Added model-specific thinking controls and safe diagnostic tests
  for authentication controls, error/usage redaction, bounded body consumption,
  stream completion and unknown billing records. Existing x402 recovery tests pass.
- The actual local key passes protected authentication. GLM 5.1 with documented
  thinking disabled passes a tiny SDK call and two source-grounded drafts. The
  updated application evaluator completes within its unchanged 30-second limit.
  Numeric usage and matching provider billing records are observed; see the
  [sanitized live record](docs/near-ai-evaluation-2026-09-04.md) for exact values.
- Human clue/factual quality, layout, representative reliability, credit-source/
  staking linkage, cryptographic attestation and paid delivery remain unverified.
  Prior GLM 5.3/Qwen timeouts and Gemma TLS failures have no confirmed root cause;
  failed-request billing remains unknown. No automatic model fallback was added.
- No dependency/lockfile, database, contract or frontend changes. Database,
  browser, Rust/Solidity and dependency audit checks were not rerun; session 3/2
  results below remain historical. No secret-file edit, staking, x402 settlement,
  chain broadcast, Render change or deployment.

### Reshape session 3, 2026-09-04

- Unit suite **209/209** under Node 20.18.3. New tests cover public/private
  commitment boundaries, deterministic JSONB round-trip hashing, mutation
  origin checks, strict inputs and bounded cancellable adapters.
- Postgres integration **19/19**, also repeated with Node 20.18.3 and UTF-8
  Postgres 16. All nine migrations apply and rerun in isolated random schemas.
  Tests cover actual database sessions and private route handlers, approval/
  revision races, duplicate creation, nonowner denial, unique slot/account
  constraints, concurrent exhaustion, signer failures, exact persisted replay,
  rotation, cutoff/grace/expiry, stale/forked state and sanitized errors.
- Base contract regression **29/29**, including 256 fuzz cases and the stateful
  8,192-call solvency invariant. Lint, typecheck and Node 20 production build pass.
- Desktop/mobile browser regression **8/8**. No new frontend was added; the
  private Base route handlers are covered by the database integration suite.
- Chain/eligibility ports are test doubles; signatures use public fixture keys.
  Real wallet ownership, completion, canonical event ingestion and full user
  journeys remain unverified. Review is a gated private API, not a new UI or
  publication. See [workflow](docs/base-learning-workflow.md).
- No dependency/lockfile changes, Rust changes/checks, live provider request,
  chain transaction, production migration, payment, Render change or deployment.

### Reshape session 2, 2026-09-04

Local implementation, not deployment:

- Application unit suite **203/203** under Node 20.20.2. Includes shared Base
  typed-data digest/signature fixtures, source bounds/provenance/approval checks,
  and the unchanged x402 clue-generation recovery tests.
- Base contract suite **29/29**: 28 unit/fuzz tests plus a stateful invariant
  with 128 sequences, 64 calls per sequence (8,192 calls), and zero unexpected
  reverts. Exhaustion fuzzing runs 256 examples. Events reconstruct funding,
  payout and refund facts; chain/domain/recipient/slot/participant/epoch replay,
  ERC-1271, pause, deadline, token failure and reentrancy cases pass.
- Solidity 0.8.30 / Forge 1.7.1 / OpenZeppelin 5.6.1 / forge-std 1.16.2 are
  pinned. Format check and compilation pass. The wrapper's failure propagation
  was checked with an invalid Forge option returning a nonzero exit code.
- Browser regression **8/8** across desktop/mobile Chromium; lint, typecheck,
  production dependency audit, immutable install, and Node 20 production build
  pass. The existing next-auth/nodemailer peer warning remains. Rust unchanged
  and not rerun; the earlier Rust evidence remains historical.
- The full dependency audit (including contract/build dependencies) initially
  found [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj)
  in ESLint's `js-yaml` 4.3.0. A compatible 4.3.1 resolution fixes it; full
  high-severity audit, lint, YAML parsing, and the Node 20 build then passed.
- Source drafts always require review and have no public route/paid workflow
  yet. Quote inclusion is validated, not factual entailment or learning quality.
  Base event tests are not production ingestion/reorg-recovery evidence.
- Live NEAR AI attempts with the supplied local key did not produce a draft.
  See [evaluation results](docs/near-ai-evaluation-2026-09-04.md) for timeouts,
  stale model names, direct-endpoint resets, advertised Gemma 4, and next checks.
  No usage/cost or staking-credit linkage was verified; timed-out calls may have
  consumed provider credits. No x402 settlement, chain transaction, deployment,
  database migration, or Render/production flag change was performed.

### Reshape session 1, 2026-09-04

The separate `codex/early-launch-discovery` branch replaces the direct Anthropic
adapter with NEAR AI. Checks used Node 24.4.0, injected provider/facilitator
clients, and explicit browser mock mode with broadcasting disabled:

- NEAR AI and x402 focused tests: **48/48**, including bounded structured
  requests, exact-count/unique answer validation, truncation, response-body
  deadlines, credit exhaustion, secret-safe errors, no settlement on generation
  failure, and cached-result recovery without provider/facilitator availability.
- Full application unit tests: **178/178**. Browser regression tests: **8/8**
  across desktop and mobile Chromium.
- Lint, typecheck, and Next production build pass. The production dependency
  audit passes the configured high-severity threshold; this is not a claim
  that all transitive low-severity findings have disappeared.
- Repeated the full **178/178** unit suite and production build under Node
  **20.20.2**, matching the deployment's Node 20 major version; both pass.
- Immutable dependency installation passes, with the existing `next-auth`
  peer warning for `nodemailer` 10 versus its requested ^7.0.7. This session
  does not resolve that compatibility warning; actual email sign-in remains L05
  in the [launch register](docs/early-launch-status.md).
- No Rust changes or Rust checks in this session. The Base contract is still
  a [design](docs/base-reward-contract.md), with its own future test matrix.
- No live NEAR AI inference, credit measurement, paid x402 settlement, Base
  deployment, or production configuration change. Source-grounded lesson
  generation is not implemented. Live model compatibility remains unverified.

See the [session checkpoint](docs/reshape-progress.md) for the next work. These
results do not supersede the older chain evidence or close launch gates.

### Historical NEAR v2 baseline, 2026-07-27

Independently rerun on **2026-07-27** with broadcasting disabled and no live
funds:

- ESLint, strict TypeScript, and the Next.js 15.5.21 production build pass.
- Unit tests pass **141/141**, including payment replay, external-funding
  authorization, direct receipt verification, workflow recovery, privacy, and
  solvency checks.
- Browser workflows pass **8/8** across desktop and mobile Chromium. A separate
  in-app review covered the homepage, creator form, mobile menu, crossword
  layout, input, and reload recovery with no console warnings.
- Contract v2 passes formatting, clippy with warnings denied, **30/30** tests,
  doc tests, and the locked release WASM build.
- Migrations `001` through `008` apply cleanly to a fresh Postgres database and
  a second run is idempotent. All 49 constraints and 37 indexes in that
  throwaway schema validate.
- A recursive production dependency audit has no actionable high or critical
  finding. Its remaining entries are an unfixed low-severity `elliptic`
  transitive from NEAR's native secp256k1 stack and a deprecation-only
  `node-domexception` transitive from the AI SDK.

This is implementation evidence, not staging or settlement evidence. The gates
below remain required.

## Staging acceptance

Use a separate v2 testnet contract and a pinned test token. Never point staging
at `crossword.puzzle.near`.

- Create a manual puzzle and verify only its public key and canonical content
  hash reach the API.
- Request direct funding and inspect the exact `ft_transfer_call` receiver,
  amount, tagged message, opening, expiry, and refund account before signing.
- Confirm the ledger observes the final campaign state without a browser being
  left open.
- Publish only after the on-chain reserved amount equals the full prize.
- Complete a direct claim and retain the contract transaction and token receipt.
- Submit two valid proofs concurrently; exactly one may enter the claim path.
- Exercise a failed token callback and confirm the campaign reopens with a new
  nonce.
- Let a campaign expire, invoke permissionless refund, and verify the locked
  creator recovery account receives it.
- Cancel a scheduled campaign before opening and verify its immutable refund
  destination.
- Restart the worker during each external-state wait and verify reconciliation
  continues without duplicate calls.
- Verify contract `total_reserved`, contract token balance, and live ledger
  liabilities agree.

## Mainnet acceptance — explicit approval required

1Click provides no testnet environment. Do not start these checks without human
confirmation of network, asset, exact amount, payer, recipient, recovery
account, and refund address.

### Completed private direct-USDC canary — 2026-07-27

The independent v2 contract was deployed at
`crossword-campaigns-v2.mike.near`. A private 0.100000-USDC campaign was
funded directly, claimed back to its approved `mike.near` recovery account, and
rejected on replay with `ERR_NONCE`. Final contract liabilities and USDC balance
were both zero. The transaction links, release hash, and exact boundary are in
[`docs/mainnet-canary-2026-07-27.md`](docs/mainnet-canary-2026-07-27.md).

This proves only the direct-USDC path below; it does not close the remaining
mainnet gates.

- Fund at least one capped campaign from a non-NEAR origin into v2 USDC escrow.
- Complete one direct NEAR USDC winner payout.
- Complete one cross-chain payout and retain both the contract transfer and
  downstream 1Click settlement receipt.
- Exercise one deliberately expiring/refunding 1Click route and prove funds
  return to the winner-controlled recovery account.
- Make one x402-paid AI generation, retry with the same payment identifier, and
  prove it returns the durable result without a second charge. Link its minimal
  receipt handle to exactly one campaign, reject reuse, and confirm public
  evidence contains only the sanitized identifier/digest/network/reference—not
  prompts, answers, payer identity, authorization, or payment headers.
- Verify the public campaign page labels the prize “Funded and locked” only
  after contract evidence exists.
- Confirm there is no server-funded prize subsidy and no shared balance used to
  “verify” an individual deposit.

## Launch gate

Launch remains blocked until all of the following are attached to a dated
release record:

- Contract audit and reproducible release WASM hash.
- Testnet and approved small-value mainnet transaction hashes.
- Replay, race, expiry, callback failure, and refund evidence.
- Live funding and payout receipts from the flagship cross-chain campaign.
- One x402 generation receipt plus an idempotent replay.
- Accounting reconciliation: reserved contract amount, token balance, and
  workflow liabilities.
- Named NEAR and partner owners, escalation paths, and go/no-go authority.
- Legacy reconciliation for the claim-only keys and funds at
  `crossword.puzzle.near`.
- Upgrade authority transferred to the chosen multisig after beta validation.

## Explicit non-evidence

The illustrative campaign catalog, deterministic adapter results, mock x402
challenge, testnet fixture tokens, green builds, and an open pull request are
useful development evidence. None demonstrates mainnet liquidity, production
settlement, adoption, or partner support.
