# Early launch status

Last public-site/config checks: 2026-09-04, America/Los_Angeles (2026-09-05 00:06 UTC).
Last provider checks: 2026-09-04, America/Los_Angeles (2026-09-05 02:44 UTC).
Local implementation update: 2026-09-04; no subsequent production change.

This is the working record for the public launch. Read it before changing launch
configuration. Product possibilities belong in [product discovery](product-discovery.md);
they are not approved implementation work merely because they appear there.
The agreed reshape and its work order are in [the action plan](reshape-action-plan.md).
Multi-session implementation state is in [the checkpoint](reshape-progress.md).

## Current baseline

- `https://crossword.xyz` serves the v2 Render application. The September 4
  release was PR #6, commit `2832260e340ce33cdf08c688a88fad4465a2fbc4`.
- Render service: `crossword-campaigns-v2`, `srv-d9jql9p7lnhs73duc41g`.
- The domain cutover, database migrations, desktop/mobile route checks, and
  automated application/contract checks passed during that release.
- Today's follow-up reads returned HTTP 200 for campaigns (zero published
  campaigns) and email-provider discovery. Those checks do not prove email
  delivery or a completed campaign through the public website.
- The public website is live. Paid AI generation and worker broadcasting are
  not enabled. A complete public funded-campaign launch remains unverified.
- Original app: `https://crossword-mainnet.onrender.com`; legacy access is
  retained through `/legacy`.

## Open register

Every row needs a dated result before its status changes. Owners are unassigned
unless explicitly recorded when the work is taken on. A missing optional
credential is not, by itself, proof that a provider is unusable.

| ID | State | Observation and effect | Next action or evidence |
| --- | --- | --- | --- |
| L01 | Gated | Render has `V2_CHAIN_BROADCAST_ENABLED=false`. Operator account/key variables are absent from the web service. | Decide which campaign workflow to launch; verify a separately configured worker, account, permissions, and recovery procedure before enabling broadcasts. |
| L02 | Gated | `X402_ENABLED`, `X402_FACILITATOR_URL`, `X402_NETWORK`, `X402_PAY_TO`, `X402_ASSET`, and `X402_FACILITATOR_BEARER_TOKEN` are unset in Render. | Choose network, approved recipient, price, and instance-specific credential. Prove unpaid challenge, payment, delivered result, and replay behavior. The asset can fall back to `V2_USDC_CONTRACT_ID` in current code. |
| L03 | Local adapter passes bounded live drafts; production still gated | Engineering replaced direct Anthropic with NEAR AI. Two synthetic source drafts passed through GLM 5.1; the deployed route is unchanged and still requires `ANTHROPIC_API_KEY`. | Engineering completes representative quality/layout evaluation and private review/paid-workflow integration, then reviews deployment. Do not add a dummy Anthropic key or enable paid generation based only on these checks. |
| L04 | Optional configuration; flow unverified | Both `ONE_CLICK_JWT` and `ONECLICK_JWT` are absent. Current code treats this as an optional partner token; the public token catalog already worked at launch. | Confirm provider requirements for the intended route and prove quote, funding, payout, and refund behavior. Do not call this broken solely because a JWT is missing. |
| L05 | Partially verified | Resend key and sender are configured; provider discovery returns HTTP 200. | Complete an actual email sign-in, including inbox receipt, production callback, and authenticated session. |
| L06 | Historical proof only | The July 27 private mainnet canary proves direct 0.10 USDC funding, claim, and replay rejection. It used an earlier WASM hash. | Compare deployed contract code with the reviewed release and attach current public-runtime acceptance evidence. See [canary](mainnet-canary-2026-07-27.md). |
| L07 | Unverified | End-to-end cross-chain routes, route-refund recovery, production x402 delivery/replay, audit closure, and operational ownership are not established by the website cutover. | Complete the relevant [runbook](launch-runbook.md) and [QA](../QA.md) items for the chosen product scope; preserve unresolved items if scope changes. |
| L08 | Preserved; reconciliation open | The old contract/application remain accessible. The runbook still records outstanding legacy claims and funds. | Reconcile actual claim/key and balance state before changing legacy access. Historical amounts are not current balance observations. |
| L09 | Base contract and DB issuer locally tested; live integration pending | Escrow, typed-data helper and durable allocation/signature recovery are implemented, not deployed. The issuer uses injected ports; the browser x402 payer is still NEAR. | Engineering implements production chain/eligibility adapters, canonical event ingestion/reorg handling, and EVM wallet/payment flows in R3-R5. |
| L10 | Private review API and allocation ledger locally tested; public workflow pending | Revision/hash-bound sponsor approval, immutable funded review and concurrency/recovery tests pass against Postgres. `BASE_REVIEW_ENABLED` defaults false. The live contract still has one winner. | Engineering builds review/participant UI, real completion/wallet checks, consent/retention, reconciliation and authenticated claim/recovery routes before a reviewed pilot. |
| L11 | Product default proposed | Verify email at reward claim; keep contacts off-chain and share only with a separate sponsor opt-in. Email control and payout receipts do not establish unique humans or learning. | Define private contact export, consent records, repeat-claim defenses, and the distinction between public spending evidence and application-reported completions. |
| L12 | Key and inference accepted; staking linkage unverified | Protected auth control returned 401 for an invalid key and 200 for the supplied key. Successful inference and matching billing records are observed. Intended default organization, staking-credit source, farm/pool/rate, and stake amount/destination remain unverified. | Mike confirms the intended organization's credit source and exact staking setup in R1. A replacement key or extra stake is not required merely to repeat the working call. |
| L13 | Bounded live source drafts passed; broader acceptance open | Gateway GLM 5.1 with documented thinking disabled produced two validated three-entry drafts in 12.1/13.7 seconds; billed costs were $0.0022806/$0.002725. This is the local default only. Earlier GLM 5.3/Qwen timeouts and direct Gemma TLS resets remain unexplained, with failed-request billing unknown. | Engineering follows the [sanitized evaluation record](near-ai-evaluation-2026-09-04.md) for representative source/clue quality, layout, reliability and paid delivery/recovery. Do not equate two synthetic successes with publication readiness or production activation. |

## Facilitator inventory

Observed read-only on September 4: each instance below returned HTTP 200 from
`/supported` and `/readyz`, with `ready: true`. These are capability/readiness
checks, not new settlement tests.

| Network | Instance | Advertised scheme/version |
| --- | --- | --- |
| NEAR mainnet | `https://x402.mikedotexe.com` | exact, v2 |
| NEAR testnet | `https://test.x402.mikedotexe.com` | exact, v2 |
| Base mainnet | `https://base.x402.mikedotexe.com` | exact, v2; also v1 compatibility |

[Reference access documentation](https://github.com/fastnear/x402-facilitator/blob/main/docs/reference-access.md)
describes Base Sepolia as a software/rollout target, not a live public instance.
Credentials are scoped to individual instances; verification and settlement
require authentication. The current Crossword bearer-token option can carry
that credential. The Base instance supports deployed smart wallets but excludes
undeployed counterfactual wallet authorizations; test the intended onboarding
wallet state before promising first-use compatibility.

## Maintenance habit

1. After each deployment, domain/configuration change, paid-flow test, or product
   decision, update the affected rows and the dated change log in this file.
2. Record what is implemented, configured, enabled, and actually observed as
   separate facts. Local tests and provider readiness do not prove a live user
   journey. Mark old evidence as historical when the relevant implementation changes.
3. Give open items an owner and a concrete next check when starting work. Use
   `deferred` with a reason when a product decision removes an immediate need;
   do not erase the item or silently mark it complete.
4. Store secret names/presence only. Link sanitized receipts and test results;
   never include credentials, payment authorizations, or answer material.
5. During launch check-ins, report meaningful changes and unresolved blockers.
   This file is a manual work log; background monitoring is not configured.

## Change log

- 2026-09-04: Public v2 domain cutover completed; paid/worker activation remained
  gated. Recorded release evidence and outstanding acceptance work separately.
- 2026-09-04: Rechecked Render variable presence, public auth/campaign reads, and
  all three facilitator instances. Corrected the earlier implication that a
  missing optional 1Click JWT necessarily blocks the provider.
- 2026-09-04: Started Base/learning-rewards discovery. No product direction,
  reward model, Base migration, or activation decision has been made.
- 2026-09-04: Mike clarified that Batches fit is optional. Product refinement
  and subtle Base/x402 affinity remain useful even without an application.
- 2026-09-04: Recorded sponsor-funded learning campaigns as the leading
  direction, with proposed fixed USDC rewards, private opt-in contacts, and
  campaign-level accounting. Base is a proposed first network for the new
  experience; production remains NEAR. All existing activation gates remain open.
- 2026-09-04: Mike agreed to USDC on Base and NEAR AI for generation. Added the
  implementation plan and account/model tasks. Anthropic credential setup is
  superseded, while the deployed code and its disabled paid flow are unchanged.
- 2026-09-04: Began authorized R2/R3 implementation in the separate discovery
  worktree. Added the NEAR AI adapter and regression tests, wrote the Base
  fixed-slot escrow specification, and saved the multi-session checkpoint.
  Unit tests 178/178, browser tests 8/8, lint, typecheck, production build, and
  high-severity production dependency audit pass. Unit suite and production
  build also pass on deployment-target Node 20. No live inference, stake,
  settlement, contract deployment, production configuration, or flag change.
- 2026-09-04, session 2: Implemented separate Base Solidity escrow, shared
  TypeScript/Solidity claim fixture, replay/token/refund/event tests and stateful
  solvency checks. Added a source-grounded lesson generator with strict quoted
  provenance and required review, without changing the public paid clue route.
  Unit suite 203/203 and Base suite 29/29 pass; production build passes on Node 20.
  Mike supplied the local NEAR AI key. Bounded live requests did not deliver a
  draft; recorded gateway timeouts, missing older Qwen model, and direct endpoint
  resets, including advertised Gemma 4. Billing for timed-out inference is unknown.
  No staking, chain broadcast, migration, Render configuration, or deployment.
- 2026-09-04, session 2 verification: Browser checks 8/8, lint, typecheck,
  immutable install, and high-severity production/full dependency audits pass.
  Full audit exposed an existing ESLint YAML-parser advisory; pinned the
  compatible `js-yaml` 4.3.1 fix and reran lint and the Node 20 production build.
- 2026-09-04, session 3: Added private Base review API, immutable revision/approval
  records, answer-free public terms commitments, and durable claim allocation/
  EOA authorization recovery. New migration 009 was applied only to temporary
  local Postgres schemas; all nine migrations ran twice. Unit tests 209/209,
  Postgres integration tests 19/19, Base tests 29/29, browser tests 8/8, lint/typecheck and Node 20
  production build pass. Production chain and eligibility ports are intentionally
  unimplemented; no public claim route, configured issuer key or relayer exists.
  No provider call, payment, chain transaction, production migration, deployment,
  Render setting or launch-flag change. See [workflow](base-learning-workflow.md).
- 2026-09-04, session 4: Investigated public GitHub/docs and social search, then
  separated key authentication from model/network behavior. The supplied key
  works; GLM 5.1 with documented thinking disabled passed SDK and source-draft
  checks with matching billing records. Updated the local default without
  increasing app limits or adding fallback. Added safe reproducible diagnostics
  and billing IDs in evaluator output. Unit suite 221/221, lint, typecheck and
  Node 20 production build pass. Staking linkage, representative quality,
  Gemma transport, and paid integration remain open. No secret-file/Render edit,
  chain transaction, migration, production deployment or launch-flag change.
