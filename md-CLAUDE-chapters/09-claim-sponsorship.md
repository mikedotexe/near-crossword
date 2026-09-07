# Claim-only sponsorship

Sessions 8-18 implementation and Base Sepolia acceptance, updated 2026-09-06.
Production remains disabled. Read the
[Base Account chapter](08-base-account-and-gas.md) and
[live test checklist](../docs/base-sepolia-sponsorship-acceptance.md).

## Authorization and wire boundary

`POST /api/base/participants/:id/sponsorship` requires the existing database
session, same-origin mutation guards and a saved signed reward digest owned by
that participant. It revalidates approved funding, verified email, the exact
stored allocation/claim/signature, current signer epoch, open redemption window,
unused claim and healthy finalized accounting. Withdrawn lessons can still
recover existing allocations; publication is not silently required again.

The response is a 256-bit random token, digest and expiry, at most ten minutes
or the claim deadline. Only the token's SHA-256 is stored. Refresh invalidates
the old token; once any provider request is attempted it cannot extend expiry.
The browser keeps the token in memory, binds it to the reward, rechecks wallet
identity and passes `{token}` as the paymaster capability's ERC-7677 context.
Never put the token in URLs, logs, traces or browser storage.

`POST /api/base/paymaster` uses this token, not a cookie. CORS permits wallet
callers without credentials; CORS is not authentication. JSON requests are
bounded by the existing participant stream limit and IP rate limits. Only
`pm_getPaymasterStubData` and `pm_getPaymasterData` are accepted. JSON-RPC batches,
notifications, extra fields, noncanonical quantities and arbitrary RPC are denied.
Errors omit private/provider payloads, and responses are no-store.

The first profile supports **Coinbase Smart Wallet / EntryPoint 0.6 only**:

- Base Sepolia only in environment configuration. The injected local test
  policy may use Anvil; an environment variable cannot enable mainnet.
- Canonical `execute`, or `executeBatch` with exactly one item, to the configured
  escrow's exact allocated `claim` bytes, zero ETH. No approval, upgrade, owner
  edit, delegation preparation, multicall or cross-chain replayable nonce.
- Only nonce key zero. Current EntryPoint nonce must match. Factory creation is
  canonical `createAccount(bytes[],uint256)`, with bounded owner encodings and
  a predicted recipient matching the authorized sender.
- Factory, implementation, deployed proxy, EntryPoint and paymaster code hashes
  are independently pinned. Implementation and account checks run at both the
  finalized and current canonical block; no stale known upgrade is accepted.
- Read-only simulation of the exact escrow claim at the current block rejects
  known payouts, pauses or rotations that are not finalized by the scanner yet.
- EntryPoint 0.7/0.8, ERC-7702 and alternate account encodings fail closed. Real
  Base Account might select a different profile; observe it and add a separately
  reviewed profile rather than relaxing the decoder or inferring compatibility.

## Budget and uncertain outcomes

Migration 013 records one sponsorship per allocation. A deployment-wide database
lock makes global and per-recipient allowances atomic across campaigns. Reserve
the configured maximum per-operation wei before the first upstream request,
including stub requests. The global ceiling is lifetime per deployment. It does
not reset at midnight, token refresh, process restart or a new campaign.

Gas/fee fields have explicit caps; the v0.6 maximum prefund calculation includes
three times verification gas. The reservation is a conservative authorization
allowance, **not an actual provider bill**: configure separate CDP billing caps
for provider fees and L1-data costs, then record actual cost in live acceptance.
Gas funding is operator money; no campaign principal pays these allowances.

All requests for an allocation share one nonce/initCode/exact account call.
At most twelve distinct requests are allowed, for bounded estimation changes.
The first final request freezes the exact gas fields. Full canonical request
hashes deduplicate retries. `IN_FLIGHT` is committed before contacting CDP;
`READY` responses replay without contacting it again. Any ambiguous failure is
`UNKNOWN`; it blocks all further provider requests for that allocation. A crash
leaves `IN_FLIGHT`, also blocked. Never delete or release those reservations.

There is deliberately no automatic retry/release after cancellation, expiry,
unknown signing, or a reverted UserOperation. Nonce/receipt/provider evidence and
an operator-reviewed recovery procedure are required before a new sponsorship
attempt. The reward allocation itself remains privately recoverable. This is a
conservative pilot boundary, not the final self-service gas recovery experience.

Migration 014 implements the first narrow recovery procedure for an expired
`READY`, non-final, stub-only attempt. It preserves old requests under numbered
permit epochs and adds an append-only review containing the exact operation
identity, old expiry, maximum provider validity and a finalized unused-claim
checkpoint. `base:sponsorship-recovery:preflight` is read-only;
`base:sponsorship-recovery:commit` records review, and the participant's next
permit consumes it once. The next proxy request must retain the same sender,
nonce, factory creation and claim bytes. `UNKNOWN`, `IN_FLIGHT`, final requests,
unexpired provider data, changed nonces and used claims remain ineligible.

Migration 015 adds `CDP_MANAGED` as a separate, one-shot sponsorship mode for
CDP User Wallets. Before the browser calls the SDK, the authenticated participant
API revalidates the exact signed claim against finalized accounting, acquires the
same deployment-wide budget lock, reserves the maximum operation allowance and
stores a random attempt ID. That ID is also the CDP idempotency key. A second
reservation for the allocation is always denied. The browser may report exactly
one UserOperation hash or mark the result `UNKNOWN`; conflicting hashes and a
late success after `UNKNOWN` fail closed. A matching finalized `RewardPaid` event
can close any managed state as `FINALIZED`, including a lost browser response.
Managed mode has no public or private paymaster URL in browser configuration.

The upstream URL is server-only, fixed to CDP Base Sepolia. Redirects, automatic
retry and caller-selected destinations are forbidden; time/output are bounded.
The permit/cookies are stripped, and the provider receives empty context. Its
result must match the pinned Coinbase v1.0.0 paymaster layout, use a zero payment
token/receiver/exchange-rate region and expire within the permit. CDP currently
sets `precheckBalance` even for developer-sponsored gas; that flag is inert when
the payment token is zero, matching the deployed paymaster contract. Provider
names/icons or extra output fields are not reflected.

## Verification and remaining work

Session 9 prepares the launch-candidate's ignored `.env.local`, with chain 84532
and every spending gate disabled. An encrypted test-deployer keystore outside
the repo has a separate macOS Keychain password and verified offline recovery;
its public identity and recovery locations are in
[local setup](../docs/base-sepolia-local-setup.md). No seed or deployer key belongs
in the web environment. Session 10 funded that deployer with CDP Base Sepolia
faucets: 0.0001 test ETH and 1 native test USDC. CDP's managed paymaster uses
account billing, not this wallet's ETH. CDP sign-in is complete and the Base
Sepolia Paymaster page exposes a private endpoint. Session 11 validates that the
endpoint is present locally and returns Base Sepolia from a read-only chain check
without printing it. The pre-deployment estimates are preserved in
[the 2026-09-05 deployment record](../docs/base-sepolia-deployment-preflight-2026-09-05.md).

Session 12 deploys `LearningRewards` on Base Sepolia after explicit approval:
`0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304`, transaction
`0x0419e4a8a2334233cec9272a846f95b77cb35915931e5115599d1c454e6a7a03`.
The actual deployed runtime hash is
`0xebc5371a9a09231045c01981600b619436374e6226048855a6116d1d0c2dce00`, with
native Base Sepolia USDC returned by `token()`. CDP Paymaster was saved with a
single allowlist entry for this contract's `claim` selector `0x8bd53692`, a $1
global and per-user visible cap, 10 operations per user, and sponsor name
`Crossword`. The deployment block was not finalized at the latest observation,
and no provider sponsorship request or campaign funding has occurred.

Session 13 verifies deployment finality and sends the approved 1-test-USDC
allowance transaction:
`0xf472670687b4657841cf4cf7d10c2d5049b26c3e11d0e591f346392f291065f2`.
The approval sets escrow allowance to `1000000` atomic units and uses
0.000000332622 test ETH. Session 14 verifies approval finality, recomputes the
campaign schedule because the older preflight had gone stale, and sends
`createCampaign` after explicit approval:
`0x1a1f49f3c06d37c1fe2295ad0188f0e27e78a8b1c0b4636a9e7f0f4175bf6182`.
Campaign `1` is funded with exactly `1000000` atomic units of native Base
Sepolia USDC, with terms hash
`0x6f544fbc2b3e1f76ab16fa36aea6b2cd6c76c306bd64a941d91d73968bb01e89`,
starting 2026-09-05 18:31:50 PDT and claim deadline 2026-09-07 00:31:50 PDT.
Deployer USDC is 0, escrow USDC is `1000000`, allowance is 0, and
`totalReserved()`/`outstanding(1)` both equal `1000000`. Campaign finality,
provider sponsorship and the fresh hosted-wallet claim remain open.

Session 17 completes the split between hosted onboarding and the backend proof.
The hosted Base
Account remains blocked on Base Sepolia before authorization, matching open SDK
issue #363. A local in-memory owner created a fresh Coinbase Smart Account v1.1
through the same EntryPoint 0.6/factory path. The preparation-only run reached
both CDP paymaster methods and established that current sponsored envelopes set
an inert `precheckBalance` flag while retaining a zero payment token. The proxy
parser and synthetic fixture now match that deployed contract behavior without
allowing ERC-20 gas payment.

After explicit approval, a second fresh account submitted the one-slot claim as
UserOperation
`0x92e56f426be9c882cb8729e269cb1e6d07981b5194872626a80d7f2e65c470ee`.
Transaction
`0x35860a8044d025b6086acbacc02a3f173520b88410fc9338c6267117dc6f1255`
deployed the account and paid exactly `1000000` atomic test USDC to
`0xb4afC958555F64A03944DFaC696c447179ea2348`. The recipient remained at zero
ETH, slot `0` became used and campaign outstanding became zero. CDP returned the
official v0.6 paymaster `0x709A4bae3DB73a8E717AEfca13E88512f738b27f`
with code hash
`0x4cf2309390afafca14fdedb734f3adee5abe21e0d27f27a36fa5b4f46712b97c`.
The throwaway owner credential was never persisted, so the test reward is
intentionally not recoverable. A bounded 20-minute follow-up ended with Base's
finalized head at `46450038`, 60 blocks behind the transaction at `46450098`.
Session 18 rechecked at finalized head `46480230`: the receipt remains successful,
recipient code is deployed, recipient USDC is `1000000`, slot `0` is used and
campaign outstanding is zero. Backend sponsorship and escrow accounting are now
finalized. This does not prove the selected CDP User Wallet onboarding path or
production readiness.

Mainnet custody stays out of the early launch path. For Base Sepolia, use CDP or
Base faucets first. If a real Coinbase send is later required, it must be a tiny
reviewed Base-network transfer to a fresh production custody address with an
independent backup, not the compromised MetaMask profile and not the local
test-deployer wallet. Never store a mainnet mnemonic in `.env`.

Tests cover strict input/claim/factory/gas parsing, RPC pins and nonce checks,
cookie-free wallet-context HTTP, private permit issuance, race-safe quotas,
refresh/restart replay, expiry, signer rotation, paid claims, provider errors and
ambiguous outcomes. Synthetic provider replies are not real CDP acceptance.

Live gates: dedicated paymaster project and policy/budget, reviewed deployment
and account code pins, supervised scanner, a fresh CDP User Wallet email session
and smart account with zero ETH, signed challenge compatibility, database-backed
issuance/recovery, cancellation/lost-response recovery, and independently observed
provider cost. The backend already has one finalized test payout.

Session 24 exercised the database-backed CDP participant on campaign `3`.
Completion, smart-account proof, slot allocation and signed authorization all
passed. Permit epoch `0` returned only a `READY` non-final stub and no final
request; no account deployment, nonce or reward followed. After expiry and
finality, migration 014's dry run and committed review admitted the same operation
into epoch `1`. Three Cloudflare callback requests were canceled by the hosted
CDP caller and the epoch-1 stub became `UNKNOWN`; no further custom-proxy retry is
allowed. Chain reads at latest `46526744` and finalized `46526083` still showed
the account undeployed, nonce zero, zero ETH/USDC and unused claim markers.

The CDP embedded-wallet project's Paymaster tab had no network configuration.
Current Coinbase guidance supports storing the Base Sepolia paymaster URL there
and using managed `useCdpPaymaster`, avoiding the hosted wallet's callback through
the temporary tunnel. Treat that as a separate reviewed mode: retain the CDP
contract/function allowlist and provider limits, add local gas reservation and
finalized recovery evidence, and do not silently bypass this allocation's
`UNKNOWN` record.

Session 25 saved the existing Base Sepolia endpoint in the CDP User Wallet
project's Paymaster configuration with blank context. The portal masks it after
save. The application now supports the documented managed `useCdpPaymaster`
option, guarded by mutually exclusive `BASE_CDP_MANAGED_PAYMASTER_ENABLED` and
proxy switches. Migration 015 is applied to the local acceptance database, and
the ignored local profile selects managed mode. Render and production gates were
not changed. Campaign `3` remains blocked by its earlier proxy `UNKNOWN`; live
managed acceptance requires a fresh reviewed allocation.

Session 15 adds a live Base Sepolia acceptance harness at
`scripts/base-sepolia-sponsored-claim-acceptance.ts`. It starts a local-only
page, exposes only a randomized HTTPS paymaster path through Cloudflare Tunnel,
signs exactly one campaign-1/slot-0 claim for the connected recipient, and writes
sanitized evidence under `/tmp`. It never logs or stores raw signatures, permit
tokens, CDP URLs or wallet payloads. Current live evidence: the connected Base
Account `0xec237B5F036850221e45c1bD634ed4835983933B` had 0 ETH, 0 USDC and no
deployed code before authorization; Base Account reported Base Sepolia chain
`0x14a34` with `paymasterService` support; campaign `1` remained finalized,
unclaimed and funded with `1000000` atomic USDC. An initial claim attempt failed
before any proxy request reached CDP; the hosted `keys.coinbase.com` popup
reported that Base Sepolia was unsupported. The harness then moved to the Base
Account SDK sub-account route: create on connect, make the sub-account the
default recipient and use manual funding so a sponsored Base Sepolia user
operation should reach the local claim-only paymaster proxy before CDP. This also
failed before authorization: `eth_requestAccounts` returned the hosted account,
then explicit `wallet_addSubAccount` rejected with code `4001`; no paymaster
request reached the proxy. This matches current `base/account-sdk` issue #363,
where newly created Base Accounts can connect and report Base Sepolia
capabilities but cannot transact through the hosted keys flow. Treat hosted Base
Account Sepolia acceptance as upstream-blocked, not proven. Next proof should
split the problem: test the same escrow/paymaster path with a local throwaway
Coinbase Smart Account owner on Base Sepolia, while keeping hosted Base Account
onboarding as a separate product risk. This is still a one-off acceptance path,
not production DB-backed claim issuance.

## References

- [ERC-7677 context and methods](https://eips.ethereum.org/EIPS/eip-7677)
- [Base sponsorship capability](https://docs.base.org/sdks/base-account/improve-ux/sponsor-gas/paymasters)
- [CDP proxy and private endpoint](https://docs.cdp.coinbase.com/paymaster/guides/paymaster-proxy)
- [CDP managed paymaster quickstart](https://docs.cdp.coinbase.com/paymaster/introduction/quickstart)
- [CDP end-user Smart Account send API](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/end-user-accounts/send-user-operation-for-end-user-smart-account)
- [CDP security and policies](https://docs.cdp.coinbase.com/paymaster/reference-troubleshooting/security)
- [Coinbase Smart Wallet source](https://github.com/coinbase/smart-wallet/blob/main/src/CoinbaseSmartWallet.sol)
- [Coinbase paymaster v1.0.0 format](https://github.com/coinbase/verifying-paymaster/blob/ca356bb0ff674c2000087f0a1cb06c41db6fb688/src/VerifyingPaymaster.sol)
- [Base Account SDK issue #363](https://github.com/base/account-sdk/issues/363)
