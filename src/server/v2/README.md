# Crossword Campaigns v2 backend

This directory contains the workflow ledger and route services for sponsor-funded
crossword campaigns. Postgres records workflow intent and evidence; the v2
contract remains authoritative for escrow and claims.

## Runtime modes

Production fails closed unless these are configured:

- `DATABASE_URL`
- `NEXT_PUBLIC_APP_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `RESEND_API_KEY`
- `V2_CONTRACT_ID`
- `NEXT_PUBLIC_V2_CONTRACT_ID`
- `V2_USDC_ASSET_ID`
- `V2_USDC_CONTRACT_ID`
- `NEXT_PUBLIC_V2_USDC_CONTRACT_ID`
- `V2_NEAR_NETWORK`
- `NEXT_PUBLIC_NEAR_NETWORK`
- `V2_TRUSTED_CLIENT_IP_HEADER`

The API never silently substitutes a server wallet or server-funded prize.
`V2_FUNDING_MODE=mock` enables an in-memory repository only when
`NODE_ENV != production`. Mock funding quotes are deterministic, move no funds,
and say so in their response. Creator authentication in this mode requires an
explicit `x-demo-user-id` header. Restarting the process erases all mock data.

1Click uses the fixed official `https://1click.chaindefuser.com/v0` API. A
partner JWT can be supplied as `ONE_CLICK_JWT`; it is never returned or logged.
The JWT is sent on quote and status requests. The pinned official 1Click SDK
verifies every non-dry quote signature before a deposit address is accepted.
Status responses must echo that exact signed quote, including its correlation,
request, address, and memo. Exact-output funding must quote and settle the full
USDC principal, and `SUCCESS` is accepted only with the matching
`swapDetails.amountOut` and a destination-chain receipt. `INCOMPLETE_DEPOSIT`
remains non-allocatable and is reconciled until the provider refunds, fails, or
settles it completely.

For cross-chain funding, the quote response withholds the 1Click deposit
package until the creator submits the quote-bound
`authorize_external_funding` call from the same NEAR account fixed as creator,
controller, and refund account. A confirmation endpoint independently reads
the final contract authorization and compares every immutable field before it
reveals the deposit amount/address. The operator later activates only that
campaign ID and funding reference; it never supplies campaign terms.

The adapters quote and observe transfers but do not broadcast deposits,
contract calls, or refunds. Finalized observations enqueue deduplicated jobs for
a separately authorized reconciler. Winner payouts remain `PAYING` and the
campaign remains `CLAIMING` after USDC reaches a 1Click deposit address. They
become `PAID`/`CLAIMED` only after a downstream receipt is observed. A terminal
refund is recorded separately as `RECOVERED`, with the receipt and the
winner-controlled NEAR recovery account; a provider failure without recovery
does not masquerade as a completed campaign. The terminal claim and campaign
release are committed in one ledger transaction. A retry also repairs the
historical `PAID`/`RECOVERED` plus `CLAIMING` split state without contacting the
provider again or counting released principal as escrow.

Paid AI generation is enabled only with `X402_ENABLED=true`,
`X402_FACILITATOR_URL`, `X402_PAY_TO`, `X402_NETWORK`,
`X402_ASSET` (or `V2_USDC_CONTRACT_ID`), and `ANTHROPIC_API_KEY`. It uses x402
v2, the NEAR exact scheme, and a required `payment-identifier`. Generation runs
after verification and settlement runs only after generation succeeds. The
result is durably cached by payment identifier; a retry with a different body is
rejected. Before settlement, the ledger persists a hash of the exact
`PAYMENT-SIGNATURE`, the generated result, and sanitized payment requirements.
An interrupted settlement can resume only with that exact signature; an
ambiguous result remains held for reconciliation and cannot expire into a
second charge. Completed payment identifiers are retained as durable receipts.
The paid response returns a versioned receipt handle containing only its
payment identifier. If campaign creation supplies that handle, the server locks
and independently verifies the completed idempotency record, derives a receipt
digest from its stored result and settlement, and links sanitized
identifier/digest/network/reference evidence to the campaign. A database
constraint makes the handle single-use across campaigns. Payment signatures,
payer identity, prompts, and generated answers are never copied into campaign
or operation-event evidence. Manual campaigns do not require a handle.
Mock mode emits a non-settling 402 challenge and never treats a header as proof
of payment.

The create page includes a keyless application-side payer adapter for
`@fastnear/wallet`. It offers only wallets that advertise timeout-aware NEP-366
delegate signing, then uses `@x402/near` to construct the standard
`PAYMENT-SIGNATURE` header. The wallet owns the full-access key and shows the
exact transfer; no private key enters application state or storage. An embedding
host may instead provide the same narrow browser-payer interface. With neither
available, AI generation fails with an explicit connection prerequisite.

## API envelopes

- `GET /api/v2/campaigns` → `{ campaigns, total }`
- `POST /api/v2/campaigns` and `PATCH/GET /api/v2/campaigns/:id` → `{ campaign }`
- `POST /api/v2/campaigns/:id/funding-quotes` → `{ fundingOrder }`
- `POST /api/v2/funding-orders/:id/authorization` → verified deposit package
- `POST /api/v2/funding-orders/:id/deposit-receipt` → independently verified
  final direct-funding transaction receipt
- `GET /api/v2/funding-orders/:id?refresh=true` → `{ fundingOrder }`
- `POST /api/v2/campaigns/:id/claim-quotes` → `{ claim }`
- `POST /api/v2/campaigns/:id/claims` and `GET /api/v2/claims/:id` → `{ claim }`
- `POST /api/v2/campaigns/:id/cancel` → creator-only pre-open cancellation
- `POST /api/v2/campaigns/:id/refund` → rate-limited, permissionless expired-campaign refund relay
- `GET /api/v2/campaigns/:id/evidence` → sanitized funding and final-contract evidence
- `GET /api/v2/reconciliation/solvency` → read-only contract/token/ledger reconciliation
- `GET /api/v2/tokens` → `{ escrowAsset, tokens }`
- `POST /api/v2/ai/generate` → `{ entries, receiptHandle, payment, cached }`
  after settlement; campaign creation accepts the minimal `receiptHandle`

Error responses use
`{ error: { code, message, details? }, requestId }`.

Campaign creation requires a client-generated UUID so the browser can derive an
ID-bound solution key before sending the request. Public puzzle data is accepted
as either `{ width, height, clues }` or `{ rows, columns, entries }`; answer,
seed, solution, and private-key fields are rejected recursively at entry level.
The solution public key is base64 raw 32 bytes.

Claim quotes return `payoutDigest`, `nonce`, `deadlineMs`, `receiverId`,
`escrowPrincipalAmount`, and the provider's separate
`estimatedDeliveryAmount`/`estimatedDeliveryAsset` inside the `claim` object.
For 1Click, the signed permit and durable claim expiry use the provider's
deadline when it is earlier than the requested quote window. Proof submission
accepts base64 raw 64-byte `signature`, base64 raw 32-byte `payoutDigest`, and
decimal-u64 `nonce` and `deadlineMs`. Multiple quotes may coexist; an atomic
campaign/claim transition selects the first submitted proof.

Funding and claim quote idempotency reserves a hash of the complete normalized
request before contacting a quote provider. A retry replays the durable order or
claim, rejects a changed request, or reports that the original quote is still in
progress. Provider quotes are bounded by the reservation deadline, so a process
failure cannot create two simultaneously valid quotes for the same key.

The expired-campaign refund relay accepts only `expectedVersion`; it cannot
provide a receiver or alter the campaign's immutable contract refund account.
Exact retries and concurrent relays coalesce onto one append-only event and one
deduplicated refund job. Cancellation before opening remains creator-only.

Anonymous claim polling returns only lifecycle state and allowlisted receipt
fields; payout destinations, proof signatures, recovery accounts, and provider
instructions remain private. The public evidence API deliberately omits
deposit addresses, refund destinations, provider instructions, internal actor
IDs, payment authorizations, payer identity, prompts, generated answers, and
workflow idempotency keys. It may publish the sanitized x402 creation receipt
identifier, digest, network, and settlement reference linked to a campaign.
The solvency API performs only final-state view calls: it compares contract
`total_reserved`, the escrow contract's USDC balance, and live workflow-ledger
escrow liabilities without signing or submitting a transaction. Principal
already transferred from escrow into a 1Click route is reported separately as
`routingInFlightAmountAtomic` until a downstream settlement/refund receipt is
recorded.
