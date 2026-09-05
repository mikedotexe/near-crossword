# Claim-only sponsorship

Session 8 local implementation, 2026-09-04. Not deployed or funded. Read the
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

The upstream URL is server-only, fixed to CDP Base Sepolia. Redirects, automatic
retry and caller-selected destinations are forbidden; time/output are bounded.
The permit/cookies are stripped, and the provider receives empty context. Its
result must match the pinned Coinbase v1.0.0 paymaster layout, prohibit every
token-payment field and expire within the permit. This check applies to stubs
too: `isFinal:false` does not prove that returned bytes cannot spend gas.
Provider names/icons or extra output fields are not reflected. Actual CDP stub
format/expiry behavior is not yet observed; incompatible data must fail closed.

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
and account code pins, supervised scanner, real email session, fresh hosted
passkey with zero ETH, exact funded test approval, cancellation/lost-response
recovery, one finalized payout and independently observed provider cost.

## References

- [ERC-7677 context and methods](https://eips.ethereum.org/EIPS/eip-7677)
- [Base sponsorship capability](https://docs.base.org/sdks/base-account/improve-ux/sponsor-gas/paymasters)
- [CDP proxy and private endpoint](https://docs.cdp.coinbase.com/paymaster/guides/paymaster-proxy)
- [CDP security and policies](https://docs.cdp.coinbase.com/paymaster/reference-troubleshooting/security)
- [Coinbase Smart Wallet source](https://github.com/coinbase/smart-wallet/blob/main/src/CoinbaseSmartWallet.sol)
- [Coinbase paymaster v1.0.0 format](https://github.com/coinbase/verifying-paymaster/blob/ca356bb0ff674c2000087f0a1cb06c41db6fb688/src/VerifyingPaymaster.sol)
