# Early launch status

Last public-site/config checks: 2026-09-04, America/Los_Angeles (2026-09-05 00:06 UTC).
Last provider checks: 2026-09-04, America/Los_Angeles (2026-09-05 02:44 UTC).
Local setup update: 2026-09-05; no subsequent production change.

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
| L09 | Base accounting and three participant paths locally tested; live acceptance pending | Local Anvil/Postgres now proves publication and three payouts: EOA, deployed ERC-1271 and a synthetic undeployed ERC-6492 recipient. Verification only simulates account creation. Nothing is deployed/configured; the x402 payer is still NEAR. | Prove real fresh Base passkey/sponsored gas (L14) and EVM payments. Review deployment/RPC/code pins, finality, supervised scanner, scale and independent security before activation. |
| L10 | Sponsor/player screens and publication implemented locally | Migration 012 adds approved connected layouts and off-chain publication commitments without changing v1 funded terms. Owner-only binding links existing funding. Withdrawal blocks new completions/allocations and preserves private recovery. All Base gates still default false. | Stage the full journey; add sponsor wallet funding/control, reporting and export. Local browser fixtures do not prove real auth, funding or gas sponsorship. The live release remains unchanged. |
| L11 | Private consent and verified-email persistence locally implemented; policy acceptance pending | Google server sign-in persists verification only for a matching linked subject/email. Optional campaign-scoped contact consent has versioned opt-in/withdrawal and email binding; no export exists. Rewards do not require opt-in. | Complete actual email/OAuth callback acceptance (L05), private sponsor export, retention/deletion and pilot fraud policy. Account/email/wallet control does not prove unique humans or learning; multiple-account and collusion risks remain. |
| L12 | Key and inference accepted; staking linkage unverified | Protected auth control returned 401 for an invalid key and 200 for the supplied key. Successful inference and matching billing records are observed. Intended default organization, staking-credit source, farm/pool/rate, and stake amount/destination remain unverified. | Mike confirms the intended organization's credit source and exact staking setup in R1. A replacement key or extra stake is not required merely to repeat the working call. |
| L13 | Bounded live source drafts passed; broader acceptance open | Gateway GLM 5.1 with documented thinking disabled produced two validated three-entry drafts in 12.1/13.7 seconds; billed costs were $0.0022806/$0.002725. This is the local default only. Earlier GLM 5.3/Qwen timeouts and direct Gemma TLS resets remain unexplained, with failed-request billing unknown. | Engineering follows the [sanitized evaluation record](near-ai-evaluation-2026-09-04.md) for representative source/clue quality, layout, reliability and paid delivery/recovery. Do not equate two synthetic successes with publication readiness or production activation. |
| L14 | Strict proxy local; provider/fresh-wallet acceptance OPEN | Session 8 adds the strict Sepolia/EntryPoint 0.6 proxy and durable allowances. Session 9 prepares a disabled local env and encrypted test deployer with verified recovery and zero observed test balances. CDP Portal remains at sign-in; endpoint, policy and billing are not configured. Managed sponsorship is account-billed, separate from deployer ETH. Facilitator mainnet keys remain untouched. | Mike completes CDP sign-in; engineering follows the Sepolia checklist for the private endpoint, approved billing policy, actual wallet/stub/expiry compatibility, reviewed deployment/code pins, exact transfer approval, fresh zero-ETH passkey, cancellation/recovery, finalized payout and provider bill. Keep production sponsorship disabled. |

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

- 2026-09-05, session 9: Prepared a disabled Base Sepolia `.env.local` in the
  launch-candidate worktree and a dedicated encrypted test-deployer wallet with
  a separate macOS Keychain password. Recovery and independent offline signature
  checks passed; a read-only query observed zero ETH/USDC and nonce/code at block
  46429850. Sponsorship tests 8/8; nonpaying previews 200 and disabled proxy 404.
  CDP Portal is awaiting Mike's sign-in. No endpoint, allowlist, billing cap,
  credit balance or payment method was configured. No credential value was
  printed; no chain transaction, production configuration/migration/deployment,
  AWS change or facilitator-key reuse. See [local setup](base-sepolia-local-setup.md).
- 2026-09-04, session 8: Implemented the local claim-only gas proxy and migration
  013. Unit 254/254, Postgres 51/51, browser 15/15, compiled escrow acceptance 1/1,
  production HTTP/packaging 1/1, lint/typecheck and build pass. Mike approved
  moving toward transfers and requested prior-infrastructure discovery. Inspection
  of the facilitator repo found dedicated mainnet settlement/canary identities,
  not a CDP paymaster setup. EC2 metadata confirms the host is running; secret
  listing was denied and SSH timed out. No key was exposed/reused and no ingress,
  IAM, service, Render setting, production schema or public chain was changed.
  Exact test payer/recipient/refund identities and CDP billing scope remain
  unresolved. See [acceptance checklist](base-sepolia-sponsorship-acceptance.md)
  and chapter 09; do not mark the fresh-wallet funded test complete.
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
- 2026-09-04, session 5: Added subject chapters in `md-CLAUDE-chapters/` and
  contributor maintenance instructions. Implemented the Base RPC reader, additive
  migration 010, canonical/orphan event history, finalized reconciliation and
  issuer-facing health guard. Unit suite 232/232, local Postgres 30/30,
  compiled-contract Anvil/Postgres acceptance 1/1, Base Solidity 29/29, lint,
  typecheck, Node 20 build, immutable install and high-severity full audit pass.
  `BASE_INDEXER_ENABLED` defaults false; the new CLI is one read-only-chain batch,
  not an activated worker or public claim flow. No external provider inference,
  public-chain transaction, production migration, Render configuration or deployment.
- 2026-09-04, session 6: Implemented private participant completion, five-minute
  wallet challenges, durable eligibility, gated EOA signing composition and
  authenticated claim/recovery APIs. Finalized paid receipts match the complete
  allocation and canonical ledger; catch-up/halt never becomes paid status.
  Added optional consent history and linked Google verified-email persistence.
  Unit 238/238, local Postgres 40/40, expanded Anvil/Postgres acceptance 1/1,
  lint/typecheck/Node 20 production build pass. The local EVM proves EOA and deployed
  ERC-1271 participant payouts, not fresh Base Account or sponsored gas. Added
  chapter 06 and updated R4's remaining publication/UI/export/policy work.
  `BASE_PARTICIPANT_ENABLED` and `BASE_CLAIM_ISSUANCE_ENABLED` default false;
  no production key, public-chain transaction, migration, configuration or deployment.
- 2026-09-04, session 7: Added sponsor/player screens, connected-layout review,
  owner-only existing-funding binding and immutable publication/withdrawal.
  Migration 012 leaves v1 funded terms untouched. Existing reward recovery
  survives withdrawal. Gated Base Account adapter and pinned ERC-6492 simulation
  pass local checks; a synthetic factory proves three participant paths on the
  compiled escrow, not a hosted passkey or gas sponsor. Added chapters 07/08 and
  open paymaster item L14. Unit 245/245, Postgres 43/43, local EVM 1/1, production
  HTTP/packaging 1/1, Solidity 29/29 and browser 15/15; lint/typecheck pass.
  Patched transitive Axios; high-severity audits pass. No live keys read, no
  provider/staking/public-chain operations, and no Render/production changes.
