# Base Account and sponsored gas

Local checkpoint, 2026-09-04. Do not activate sponsorship from this chapter alone.

## Implemented

`src/lib/base/account.ts` lazily imports the pinned Base Account SDK browser
entry point on explicit connect. It checks account and chain before/after message
signing, and again before sending a single zero-value `LearningRewards.claim`.
The UI compares recipient, amount, escrow, network, campaign, deadline and EIP-712
digest to the loaded lesson. It requests mandatory paymaster support with
`wallet_sendCalls`; there is no `eth_sendTransaction`, token approval, spending
permission, or user-paid gas fallback.

Account/chain/disconnect events invalidate browser authorization. Rejected wallet
actions do not silently retry. Before send, session storage holds an uncertainty
marker, then an opaque calls ID if returned. No signatures are persisted in browser
storage. `wallet_getCallsStatus` may report submission failure, but only the server's
finalized exact `RewardPaid` receipt changes the UI to paid. Lost call IDs require
account activity inspection; automated resend is intentionally withheld.

Counterfactual verification is default off. When separately enabled, the reader
accepts only ERC-6492 signatures for an operator-pinned factory runtime and
implementation runtime. It validates canonical `createAccount(bytes[],uint256)`
calldata, 1-4 bounded address/passkey owners, and the factory's predicted recipient
at the same canonical finalized block. Viem's established universal validator
performs an `eth_call` capped at one million gas. **Verification never deploys or
sends a transaction.** ERC-8010/delegation preparation remains unsupported; plain
EOA/deployed ERC-1271 behavior is preserved. Wrapper authority does not fall back
to an unwrapped former owner key.

The compiled local acceptance test uses a synthetic CREATE2 factory with the
required interface, not a real Base passkey/account deployment. It proves that
verification leaves the recipient undeployed, and the approved recipient can be
allocated and receive a finalized USDC reward. It does not prove the hosted wallet
popup, a fresh passkey, CDP, bundler gas costs, or sponsorship acceptance.

## Activation gates

`BASE_ACCOUNT_ENABLED`, `BASE_COUNTERFACTUAL_ENABLED` and
`BASE_SPONSORED_GAS_ENABLED` are independent, default-false switches.
Factory address, factory code hash and implementation code hash must be reviewed
for the selected network. No production factory address is guessed or auto-pinned.

`BASE_SPONSORED_CLAIM_PROXY_URL` is a **public, credential-free, reviewed HTTPS
proxy URL**, not a CDP API URL. The raw CDP endpoint is rejected by the browser and
configuration helper. Query strings, credentials and fragments are rejected.
Do not configure an open relay just to make the button work.

**The claim-specific sponsorship proxy is not implemented in this repository.**
Before enabling this path, implement/review the proxy (or approve an equivalent
external service), bind sponsorship to the real session/allocation and exact claim,
restrict account creation/entrypoint/call encoding, enforce expiry and retry-safe
operation identity, limit gas and sponsor budget, and configure CDP contract/function
allowlists plus per-operation/address/global limits. A cookie-only proxy may not
work through the wallet provider; prove the actual ERC-7677 caller/context and use
short-lived scoped credentials without logging them. Never forward arbitrary RPC.

Next acceptance: explicitly scoped Base Sepolia deployment, fresh browser/passkey
with zero ETH, wallet proof, one gas-sponsored redemption, cancellation and lost
response recovery, finalized receipt, provider cost, and account/network changes.
Only then propose a bounded mainnet pilot for approval. x402 payer compatibility
is a separate checkpoint; supporting ERC-6492 reward verification does not change
our facilitator's current counterfactual-payment limitations.

## References and dependencies

- [Base sponsorship guide](https://docs.base.org/sdks/base-account/improve-ux/sponsor-gas/paymasters)
- [CDP paymaster security](https://docs.cdp.coinbase.com/paymaster/reference-troubleshooting/security)
- [ERC-6492](https://eips.ethereum.org/EIPS/eip-6492)
- [Coinbase factory source](https://github.com/coinbase/smart-wallet/blob/main/src/CoinbaseSmartWalletFactory.sol)

The SDK is pinned to 2.5.10, with browser telemetry disabled. Its Node-only CDP
dependency pinned vulnerable Axios 1.16.0. The repository resolves Axios to
1.18.1 (also used by the existing 1Click client) for
[GHSA-gcfj-64vw-6mp9](https://github.com/advisories/GHSA-gcfj-64vw-6mp9).
Audit both production and full dependency trees after future SDK changes.
