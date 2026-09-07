# Base account and sponsored gas

Updated 2026-09-06 after the finalized Base Sepolia backend proof and the CDP
User Wallet participant decision. Do not activate sponsorship from this chapter
alone; use [chapter 09](09-claim-sponsorship.md) and
[chapter 10](10-cdp-participant-accounts.md) as well.

## Selected browser path

Participants use CDP User Wallet email OTP and its smart account. The abandoned
`@base-org/account` popup adapter is no longer a runtime dependency: fresh hosted
Base Accounts connected on Base Sepolia but rejected transactions and sub-account
creation before the Crossword proxy, matching upstream issue #363.

`app/learn/ParticipantAccount.tsx` owns CDP lifecycle, smart-account selection,
message signing and UserOperation submission. `src/lib/base/account.ts` remains a
pure transaction boundary: it compares recipient, amount, escrow, network,
campaign, slot, nonce, deadline and EIP-712 digest to the loaded reward, then
sends exactly one zero-value `LearningRewards.claim` through the configured
paymaster proxy. There is no ordinary transaction, token approval, spend
permission or user-paid gas fallback.

Rejected wallet actions do not silently retry. The browser stores no wallet
signature, CDP token or paymaster permit. A returned UserOperation hash is only
submission evidence; only the server's exact finalized `RewardPaid` recovery
changes the reward to paid. Unknown outcomes remain subject to the durable
sponsorship recovery rules in chapter 09.

## Counterfactual verification

Counterfactual verification is default off. When separately enabled, the reader
accepts only ERC-6492 signatures for an operator-pinned factory runtime and
implementation runtime. It validates canonical `createAccount(bytes[],uint256)`
calldata, 1-4 bounded address/passkey owners, and the factory's predicted
recipient at the same canonical finalized block. Viem's universal validator
performs a bounded `eth_call`. Verification never deploys or sends a transaction.

EOA and deployed ERC-1271 behavior remains supported. ERC-8010/delegation
preparation is unsupported, and wrapper authority does not fall back to an
unwrapped former owner key. The compiled local test uses a synthetic CREATE2
factory and proves verification cannot mutate account state. The selected CDP
User Wallet must still pass this same signed-challenge boundary in live acceptance.

## Observed Base Sepolia proof

Session 17 used a fresh local Coinbase Smart Account v1.1, not the hosted popup,
to prove the escrow, EntryPoint 0.6, factory, strict Crossword proxy and CDP
paymaster together. UserOperation
`0x92e56f426be9c882cb8729e269cb1e6d07981b5194872626a80d7f2e65c470ee`
produced transaction
`0x35860a8044d025b6086acbacc02a3f173520b88410fc9338c6267117dc6f1255`
at block `46450098`. The zero-ETH recipient received exactly 1 test USDC and paid
no gas. Session 18 rechecked the successful receipt, deployed account, used slot
and zero outstanding at finalized head `46480230`.

This closes backend sponsorship finality. It does not prove fresh CDP email OTP,
the CDP-generated smart account's ERC-6492 message signature, database-backed
issuance, or live browser submission through this adapter.

## Activation gates

`BASE_ACCOUNT_ENABLED`, `CDP_PARTICIPANT_AUTH_ENABLED`,
`BASE_COUNTERFACTUAL_ENABLED` and `BASE_SPONSORED_GAS_ENABLED` are separate,
default-false switches. Account UI also requires `NEXT_PUBLIC_CDP_PROJECT_ID`.
Factory address, factory code hash and implementation code hash must be reviewed
for the selected network. No production address is guessed or auto-pinned.

`BASE_SPONSORED_CLAIM_PROXY_URL` is a public, credential-free, reviewed HTTPS
proxy URL, not a CDP API URL. The raw CDP endpoint is rejected by browser
configuration. Query strings, credentials and fragments are rejected. The
private permit endpoint requires a database session; the browser passes its
short-lived token through ERC-7677 context, not a site cookie.

Next acceptance is one fresh CDP User Wallet email session on Base Sepolia with
zero ETH, signed wallet proof, database issuance, sponsored redemption, finalized
recovery, duplicate/lost-response behavior and observed provider cost. Only then
should a bounded mainnet pilot be proposed. x402 payer compatibility is a separate
checkpoint; reward signature support does not change the facilitator's current
counterfactual-payment limitations.

## References and dependencies

- [CDP User Wallet](https://docs.cdp.coinbase.com/embedded-wallets/welcome)
- [CDP paymaster security](https://docs.cdp.coinbase.com/paymaster/reference-troubleshooting/security)
- [ERC-6492](https://eips.ethereum.org/EIPS/eip-6492)
- [Coinbase factory source](https://github.com/coinbase/smart-wallet/blob/main/src/CoinbaseSmartWalletFactory.sol)
- [Hosted Base Account issue #363](https://github.com/base/account-sdk/issues/363)

CDP browser packages are pinned to 0.0.123 and the server SDK to 1.52.0. SDK
analytics/error reporting are disabled. CDP Core's optional deprecated x402 v1
browser import is excluded; Crossword stays on its existing x402 v2 stack.
Audit production and full dependency trees after future SDK changes.
