# Early launch status

Last public-site/config checks: 2026-09-04, America/Los_Angeles (2026-09-05 00:06 UTC).
Last provider checks: 2026-09-04, America/Los_Angeles (2026-09-05 02:44 UTC).
Local Base Sepolia setup update: 2026-09-05; no subsequent production change.

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
| L14 | Live Sepolia backend proof included; finality recheck and hosted onboarding open | Sessions 8-14 implement the strict EntryPoint 0.6 proxy, configure a dedicated CDP policy, deploy the escrow and fund one test-USDC campaign. Session 15 shows hosted Base Account connects and reports Sepolia paymaster support but rejects both calls and sub-account creation before our proxy, matching open SDK issue #363. Session 17 separates that product risk from the backend: a fresh local Coinbase Smart Account passed both CDP sponsorship phases and claimed campaign `1` in UserOperation `0x92e56f426be9c882cb8729e269cb1e6d07981b5194872626a80d7f2e65c470ee`, transaction `0x35860a8044d025b6086acbacc02a3f173520b88410fc9338c6267117dc6f1255`. The recipient started with no code, ETH or USDC, remained at zero ETH, received exactly 1 test USDC, consumed slot `0`, and left zero outstanding. After a bounded 20-minute watch, Base's finalized head was block `46450038`, 60 blocks behind the transaction at `46450098`; inclusion is proven but finality remains open. The live envelope also corrected an overly strict parser assumption about CDP's inert precheck flag. Managed sponsorship is account-billed; facilitator mainnet keys remain untouched. | First recheck transaction/event/state at the finalized tag. Keep production sponsorship disabled. Choose the participant onboarding path: retest hosted Base Account after Coinbase fixes Sepolia, adopt a separately reviewed local/embedded smart-account signer, or deliberately approve a tiny Base mainnet hosted-account proof. Then run database-backed issuance/recovery and duplicate/uncertain-outcome acceptance through that exact path. |

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

- 2026-09-05, session 17: Completed the split Base Sepolia backend proof with a
  fresh local Coinbase Smart Account. A preparation-only run reached both CDP
  sponsorship methods; an approved send deployed the account and claimed the
  one-slot campaign with zero recipient ETH. The `RewardPaid` event, 1 test-USDC
  recipient delta, consumed slot and zero outstanding balance were observed.
  Base finality remained 60 blocks behind after a bounded 20-minute watch, so
  finality is retained as an explicit recheck rather than inferred.
  Updated the production response parser for CDP's live inert precheck flag.
  Hosted Base Account onboarding remains separately blocked; all production
  claim and sponsorship gates remain disabled.

- 2026-09-05, session 15: Added a local live sponsored-claim acceptance harness
  and verified campaign `1` is finalized, unclaimed and funded with exactly
  `1000000` atomic native Base Sepolia USDC. The hosted Base Account flow
  connected a fresh zero-ETH/zero-USDC/no-code account and reported Base Sepolia
  paymaster capability, but `wallet_sendCalls` displayed the hosted
  `keys.coinbase.com` unsupported-chain screen before any proxy request reached
  CDP. A follow-up sub-account attempt reached `wallet_addSubAccount` and then
  rejected with code `4001`, again before authorization or CDP. This matches
  [Base Account SDK issue #363](https://github.com/base/account-sdk/issues/363).
  No payout, provider sponsorship request, production setting, mainnet transfer
  or credential print occurred.
- 2026-09-05, session 14: After Mike's explicit approval, created Base Sepolia
  campaign `1` with one 1-test-USDC slot using transaction
  `0x1a1f49f3c06d37c1fe2295ad0188f0e27e78a8b1c0b4636a9e7f0f4175bf6182`
  at block `46444150`. The stale preflight schedule was refreshed before
  signing: starts 2026-09-05 18:31:50 PDT, ends 2026-09-06 00:31:50 PDT,
  claim deadline 2026-09-07 00:31:50 PDT, terms hash
  `0x6f544fbc2b3e1f76ab16fa36aea6b2cd6c76c306bd64a941d91d73968bb01e89`.
  The transaction used 276,149 gas and 0.000001656894 test ETH. On-chain state
  now shows `campaignCount() = 1`, `totalReserved() = 1000000`,
  `outstanding(1) = 1000000`, deployer USDC `0`, escrow USDC `1000000` and
  allowance `0`. Campaign finality, provider sponsorship request, fresh-wallet
  claim, production setting, mainnet transfer and credential print remain open.
  See [campaign result](base-sepolia-campaign-preflight-2026-09-05.md).
- 2026-09-05, session 13: Generated a separate local eligibility signer
  `0xD7F85d32390329cce4e7375d121c912fd3119bF5`, stored its secret only in ignored
  `.env.local` and macOS Keychain, and sent the explicitly approved native Base
  Sepolia USDC approval from deployer to escrow for `1000000` atomic units.
  Transaction
  `0xf472670687b4657841cf4cf7d10c2d5049b26c3e11d0e591f346392f291065f2`
  succeeded at block `46441008`, used 55,437 gas and set allowance to `1000000`.
  Prepared the next `createCampaign` preflight for one 1-test-USDC slot:
  suggested gas 371,660, suggested max cost 0.00000260162 test ETH, starts
  2026-09-05 16:49:54 PDT, terms hash
  `0xcb93af85bf4d58a2377067d03efc3ead972cdc4f344e0b21e9467dd00a535163`.
  Deployment finality was verified; approval finality remained pending. This
  preflight was superseded by the session 14 schedule before sending. No provider
  sponsorship request, fresh-wallet claim, production setting, mainnet transfer
  or credential print. See
  [campaign preflight](base-sepolia-campaign-preflight-2026-09-05.md).
- 2026-09-05, session 12: After Mike's explicit approval, deployed
  `LearningRewards` on Base Sepolia to
  `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304` with transaction
  `0x0419e4a8a2334233cec9272a846f95b77cb35915931e5115599d1c454e6a7a03` at block
  `46440190`. Runtime hash is
  `0xebc5371a9a09231045c01981600b619436374e6226048855a6116d1d0c2dce00`;
  `token()` returns native Base Sepolia USDC and initial state is empty. The tx
  used 1,808,772 gas and 0.000010852632 test ETH. Ignored `.env.local` now has
  non-secret chain pins. CDP Paymaster saved the deployed contract plus selector
  `0x8bd53692`, 10 operations per user and sponsor name `Crossword`. The
  deployment block was not finalized at latest observation. No campaign funding,
  provider sponsorship request, fresh-wallet claim, production setting, mainnet
  transfer or credential print. See
  [deployment record](base-sepolia-deployment-preflight-2026-09-05.md).
- 2026-09-05, session 11: Mike added the CDP endpoint to the ignored local env.
  Engineering validated endpoint shape without printing it, confirmed all local
  gates remain false, and received `0x14a34` from a read-only endpoint chain
  check. Contract build artifacts are current and Base contract tests pass 29/29.
  Deployment preflight for `LearningRewards` with native Base Sepolia USDC
  estimates 1,824,295 gas, suggests 2,239,154 gas and 0.000015674078 test ETH
  max cost, and expects
  `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304` from deployer nonce 0. No signing,
  broadcast, provider paymaster request, allowlist, production setting, mainnet
  transfer or credential print. See
  [deployment preflight](base-sepolia-deployment-preflight-2026-09-05.md).
- 2026-09-05, session 10: Mike completed CDP sign-in. CDP faucet requests funded
  the test deployer with 0.0001 Base Sepolia ETH and 1 native test USDC; public
  RPC verified both balances. Base Sepolia Paymaster configuration is visible and
  shows a private endpoint, enabled testnet paymaster, $1 global/per-user visible
  defaults, 1000 per-user operations and no contract allowlist. The endpoint was
  not persisted because the portal copy did not reach system clipboard; `.env.local`
  remains all-gates-false with an empty endpoint slot. No provider request,
  contract deployment, production setting, mainnet transfer or credential print.
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
