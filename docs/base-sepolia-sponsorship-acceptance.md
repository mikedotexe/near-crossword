# Base Sepolia sponsorship acceptance

Status: Base Sepolia escrow, paymaster and one-slot sponsored claim are finalized,
updated 2026-09-07. Hosted Base Account onboarding was rejected upstream, so the
selected participant path is now CDP User Wallet email OTP plus smart accounts.
CDP faucet transfers funded the test deployer on Base Sepolia. Local proofs are in
[QA](../QA.md); architecture is in [chapter 09](../md-CLAUDE-chapters/09-claim-sponsorship.md).
Session 9 adds an encrypted test-deployer wallet and disabled local env profile;
see [local setup and recovery](base-sepolia-local-setup.md). Session 10 confirms
0.0001 test ETH and 1 native test USDC balances. CDP sign-in is complete and the
private endpoint was read-only checked as Base Sepolia. Session 12 deployed the escrow and
saved a claim-only CDP allowlist. Session 13 configured a separate eligibility
signer and sent the exact 1-test-USDC approval after explicit approval. Session
14 verified approval finality, recomputed the stale campaign schedule and created
campaign `1` after explicit approval. Session 17 used a fresh local Coinbase Smart
Account to claim it with CDP-sponsored gas. Session 18 verified that transaction,
event and resulting state at the finalized tag. Managed CDP sponsorship is
account-billed, not an ETH deposit into this separate deployment wallet.

## Existing infrastructure investigation

Mike approved moving toward transfers and asked us to inspect
`/Users/mikepurvis/near/fn/x402-near-facilitator` and AWS for prior setup.
Read-only inspection found:

- The facilitator uses a funded settlement signer, not an ERC-7677 CDP paymaster.
  Its recorded canary payer is dedicated to mainnet x402. These identities must
  not be reused as Crossword sponsor, deployer, eligibility signer or paymaster.
- No CDP/paymaster configuration was found in the inspected repository. Its
  Sepolia config is a software profile, not evidence of a live Sepolia service.
- CDP now shows the current project's Base Sepolia Paymaster page with a private
  endpoint. The endpoint is persisted only in ignored local/staging env. After
  escrow deployment, CDP accepted a `Crossword Claim` allowlist entry for
  contract `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304` and selector
  `0x8bd53692`.
- The existing AWS CLI identity is the `for-easy-dns` IAM user. EC2 confirms the
  recorded facilitator instance is running at its recorded address.
  `secretsmanager:ListSecrets` is denied, and SSH to the configured facilitator
  host timed out. No credential contents, remote files or current host policy
  could be inspected. No IAM, security group, service or database was changed.
- Local Crossword environment inspection reported names/presence only. No
  Base/CDP paymaster endpoint was present. The original ignored `.env` was not
  edited/copied and no facilitator signing key was opened or reused.

The earlier facilitator's gas payments are not evidence that a CDP account
exists. A dedicated Crossword paymaster configuration remains required.

## Mike: provider and test identities

1. In [CDP Portal](https://portal.cdp.coinbase.com), use the current project or a
   dedicated Crossword project and choose Paymaster under Onchain Tools,
   **Base Sepolia**. Keep its private endpoint only in
   `BASE_PAYMASTER_UPSTREAM_URL` in the launch-candidate worktree's ignored
   `.env.local` or the intended staging secret store. The original repo is a
   different branch. Never paste the endpoint in chat or put it in the public
   `BASE_SPONSORED_CLAIM_PROXY_URL` variable.
2. CDP now has a deny-by-default contract/function allowlist for the deployed
   Crossword escrow's `claim` selector. Review factory/account creation support
   and per-operation, per-address and total billing caps again before any
   sponsored request. Do not allow arbitrary calls to the factory or all methods
   just to pass a wallet prompt.
3. A dedicated encrypted Base Sepolia deployer wallet is now recorded in
   [local setup](base-sepolia-local-setup.md). Confirm its sponsor/refund role
   for the exact campaign, separately from the fresh participant and server eligibility signer.
   Never put a sponsor/deployer key into the web service. Use test-only faucet
   funds; no bridge or mainnet purchase is required for this test. Current
   observed balances after campaign creation are 0.000086822276296911 test ETH
   and 0 native test USDC.
4. The USDC approval is complete:
   `0xf472670687b4657841cf4cf7d10c2d5049b26c3e11d0e591f346392f291065f2`.
   Campaign `1` is funded with exactly one 1-test-USDC slot by
   `createCampaign` transaction
   `0x1a1f49f3c06d37c1fe2295ad0188f0e27e78a8b1c0b4636a9e7f0f4175bf6182`.
   Escrow allowance is back to zero and `outstanding(1) = 1000000`. See
   [campaign preflight and result](base-sepolia-campaign-preflight-2026-09-05.md).
   No mainnet funds.

## Engineering: staging and no-spend checks

1. Escrow deployment is complete on chain 84532 with native test USDC
   `0x036CbD53842c5426634e7929541eC2318f3dCF7e`: contract
   `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304`, transaction
   `0x0419e4a8a2334233cec9272a846f95b77cb35915931e5115599d1c454e6a7a03`,
   block `46440190`, now finalized with matching code hash. Campaign `1` was
   funded at block `46444150` and its sponsored claim at block `46450098` is
   finalized with matching event and state. See
   [the 2026-09-05 deployment record](base-sepolia-deployment-preflight-2026-09-05.md).
2. Record deployment anchor/code hash and independently verify RPC chain, token,
   canonical history and finality policy. Configure an isolated staging Postgres
   target, migrations through 013 and a supervised healthy scanner. Do not point
   the staging process at the production NEAR database by accident.
3. Eligibility signer is configured locally as
   `0xD7F85d32390329cce4e7375d121c912fd3119bF5`; its secret is in ignored local
   env and Keychain, not chat. Use a credential-free HTTPS staging URL for the proxy, reachable by the hosted
   wallet. Verify the real email callback/session. Configure the independent
   account/factory/proxy/EntryPoint/paymaster pins. The current proxy explicitly
   supports EntryPoint 0.6 only.
4. Prove an unauthenticated/invalid-token request cannot reach CDP, no private
   URL/token is present in logs or client configuration, and the wallet forwards
   ERC-7677 context. Inspect only sanitized method/version/selector/size facts;
   do not capture private passkey material, signatures, tokens or raw payloads.
5. Review CDP's actual stub and final response format and expiry before activating
   the UI. The local decoder accepts only the pinned Coinbase v1.0.0 packed
   format with no token charges and finite validity inside the permit. Provider
   differences must be explicitly reviewed and tested, not passed through.

## Funded acceptance and evidence

1. Sponsor creates/approves the lesson and layout. Confirm exact chain, USDC
   atomic amount, payer, escrow recipient, signer, gas bound and refund address
   immediately before each funded step. One 1-USDC slot is now prefunded; never
   top up from an operator reserve to mask a shortfall. Link and publish only
   after finalized accounting matches reviewed terms.
2. Start a genuinely fresh CDP User Wallet email-OTP session and let CDP create
   its smart account. Record only the public recipient, zero ETH, code/nonce state
   and supported EntryPoint before the flow. No EOA fixture may substitute.
3. Solve, verify email, prove wallet control and receive the exact claim/permit.
   Exercise rejection before send. A provider-requested cancellation may retain
   an allowance and need reconciliation; do not promise automatic retries.
4. Authorize one sponsored claim with the exact recipient/amount/escrow and the
   approved CDP ceiling. Record wallet operation ID, canonical transaction,
   exact finalized `RewardPaid`, recipient USDC delta and EntryPoint paymaster/
   gas receipt. Only finalized server recovery changes the reward to paid.
5. Verify the designated paymaster actually paid, inspect the provider bill/cost
   including any extra fees, and confirm the participant did not pay gas. The
   sponsorship capability alone does not prove which paymaster was used.
6. Prove duplicate requests cannot spend twice; test account/network changes,
   lost wallet response and lost provider response. Reconcile uncertain rows by
   original operation/nonce and provider evidence. Never regenerate transactions
   or release allowances based only on a timeout or a browser-reported failure.
7. Reconcile campaign funding/payout/refund and separate gas allowance/provider
   bill. Disable the pilot gates and review evidence before any mainnet proposal.

## Session 15 live harness checkpoint

`scripts/base-sepolia-sponsored-claim-acceptance.ts` is the current controlled
acceptance tool. It runs a local page on `127.0.0.1:3125`, creates a randomized
Cloudflare Tunnel paymaster route, keeps `/authorize` local-only, and writes a
sanitized JSON evidence file in `/tmp`. It is designed to prove Base Account +
CDP paymaster compatibility for the already funded one-slot campaign without
turning on production participant or claim issuance gates.

Observed before the current retry: campaign `1` was finalized, unclaimed and
still had `outstanding(1) = 1000000`; recipient
`0xec237B5F036850221e45c1bD634ed4835983933B` had 0 ETH, 0 USDC and no deployed
code; Base Account was on `0x14a34` and reported `paymasterService` support for
Base Sepolia. The claim click failed before any paymaster request hit the proxy:
the hosted `keys.coinbase.com` popup displayed "This chain is not supported" for
Base Sepolia and the page saw a wallet rejection. The harness now logs sanitized
wallet errors, records capability chain keys, uses the Base docs-style
`wallet_sendCalls` `version: "1.0"` shape, and passes only
`paymasterService.url`; the one-use authorization permit is embedded in the
randomized proxy path rather than relying on a wallet-forwarded `context` field.
The next retry used the Base Account SDK sub-account mode with `creation:
"on-connect"`, `defaultAccount: "sub"` and `funding: "manual"` so the actual
claim would be built through the Base Sepolia sub-account signer rather than the
universal account popup. It still failed before authorization: `eth_requestAccounts`
returned the same hosted account, then `wallet_addSubAccount` rejected with code
`4001` before any proxy request reached CDP. This matches the currently open
`base/account-sdk` issue
[#363](https://github.com/base/account-sdk/issues/363), which reports newly
created Base Accounts connecting and reporting Base Sepolia capabilities while
transaction requests are rejected by the hosted keys flow. Treat hosted Base
Account Sepolia claim acceptance as blocked by upstream behavior until Coinbase
ships a fix, provides an ERC-4337-preserving account path, or we use an older
compatible hosted account. Do not generalize this to production until a real
proxy request, CDP paymaster response, included transaction, finalized
`RewardPaid`, recipient USDC delta and zero participant gas cost are all observed.

## Session 16 reassessment

The recommendation is to split the remaining proof:

1. Keep the hosted Base Account finding as a product/onboarding risk, not a local
   claim-security defect. Base mainnet may work, but proving that requires a
   separate tiny mainnet deployment/funding decision.
2. Prove the escrow, EntryPoint 0.6, Coinbase Smart Wallet factory and CDP
   paymaster proxy on Base Sepolia with a local throwaway owner using viem's
   `toCoinbaseSmartAccount`, if CDP accepts that path. This does not prove hosted
   Base Account onboarding, but it does prove the backend sponsorship policy and
   campaign accounting.
3. Keep the production claim/sponsorship gates disabled until either the hosted
   Base Account path works on the target network or the product explicitly uses a
   different smart-account onboarding path.

## Session 17 local smart-account proof

The split backend proof succeeded on 2026-09-05. The acceptance harness now has
an explicit preparation-only local mode and a separate send mode. Each creates a
fresh Coinbase Smart Account v1.1 with an owner credential held only in process
memory. It reuses the strict local claim/paymaster validation and talks to the
private CDP endpoint as the combined bundler and paymaster. No credential or raw
wallet/paymaster payload is written to evidence.

The preparation-only pass validated the canonical v1.1 factory prediction,
EntryPoint 0.6, exact single escrow claim, both ERC-7677 paymaster methods and
the official CDP v0.6 paymaster/code hash. Live CDP envelopes set
`precheckBalance` while the payment token remains zero. The deployed v1.0.0
paymaster only enters token logic when that token is nonzero, so the production
parser and fixture now enforce the token/receiver/exchange-rate region instead
of rejecting the inert flag.

The approved send then succeeded:

- UserOperation:
  `0x92e56f426be9c882cb8729e269cb1e6d07981b5194872626a80d7f2e65c470ee`
- Transaction:
  `0x35860a8044d025b6086acbacc02a3f173520b88410fc9338c6267117dc6f1255`
- Fresh recipient: `0xb4afC958555F64A03944DFaC696c447179ea2348`
- Recipient before: 0 ETH, 0 USDC, no code
- Recipient after inclusion: 0 ETH, 1 test USDC, deployed code
- Campaign after inclusion: slot `0` used, `outstanding(1) = 0`
- CDP paymaster: `0x709A4bae3DB73a8E717AEfca13E88512f738b27f`
- Paymaster code hash:
  `0x4cf2309390afafca14fdedb734f3adee5abe21e0d27f27a36fa5b4f46712b97c`

The in-memory owner was deliberately discarded, making the received test USDC
unrecoverable. At the end of the bounded 20-minute confirmation window, Base's
finalized head was block `46450038`, 60 blocks behind the claim at `46450098`.
This result initially proved inclusion through the
escrow/EntryPoint/CDP sponsorship and accounting path; hosted Base Account/
passkey onboarding remains a separate upstream blocker, and every production
gate remains disabled.

## Session 18 finality and participant decision

On 2026-09-06, Base's finalized head was `46480230`, well beyond claim block
`46450098`. A finalized-tag recheck confirmed the successful transaction receipt,
deployed recipient code, `1000000` atomic test USDC at the recipient, used slot
`0`, and `outstanding(1) = 0`. The backend sponsored-claim proof is final.

The participant product decision is CDP User Wallet, not the hosted Base Account
SDK path. The browser now uses CDP email OTP, requests a smart account at login,
signs the existing campaign-specific wallet challenge, and submits the exact
claim through CDP's UserOperation hook with the reviewed proxy URL and private
permit context. The server validates the CDP access token with a Secret API Key,
checks that the requested recipient belongs to that end user, links the verified
email into the existing user tables and mints a 14-minute database session. It
does not store the CDP access token. Sponsor authentication remains unchanged.

The next live acceptance needs a CDP project ID, same-project server Secret API
Key and exact local/staging origin allowlist. It must cover email OTP, smart-account
creation, ERC-6492 wallet proof compatibility, database issuance, sponsored
submission, finalized receipt recovery, duplicate handling and provider cost.
Production gates remain disabled until that pass is recorded.

## Session 24 database-backed CDP User Wallet result

Campaign `3` completed the participant path through email OTP, smart-account
ownership proof, lesson completion, optional contact consent, slot allocation and
signed reward authorization. The consent checkbox briefly displayed a Base
accounting error because the browser immediately replaced its successful write
with an unrelated recovery read; the UI now applies the successful consent
response directly. Consent remains optional and private.

The first claim attempt reserved the local gas allowance and received one
`READY`, non-final `pm_getPaymasterStubData` response. It never requested final
paymaster data, produced a UserOperation hash, deployed the account or changed
the claim. After both the permit and provider stub expired beyond finalized
history, migration 014 recorded an operator-reviewed recovery and allowed one
exact-identity retry in permit epoch `1` without deleting the old attempt or
releasing its reserved allowance.

The retry ended `UNKNOWN` after the hosted CDP caller canceled three requests
through the temporary Cloudflare callback. There was no final request hash or
transaction. At latest block `46526744` and finalized block `46526083`, the
recipient remained undeployed with zero ETH, zero test USDC and EntryPoint nonce
zero; the slot and participant markers remained unused. Do not retry this
allocation again: `UNKNOWN` is intentionally ineligible for recovery.

The embedded-wallet project had no Paymaster network configuration. The next
test should save the existing private Base Sepolia endpoint in that CDP project
and use managed `useCdpPaymaster`, avoiding the hosted caller's callback through
the tunnel. Keep the strict contract/function policy, local reservation and
finalized receipt recovery; use a fresh allocation for acceptance. Production
sponsorship and every mainnet gate remain disabled.

## Session 25 managed Paymaster setup

The CDP User Wallet project now lists a masked Base Sepolia Paymaster
configuration using the existing private endpoint and blank context. The URL was
transferred from ignored local environment directly into the portal and was not
added to browser configuration or source control.

Migration 015 and the application implement managed sponsorship as a separate
mode. The participant server reserves one bounded allowance against the exact
signed claim before `useCdpPaymaster: true` can run. The random reservation ID is
the SDK idempotency key. A returned UserOperation hash is recorded once;
ambiguous results become `UNKNOWN`, never automatic retries. Finalized
`RewardPaid` evidence closes the database attempt and remains the only paid
status. The local acceptance database is migrated and the ignored local profile
selects managed mode with the custom proxy disabled. No Render setting changed.

Campaign `3` remains ineligible because its prior proxy epoch is `UNKNOWN`. The
next live acceptance must use a newly reviewed allocation, then record provider
logs/cost, UserOperation, transaction, finalized event, recipient delta and
duplicate recovery behavior.

## References

[CDP setup](https://docs.cdp.coinbase.com/paymaster/introduction/quickstart),
[proxy](https://docs.cdp.coinbase.com/paymaster/guides/paymaster-proxy),
[end-user Smart Account send API](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/end-user-accounts/send-user-operation-for-end-user-smart-account),
[security](https://docs.cdp.coinbase.com/paymaster/reference-troubleshooting/security),
[paymaster FAQ](https://docs.cdp.coinbase.com/paymaster/faqs),
[Coinbase v0.6 paymaster](https://github.com/coinbase/verifying-paymaster/tree/v1.0.0),
[ERC-7677](https://eips.ethereum.org/EIPS/eip-7677).
