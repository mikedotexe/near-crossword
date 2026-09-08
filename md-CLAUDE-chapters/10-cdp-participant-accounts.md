# CDP participant accounts

Session 18 implementation, 2026-09-06. This is the selected participant path;
sponsors continue to use the existing NextAuth/Resend/Google authentication.
Production remains disabled until the live acceptance below passes.

## Browser flow

`app/learn/ParticipantAccount.tsx` wraps learning routes in CDP Hooks only when
`NEXT_PUBLIC_CDP_PROJECT_ID` is present. CDP email OTP creates a smart account at
login, with spend permissions and SDK analytics disabled. The app does not ask a
participant to install a wallet, choose a chain or hold ETH.

After CDP signs in, the browser obtains the short-lived access token and sends it
once to `POST /api/base/auth/session` with the selected smart-account address.
It keeps neither that token nor wallet signatures in local/session storage. A
successful response sets the same HttpOnly database-session cookie already used
by participant APIs. The browser refreshes that local session before its
14-minute expiry while the CDP session is still valid.

Sign-out first removes the presented database session, then signs out of CDP.
When CDP is not configured, existing NextAuth links and nonpaying browser fixtures
remain available; that fallback is not the selected reward launch path.

## Server trust boundary

`src/server/base/participant-session.ts` validates the access token through the
CDP server SDK using `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`. It requires exactly
one authenticated email method and verifies that the submitted recipient appears
in the validated end user's smart-account objects. Client claims about email,
verification or ownership are ignored.

The bridge links by the stable `coinbase-cdp` provider subject, or by an existing
normalized email under a database lock. A subject already linked to another email
fails into explicit recovery; ambiguous local email identities also fail closed.
The CDP token is never written to `accounts`, `sessions`, logs or API responses.
Only a random 256-bit local session token and its expiry are persisted.

Session creation and deletion require the configured exact origin. The POST has
bounded JSON, token length/character validation, IP rate limiting and sanitized
provider errors. Invalid CDP credentials or service failures do not create users,
accounts or sessions.

## Reward and gas path

Authentication does not authorize a reward. The participant still completes the
approved revision and signs the existing campaign/recipient/origin-bound wallet
challenge with the CDP smart account. The server's counterfactual verifier and
finalized accounting remain responsible for wallet control and claim issuance.

`src/lib/base/account.ts` accepts CDP's `sendUserOperation` function only after it
rechecks chain, escrow, recipient, campaign, slot, amount, deadline and signature
digest. Proxy mode additionally requires a reviewed public URL and fresh
claim-specific permit. Managed mode requires the server's one-shot reservation
ID, passes it as the CDP idempotency key and sets only `useCdpPaymaster: true`.
Both modes send one zero-value escrow claim; there is no user-paid gas or ordinary
transaction fallback. Only finalized server recovery marks paid.

## Configuration and acceptance

All are required before the participant UI is enabled:

- `NEXT_PUBLIC_CDP_PROJECT_ID`: public identifier for the intended CDP project.
- `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`: server-only Secret API Key from that
  same project, authorized to validate end-user access tokens.
- `CDP_PARTICIPANT_AUTH_ENABLED=true` and `BASE_ACCOUNT_ENABLED=true`.
- Exactly one of `BASE_CDP_MANAGED_PAYMASTER_ENABLED` or
  `BASE_PAYMASTER_PROXY_ENABLED`; managed mode also requires the project's saved
  per-network Paymaster configuration.
- The exact local/staging/production origins allowed in CDP, plus the existing
  participant, counterfactual, issuance, scanner and sponsorship gates.

Packages are pinned to `@coinbase/cdp-core`/`@coinbase/cdp-hooks` 0.0.123 and the
server SDK 1.52.0. CDP Core's unused optional deprecated `x402-fetch` v1 import is
excluded from the Next bundle; Crossword's existing x402 v2 dependencies and
facilitator path are unchanged.

Automated evidence covers identity validation, ownership substitution, origin
rejection, account linking/retry, token non-persistence, session expiry/sign-out,
exact sponsored-call construction and existing browser regressions. Live
acceptance on 2026-09-06 proved a fresh email OTP, smart-account creation,
same-project server validation, and the database session bridge. CDP publishes
the signed-in user before `createOnLogin` finishes creating the smart account;
the client must remain in its initializing state until a recipient exists and
must never submit an empty-recipient session request. ERC-6492 message signature,
database issuance, CDP UserOperation through the strict proxy, finalized reward
recovery, duplicate/uncertain behavior and provider cost remain open. Keep
production disabled until that evidence is recorded.

## Funded acceptance campaign

Session 21 created Base Sepolia campaign `2` for the remaining combined test.
Session 22's application binding check then caught that its readable harness
commitment did not equal the canonical approved application terms hash. No
participant or paymaster request occurred. A labeled direct-gas recovery claim
returned its full test USDC to the sponsor and finalized beyond block `46521526`.
This is a successful fail-closed recovery, not participant acceptance. See the
[campaign 2 record](../docs/base-sepolia-campaign-2-2026-09-07.md).

Replacement campaign `3` was prepared from approved application revision `2`
and layout before funding. It reserves one reward of `1000000` native test-USDC
atomic units for slot `0`, with canonical terms hash
`0x8ceb4b64f564424caf61e0957dc2bd090ce7cf315178f498468f1ed482d97ad8`.
Funding transaction
`0x4c9199cfaa7f8c138bc64da55a2ab7cddbe7a8eab77e9f7adfff99b13a1cbd99`
was included at block `46522033` and reconciled at finalized block `46522071`.
It is bound only to application campaign
`247c4bff-fb70-4a50-b78e-9d6ed194ab4d`, revision `2`, and published in the local
acceptance database. The idempotent recheck preserved its unused slot for the
email-backed CDP participant flow described above. See the
[campaign 3 record](../docs/base-sepolia-campaign-3-2026-09-07.md).

Session 23 added both `http://localhost:3125` and `https://crossword.xyz` to the
same CDP Web client. The returning email participant again passed OTP, smart
account creation and server token validation. At finalized block `46523842`,
recipient `0xFB5766CAa773F1711C876a5d0489084563e56F7c` had no deployed code,
ETH, USDC or EntryPoint nonce. Optional sponsor-contact consent persisted as
version 1; an unrelated post-save accounting refresh then failed against the
public RPC. The UI now applies the successful consent response directly, and a
browser regression proves consent does not initiate a reward recovery read.
No completion, allocation, wallet signature, sponsorship request or payout had
occurred at that checkpoint.

Session 24 completed the puzzle and corrected wallet proof semantics. CDP's plain
EVM signer controls the smart account's owner EOA, so message ownership now uses
Coinbase replay-safe typed data, wraps the owner signature for the Smart Wallet's
ERC-1271 validator, and adds the pinned factory ERC-6492 envelope while the account
is counterfactual. The server accepted that proof and issued the one immutable
campaign-3 allocation. Successful consent and authorization mutations now update
their local panel state directly; redundant recovery reads can no longer turn a
saved mutation into a red error. The server permit remains the authoritative
pre-send chain check.

The subsequent custom-paymaster callback did not reach a final paymaster request
or UserOperation. After one append-only reviewed retry, the second stub was
durably `UNKNOWN` and chain state remained untouched.

Session 25 saved Base Sepolia in the embedded-wallet project's Paymaster tab with
the existing private endpoint and blank context. The SDK path now uses
`useCdpPaymaster: true`, never the URL, after a database-backed one-shot gas
reservation. Its reservation ID is the provider idempotency key; submitted and
unknown outcomes are durable, and finalized claim evidence closes the attempt.
The local acceptance database and ignored local profile are ready. The earlier
campaign-3 allocation cannot move to this mode because its proxy attempt is
already `UNKNOWN`; use a fresh reviewed allocation for the live proof.
