# Base Sepolia sponsorship acceptance

Status: Base Sepolia escrow deployed and one-slot campaign funded, updated
2026-09-05. No provider sponsorship request or fresh hosted-wallet claim has
been performed.
CDP faucet transfers funded the test deployer on Base Sepolia. Local synthetic proofs are in
[QA](../QA.md); architecture is in [chapter 09](../md-CLAUDE-chapters/09-claim-sponsorship.md).
Session 9 adds an encrypted test-deployer wallet and disabled local env profile;
see [local setup and recovery](base-sepolia-local-setup.md). Session 10 confirms
0.0001 test ETH and 1 native test USDC balances. CDP sign-in is complete, but the
local endpoint slot is now present and read-only checked as Base Sepolia. Actual
provider wire acceptance remains pending. Session 12 deployed the escrow and
saved a claim-only CDP allowlist. Session 13 configured a separate eligibility
signer and sent the exact 1-test-USDC approval after explicit approval. Session
14 verified approval finality, recomputed the stale campaign schedule and created
campaign `1` after explicit approval. Deployment finality is verified; campaign
finality is pending. Managed CDP sponsorship is account-billed, not an ETH
deposit into this separate deployment wallet.

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
   funded at block `46444150`; wait for campaign finality before issuing a claim. See
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
