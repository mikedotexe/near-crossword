# Early launch status

Last checked: 2026-09-04, America/Los_Angeles (2026-09-05 00:06 UTC).

This is the working record for the public launch. Read it before changing launch
configuration. Product possibilities belong in [product discovery](product-discovery.md);
they are not approved implementation work merely because they appear there.
The agreed reshape and its work order are in [the action plan](reshape-action-plan.md).

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
| L03 | Superseded setup; runtime still gated | Direct Anthropic access is being replaced by NEAR AI in the agreed plan. The deployed route still requires `ANTHROPIC_API_KEY`. | Implement R2, including removal of the hard-coded Anthropic prerequisite; do not add a dummy Anthropic key to bypass it. |
| L04 | Optional configuration; flow unverified | Both `ONE_CLICK_JWT` and `ONECLICK_JWT` are absent. Current code treats this as an optional partner token; the public token catalog already worked at launch. | Confirm provider requirements for the intended route and prove quote, funding, payout, and refund behavior. Do not call this broken solely because a JWT is missing. |
| L05 | Partially verified | Resend key and sender are configured; provider discovery returns HTTP 200. | Complete an actual email sign-in, including inbox receipt, production callback, and authenticated session. |
| L06 | Historical proof only | The July 27 private mainnet canary proves direct 0.10 USDC funding, claim, and replay rejection. It used an earlier WASM hash. | Compare deployed contract code with the reviewed release and attach current public-runtime acceptance evidence. See [canary](mainnet-canary-2026-07-27.md). |
| L07 | Unverified | End-to-end cross-chain routes, route-refund recovery, production x402 delivery/replay, audit closure, and operational ownership are not established by the website cutover. | Complete the relevant [runbook](launch-runbook.md) and [QA](../QA.md) items for the chosen product scope; preserve unresolved items if scope changes. |
| L08 | Preserved; reconciliation open | The old contract/application remain accessible. The runbook still records outstanding legacy claims and funds. | Reconcile actual claim/key and balance state before changing legacy access. Historical amounts are not current balance observations. |
| L09 | Agreed direction; integration pending | USDC on Base is selected. Crossword still validates only NEAR x402 networks and uses a NEAR browser payer. | Implement the Base contract and EVM wallet/payment path in R3-R5; changing the URL alone cannot supply this. |
| L10 | Agreed direction; implementation pending | Sponsor-funded learning campaigns with many small rewards are agreed. The live contract still has one winner. | Implement the many-recipient budget/claim contract, eligibility checks, and first small pilot in the action plan. |
| L11 | Product default proposed | Verify email at reward claim; keep contacts off-chain and share only with a separate sponsor opt-in. Email control and payout receipts do not establish unique humans or learning. | Define private contact export, consent records, repeat-claim defenses, and the distinction between public spending evidence and application-reported completions. |
| L12 | NEAR AI account setup pending | Staking-funded inference is publicly documented. Exact live farm configuration requires a signed-in session; public config read returned 401. No stake amount or destination selected. | Mike completes NEAR sign-in, checks default-organization binding and current pool/rate, and supplies a dedicated inference key through secret storage. See R1. |
| L13 | Model evaluation pending | Gemma is absent from the current public catalog. `z-ai/glm-5.3-flash` is the first candidate; catalog readiness is not a successful app inference test. | Run source-grounded clue/lesson evaluation and cost measurement after R1; implement exhaustion handling and preserve x402 delivery/payment guarantees. |

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
