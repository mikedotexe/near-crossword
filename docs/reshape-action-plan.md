# Sponsored learning implementation plan

Agreed direction recorded 2026-09-04. This plan covers the reshape; deployment,
staking, and paid pilot results must be recorded separately in
[early launch status](early-launch-status.md).

Implementation has begun. Read the [session checkpoint](reshape-progress.md)
for completed slices, test evidence, working branch, and next-session order.
The NEAR AI clue/source-draft generators and [Base contract](../contract-base/README.md)
are implemented and locally tested. Live inference attempts have not succeeded;
application integration and deployment remain open. R2 and R3 remain open as
full milestones rather than being closed by isolated code/tests.

## Product and architecture decisions

- Sponsor-funded lessons and crosswords, with a fixed reward for each eligible
  participant up to a prefunded campaign limit.
- USDC on Base is the agreed reward network for the new experience.
- NEAR AI Cloud replaces direct Anthropic access for campaign preparation.
  The operator intends to fund inference credits with its own NEAR stake.
- x402 on Base pays for the optional generation service. Sponsor reward
  principal, platform revenue, inference credits, and operator stake are
  separate balances. Sponsor funds are not staked to finance our inference.
- Participants can try a puzzle before verifying email to claim. Sponsor
  contact sharing is a separate, optional consent. Private participant data
  stays off-chain. The app attests eligibility; the contract enforces payouts.
- AI drafts lesson content and clues from sponsor-supplied source material.
  A human reviews them before publication. AI does not decide whether a
  participant deserves payment.
- The live NEAR contracts and application remain the current production system
  until the new path is implemented and tested. Existing liabilities and old
  claims are not automatically moved to a different chain.

## Work order

Engineering owner below means Codex working with Mike. Mike owns account setup,
stake and pilot budgets, and selection of the initial sponsor. These are planned
work items; none of the milestones are complete merely because this file exists.

| ID | Work | Owner | Depends on | Completion evidence |
| --- | --- | --- | --- | --- |
| R1 | Establish NEAR AI account, inference credit source, and model access | Mike for account/stake; engineering for integration checks | Signed-in Cloud account | Confirmed default organization, exact farm configuration, credits, dedicated API key, and a successful bounded inference request |
| R2 | Replace direct Anthropic generation with NEAR AI | Engineering | Can start now; live test needs R1 | Valid lesson/clue drafts, invalid-output tests, timeouts and credit-exhaustion handling; no Anthropic-key dependency |
| R3 | Build Base campaign escrow and reward accounting | Engineering | Agreed campaign rules and claim policy | Tested prefunding, multiple payouts, one-time claim IDs, exhaustion races, deadlines, refunds, and event reconciliation |
| R4 | Build participant and sponsor workflows | Engineering; Mike reviews content/UX | R3 interfaces; can develop against local fixtures | Sponsor creates/funds campaign; participant learns, solves, verifies email, claims; dashboard and opt-in export reconcile |
| R5 | Connect Base x402 to paid generation | Engineering; Mike controls facilitator client configuration | R2, a Base payer, approved facilitator recipient/client | Unpaid 402, delivered draft and one settlement, unchanged-payment retry, failure/restart recovery, and new-wallet compatibility |
| R6 | Run a small pilot and activate the new product | Joint | R1-R5 and reviewed release | Staging proof, then explicitly scoped mainnet campaign; budget reconciliation, unused-fund return, support/rollback ownership, and sponsor feedback |

R1 account work, R2 provider work, and R3 contract design can proceed in parallel.
The first complete product milestone is one campaign with multiple real reward
recipients and independently inspectable accounting. The illustrative $10,000
campaign is a future business scenario, not the initial pilot budget.

## R1: NEAR AI setup

The [July 30 announcement](https://www.near.ai/blog/staking-for-near-ai) confirms
staking-funded inference. Inference credits accrue from staking yield; agent
hosting has a separate fixed-ratio arrangement. Do not use hosting-tier credit
numbers to size this application's inference stake.

The [Cloud staking terms, Appendix B](https://near.ai/terms-of-service) say
staking rewards are routed to the service, credits accrue under its current
parameters, and unstaking has an unlock process. This is a way to fund usage,
not unlimited inference or simultaneous receipt of the same yield as cash.
Credit exhaustion can interrupt API access.

Setup sequence for Mike:

1. Open [Cloud sign-in](https://cloud.near.ai/signin) and choose **Sign in with
   NEAR**, using the account intended to supply the stake. The current farm
   integration is tied to the NEAR-authenticated user's default organization.
2. Find the Cloud inference staking workflow. Inspect the current network,
   contract/pool, farm product, conversion rate, and withdrawal conditions there.
   Do not substitute a validator chosen from memory or use the agent-hosting
   subscription as if it were the inference product.
3. Choose a stake amount after seeing the actual credit rate and our expected
   generation volume. No amount, payer account, or destination has been selected
   in this task. Mike signs the exact staking transaction in the wallet.
4. Confirm the position is linked and its credits have synced to the same
   default organization. Create the Crossword workspace/key under that
   organization, with a bounded spending limit. A key in a different organization
   may not use the stake's credits.
5. Put the dedicated key in local secret storage as `NEAR_AI_API_KEY`; add it to
   Render when the adapter is ready. Keep the wallet key out of the web service.
   Use the API key for inference; the server does not need staking authority.
6. Run one small request and inspect usage/credit accounting. Use observed cost
   per acceptable draft to size ongoing compute capacity. Record the result,
   model, and cost without logging credentials or unpublished answer material.

Exact pool and rate are **unresolved**. Public
`GET https://cloud-api.near.ai/v1/staking/farm/config` returned HTTP 401 during
this investigation. Its authenticated response contains `network_id`,
`contract_id`, `farm_product_id`, and the reward-to-credit conversion; guessing
these would turn an otherwise verified program into an unverified destination.
An ordinary Cloud inference API key is not a substitute for the session token
required by the farm-management endpoints.

References: [farm configuration](https://docs.near.ai/api-reference/staking-farm/get-staking-farm-configuration.md),
[organization binding](https://docs.near.ai/api-reference/staking-farm/get-organization-staking-farm-state.md),
[credit synchronization](https://docs.near.ai/api-reference/staking-farm/sync-organization-staking-farm-credits.md).

## R2: Provider replacement

The [Cloud quickstart](https://docs.near.ai/cloud/quickstart) documents an
OpenAI-compatible API at `https://cloud-api.near.ai/v1`. Staking funds the credit
balance; an API key still authenticates requests.

Read-only catalog checks on September 4 found 51 entries at
[`/v1/model/list`](https://cloud-api.near.ai/v1/model/list) and no Gemma entry
there or at [`/v1/models`](https://cloud-api.near.ai/v1/models). Do not configure
`gemma4` as an assumed model ID.

First evaluation candidate: `z-ai/glm-5.3-flash`. The catalog lists it as ready,
TEE-hosted, and supporting structured outputs. `deepseek-ai/DeepSeek-V4-Flash`
is a second candidate. The first GLM app request timed out; no candidate has
completed a live app draft yet. The
[model documentation](https://docs.near.ai/cloud/models) distinguishes TEE-hosted
models from third-party proxies; privacy claims must match the chosen model
and actual verification, and do not hide data from our own application.

Session 2 found an advertised Gemma 4 route in the direct-endpoint registry,
despite its absence from the gateway catalog. Direct connections reset from
this host. Mike supplied the local key; key presence is no longer the missing
step, but successful inference and credit linkage remain unverified. See the
[dated evaluation record](near-ai-evaluation-2026-09-04.md) before more live tests.

Configuration implemented in the adapter branch, not yet deployed:

| Variable | Value or purpose |
| --- | --- |
| `NEAR_AI_API_KEY` | Dedicated secret for the credit-bearing Cloud organization |
| `NEAR_AI_BASE_URL` | `https://cloud-api.near.ai/v1` |
| `V2_AI_MODEL` | Initially `z-ai/glm-5.3-flash`; confirm by evaluation |

Provider replacement completed locally in the first implementation session:

- Replaced `AnthropicAiGenerator` with `NearAiGenerator` in
  `src/server/v2/ai.ts` through the existing `AiGenerator` interface. The pinned
  compatible SDK, strict validation, 30-second deadline, and output-token cap
  have injected-client test coverage. Updated the route and removed the old SDK.
- Removed the hard-coded `ANTHROPIC_API_KEY` prerequisite in
  `src/server/v2/x402-ai.ts`; provider readiness now comes from the implementation.
  Cached results can replay without provider/facilitator access while x402 is
  enabled. Saved generated entries remain reusable for settlement recovery.

Source-draft implementation completed locally in session 2:

- Added `NearAiLearningDraftGenerator` with bounded pasted sources, hashed source
  manifests, exact quoted references, strict lesson/answer validation, and an
  unconditional required-review state. Reused the existing provider limits and
  sanitized error handling. Added fixture-driven tests and a bounded evaluator.
- Kept the public topic-only route, payment scope, and cached result shape
  unchanged. Source URLs are references, not automatic fetch targets. The
  generator does not authorize rewards or certify that a cited statement is true.

Remaining R2/R4 integration work:

- Wire source drafts into private authoring with persisted human approval and
  a separately versioned paid workflow. Evaluate clue correctness, layout viability, latency,
  token cost, and retry behavior on representative sponsor material.
- Preserve the existing verification/generation/settlement ordering and durable
  payment identifiers. Provider rejection, exhausted credits, or failed output
  validation must not charge for an undelivered result. Ambiguous settlement
  must resume without a new charge. Never silently fall back to paid Anthropic.

## R3-R5: Base and application changes

Build a separate Solidity campaign escrow using established
[OpenZeppelin primitives](https://docs.openzeppelin.com/contracts/5.x/utilities).
Keep the current Rust contract for its existing campaigns. Pin the Base network
and official native-USDC contract for each environment.

The [first contract specification](base-reward-contract.md) chooses prefunded
fixed reward slots, recipient-bound EIP-712 authorizations, campaign-scoped
participant IDs, no slot recycling, sponsor-controlled pause/signer epochs,
and refunds after the redemption deadline. These rules now have local Solidity,
EOA/ERC-1271 and viem conformance tests, event checks, and stateful solvency tests.
Database issuance, event ingestion/reorg recovery, and independent review remain
before R3 can be considered complete. The application still attests completion and participant
policy; contract receipts cannot prove learning or unique humans.

Reuse the existing Postgres workflow/reconciliation patterns, with additive
schema changes for campaign versions/networks, many participants and rewards,
claim authorizations, consent records, and Base event ingestion. Migrate neither
old claims nor old account balances implicitly. Reconstruct campaign balances
from confirmed chain events and reconcile with the application ledger.

Implement [Base Account](https://docs.base.org/sdks/base-account/overview) or
another compatible onboarding adapter with recipient ownership checks and
sponsored claim gas. Prove the freshly created wallet path, not just a previously
funded wallet. The participant flow needs completion, email verification, payout
pending/confirmed/failed, exhausted-budget, and expired-campaign states. Sponsors
need lesson review, funding, progress, refunds, receipts, and private opt-in export.

For x402, replace NEAR-only resource-server validation and browser signing with
the Base EVM scheme for the new flow. Use `https://base.x402.mikedotexe.com` with
an instance-specific server credential, approved payee, and explicit USDC asset.
Do not use the current NEAR token fallback for Base. The
[facilitator access guide](https://github.com/fastnear/x402-facilitator/blob/main/docs/reference-access.md)
also identifies a fresh-wallet compatibility constraint: deployed smart-wallet
signatures are supported, counterfactual authorizations are not. Resolve that
in the actual payer flow. Base Sepolia contract tests can proceed independently;
our facilitator does not currently expose a public Sepolia instance.

## R6: Evidence required for activation

- Contract tests cover concurrent claims at exhaustion, replay, wrong recipient,
  signature expiry, budget accounting, token failures, and refund boundaries.
- Integration checks cover email/account ownership, consent isolation, duplicate
  attempts, event replay, restarts, and reconciliation after ambiguous effects.
- AI checks cover valid drafts and clear credit exhaustion without incorrect
  x402 settlement. Failed model evaluation does not block manual authoring.
- A staged campaign proves the complete sponsor and learner journeys. A small,
  explicitly scoped mainnet pilot proves actual multiple-recipient payments,
  remaining budget, and returned unused funds before larger sponsor budgets.
- Record rollout/rollback ownership and new flags in the launch register; keep
  legacy access and necessary reconciliation available throughout.

## Deferred from the initial reshape

Any-token sponsor funding, cross-chain winner routing, public self-serve agent
APIs, multiple game formats, and the optional earn-then-spend marketplace can
follow the first working sponsor campaign. Existing related launch gaps remain
documented; they are not marked passed by deferring these features.
