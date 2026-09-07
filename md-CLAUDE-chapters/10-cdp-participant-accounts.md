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
rechecks chain, escrow, recipient, campaign, slot, amount, nonce, deadline,
signature digest, public proxy URL and fresh claim-specific gas permit. It sends
one zero-value claim on `base-sepolia` or `base`, using the reviewed proxy as
`paymasterUrl` and the private permit as `paymasterContext`. There is no user-paid
gas or ordinary transaction fallback. Only finalized server recovery marks paid.

## Configuration and acceptance

All are required before the participant UI is enabled:

- `NEXT_PUBLIC_CDP_PROJECT_ID`: public identifier for the intended CDP project.
- `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`: server-only Secret API Key from that
  same project, authorized to validate end-user access tokens.
- `CDP_PARTICIPANT_AUTH_ENABLED=true` and `BASE_ACCOUNT_ENABLED=true`.
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
