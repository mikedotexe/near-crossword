# Base Sepolia sponsorship acceptance

Status: preparation only, 2026-09-04. No public-chain transaction or fresh hosted
wallet test has been performed for Crossword. Local synthetic proofs are in
[QA](../QA.md); architecture is in [chapter 09](../md-CLAUDE-chapters/09-claim-sponsorship.md).

## Existing infrastructure investigation

Mike approved moving toward transfers and asked us to inspect
`/Users/mikepurvis/near/fn/x402-near-facilitator` and AWS for prior setup.
Read-only inspection found:

- The facilitator uses a funded settlement signer, not an ERC-7677 CDP paymaster.
  Its recorded canary payer is dedicated to mainnet x402. These identities must
  not be reused as Crossword sponsor, deployer, eligibility signer or paymaster.
- No CDP/paymaster configuration was found in the inspected repository. Its
  Sepolia config is a software profile, not evidence of a live Sepolia service.
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

1. Open [CDP Portal](https://portal.cdp.coinbase.com), use a dedicated Crossword
   project and choose Paymaster under Onchain Tools, **Base Sepolia**. Keep its
   private endpoint only in `BASE_PAYMASTER_UPSTREAM_URL` in the original repo's
   ignored `.env` or the intended staging secret store. Never paste it in chat
   or put it in the public `BASE_SPONSORED_CLAIM_PROXY_URL` variable.
2. Configure a deny-by-default contract/function allowlist for the separately
   deployed Crossword escrow's `claim` function. Review factory/account creation
   support and per-operation, per-address and total billing caps. Do not allow
   arbitrary calls to the factory or all methods just to pass a wallet prompt.
3. Choose a dedicated Base Sepolia sponsor/deployer wallet and its recovery
   address, separately from the fresh participant and server eligibility signer.
   Never put a sponsor/deployer key into the web service. Use test-only faucet
   funds; no bridge or mainnet purchase is required for this test.
4. Confirm the exact funded preview once addresses and estimates are known.
   Proposed scope, **not yet transaction-specific approval**: 1 test USDC campaign
   principal, total deployment/funding gas at most 0.001 test ETH, no mainnet
   funds. Separately approve the CDP sponsorship/billing cap. The user approved
   transfers in general but directed identity discovery instead of selecting
   a payer, recipient and refund address; those fields remain unresolved.

## Engineering: staging and no-spend checks

1. Review/deploy the compiled escrow on chain 84532 with native test USDC
   `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. Before broadcast, show the exact
   deployer, constructor, gas envelope and expected contract address, obtain
   confirmation, and persist the signed transaction/hash for ambiguous recovery.
2. Record deployment anchor/code hash and independently verify RPC chain, token,
   canonical history and finality policy. Configure an isolated staging Postgres
   target, migrations through 013 and a supervised healthy scanner. Do not point
   the staging process at the production NEAR database by accident.
3. Use a credential-free HTTPS staging URL for the proxy, reachable by the hosted
   wallet. Verify the real email callback/session. Configure the independent
   eligibility signer and approved account/factory/proxy/EntryPoint/paymaster
   pins. The current proxy explicitly supports EntryPoint 0.6 only.
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
   immediately before each funded step. Prefund one 1-USDC slot; never top up
   from an operator reserve to mask a shortfall. Link and publish only after
   finalized accounting matches reviewed terms.
2. Start a genuinely fresh Base Account/passkey session. Mike handles the wallet's
   passkey/biometric prompts. Record public recipient, zero ETH, code/nonce state
   and supported entrypoint before the flow. No EOA fixture may substitute.
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

## References

[CDP setup](https://docs.cdp.coinbase.com/paymaster/introduction/quickstart),
[proxy](https://docs.cdp.coinbase.com/paymaster/guides/paymaster-proxy),
[security](https://docs.cdp.coinbase.com/paymaster/reference-troubleshooting/security),
[ERC-7677](https://eips.ethereum.org/EIPS/eip-7677).
