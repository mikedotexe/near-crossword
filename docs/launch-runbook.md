# V2 launch runbook

This is an operational checklist, not authorization to move funds. Every live
transaction requires a human to confirm network, token contract/asset ID,
amount, payer, receiver, refund address, and recovery account.

## 1. Prepare staging

- Create a new v2 contract account. Do not reuse or upgrade
  `crossword.puzzle.near`.
- Pin the intended NEP-141 USDC contract at initialization.
- Rebuild the release WASM from the reviewed commit and record its SHA-256.
- Apply all `migrations/v2` migrations to an isolated Postgres database.
- Configure creator auth, 1Click, and x402 secrets in the server runtime.
- Configure a trusted ingress client-IP header and verify spoofed forwarding
  headers are overwritten before enabling shared rate limits.
- Set `V2_NEAR_NETWORK` explicitly and verify it matches
  `NEXT_PUBLIC_NEAR_NETWORK`; never rely on an implicit mainnet default.
- Configure a narrowly funded operator account; keep
  `V2_CHAIN_BROADCAST_ENABLED=false`.
- Start the web service and perform all mock/browser checks in `QA.md`.
- Independently compare the configured contract, USDC token, RPC network, and
  operator before enabling the worker.

## 2. Testnet proof

- Deploy the reviewed WASM to the staging account.
- Initialize once with the pinned token/operator values.
- Enable broadcasting only for the dedicated staging worker.
- Run direct token funding, successful claim, losing concurrent claim,
  callback failure/recovery, scheduled cancellation, permissionless expiry, and
  refund retry.
- Restart the worker during external waits and confirm jobs reconcile instead
  of rebroadcasting.
- Record transaction hashes and sanitized `OperationEvent` evidence.
- Confirm contract accounting and token balance after every terminal case.

## 3. Mainnet canary

1Click routing has no testnet. Obtain explicit approval for a campaign at or
below the beta cap and record the approved values before requesting a quote.

- Fund from one supported non-NEAR origin with exact-output delivery.
- Confirm the creator authorization on-chain before revealing or using the
  1Click deposit package.
- Verify final origin settlement, external funding allocation, and the complete
  reserved USDC prize.
- Publish only after the contract and ledger agree.
- Solve anonymously and complete a direct NEAR payout.
- Repeat with an exact-input cross-chain winner payout; retain the downstream
  settlement receipt.
- Run a separate tiny route that exercises winner-controlled refund recovery.
- Complete one x402 AI generation and replay its payment identifier; prove only
  one settlement occurred.

## 4. Cutover

- Complete contract audit and address all blocking findings.
- Name NEAR and partner launch owners with escalation and go/no-go authority.
- Transfer upgrade authority to the selected multisig.
- Keep the old public application available while acceptance campaigns run.
- Move `crossword.xyz` only after live evidence is attached to the release.
- Preserve `/legacy` until the three claim-only keys and approximately
  14.66 NEAR on the old account are reconciled.

## Rollback

- Disable new campaign creation and chain-worker broadcasting.
- Do not change immutable recovery destinations.
- Continue read-only reconciliation and permissionless expiry/refund.
- Keep campaign evidence pages available.
- Roll the application back to the prior reviewed version only after confirming
  its schema compatibility; never roll back contract state.
