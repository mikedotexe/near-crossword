# Crossword Campaigns v2 acceptance matrix

This matrix separates automated evidence from staging and mainnet gates. A mock
quote, unit test, or rendered page is not settlement evidence.

## Automated on every change

| Area | Required evidence |
| --- | --- |
| Contract | Direct funding, external allocation, duplicate references, wrong amounts, schedules, signature validity, receiver substitution, replay, expired permits, concurrent solvers, failed callbacks, retry, expiry, double-refund prevention, and solvency invariants |
| Workflow API | Authentication, canonical immutable revisions, quote expiry, principal/fee separation, idempotency reuse, duplicate observations, worker retry/restart, reconciliation, and sanitized events |
| Browser | Manual creation, x402 challenge behavior, campaign browsing, mobile play, per-campaign reload recovery, payout selection, private-draft honesty, and legacy access |
| Security | SSRF/private-network blocking, payload limits, rate limiting, secret redaction, unauthorized mutation rejection, answer-field rejection, canonical hash checking, and absence of private keys in logs/local storage |
| Build | ESLint, TypeScript, Next production build, Rust format/clippy/tests, and release WASM |

Run:

```bash
yarn lint
yarn typecheck
yarn audit:production
yarn test:unit
yarn test:browser
cargo fmt --manifest-path contract-v2/Cargo.toml --check
cargo clippy --manifest-path contract-v2/Cargo.toml --locked --all-targets -- -D warnings
yarn test:contract:v2
yarn contract:v2:build
yarn build
```

## Current local implementation evidence

Independently rerun on **2026-07-27** with broadcasting disabled and no live
funds:

- ESLint, strict TypeScript, and the Next.js 15.5.21 production build pass.
- Unit tests pass **141/141**, including payment replay, external-funding
  authorization, direct receipt verification, workflow recovery, privacy, and
  solvency checks.
- Browser workflows pass **8/8** across desktop and mobile Chromium. A separate
  in-app review covered the homepage, creator form, mobile menu, crossword
  layout, input, and reload recovery with no console warnings.
- Contract v2 passes formatting, clippy with warnings denied, **30/30** tests,
  doc tests, and the locked release WASM build.
- Migrations `001` through `008` apply cleanly to a fresh Postgres database and
  a second run is idempotent. All 49 constraints and 37 indexes in that
  throwaway schema validate.
- A recursive production dependency audit has no actionable high or critical
  finding. Its remaining entries are an unfixed low-severity `elliptic`
  transitive from NEAR's native secp256k1 stack and a deprecation-only
  `node-domexception` transitive from the AI SDK.

This is implementation evidence, not staging or settlement evidence. The gates
below remain required.

## Staging acceptance

Use a separate v2 testnet contract and a pinned test token. Never point staging
at `crossword.puzzle.near`.

- Create a manual puzzle and verify only its public key and canonical content
  hash reach the API.
- Request direct funding and inspect the exact `ft_transfer_call` receiver,
  amount, tagged message, opening, expiry, and refund account before signing.
- Confirm the ledger observes the final campaign state without a browser being
  left open.
- Publish only after the on-chain reserved amount equals the full prize.
- Complete a direct claim and retain the contract transaction and token receipt.
- Submit two valid proofs concurrently; exactly one may enter the claim path.
- Exercise a failed token callback and confirm the campaign reopens with a new
  nonce.
- Let a campaign expire, invoke permissionless refund, and verify the locked
  creator recovery account receives it.
- Cancel a scheduled campaign before opening and verify its immutable refund
  destination.
- Restart the worker during each external-state wait and verify reconciliation
  continues without duplicate calls.
- Verify contract `total_reserved`, contract token balance, and live ledger
  liabilities agree.

## Mainnet acceptance — explicit approval required

1Click provides no testnet environment. Do not start these checks without human
confirmation of network, asset, exact amount, payer, recipient, recovery
account, and refund address.

### Completed private direct-USDC canary — 2026-07-27

The independent v2 contract was deployed at
`crossword-campaigns-v2.mike.near`. A private 0.100000-USDC campaign was
funded directly, claimed back to its approved `mike.near` recovery account, and
rejected on replay with `ERR_NONCE`. Final contract liabilities and USDC balance
were both zero. The transaction links, release hash, and exact boundary are in
[`docs/mainnet-canary-2026-07-27.md`](docs/mainnet-canary-2026-07-27.md).

This proves only the direct-USDC path below; it does not close the remaining
mainnet gates.

- Fund at least one capped campaign from a non-NEAR origin into v2 USDC escrow.
- Complete one direct NEAR USDC winner payout.
- Complete one cross-chain payout and retain both the contract transfer and
  downstream 1Click settlement receipt.
- Exercise one deliberately expiring/refunding 1Click route and prove funds
  return to the winner-controlled recovery account.
- Make one x402-paid AI generation, retry with the same payment identifier, and
  prove it returns the durable result without a second charge. Link its minimal
  receipt handle to exactly one campaign, reject reuse, and confirm public
  evidence contains only the sanitized identifier/digest/network/reference—not
  prompts, answers, payer identity, authorization, or payment headers.
- Verify the public campaign page labels the prize “Funded and locked” only
  after contract evidence exists.
- Confirm there is no server-funded prize subsidy and no shared balance used to
  “verify” an individual deposit.

## Launch gate

Launch remains blocked until all of the following are attached to a dated
release record:

- Contract audit and reproducible release WASM hash.
- Testnet and approved small-value mainnet transaction hashes.
- Replay, race, expiry, callback failure, and refund evidence.
- Live funding and payout receipts from the flagship cross-chain campaign.
- One x402 generation receipt plus an idempotent replay.
- Accounting reconciliation: reserved contract amount, token balance, and
  workflow liabilities.
- Named NEAR and partner owners, escalation paths, and go/no-go authority.
- Legacy reconciliation for the claim-only keys and funds at
  `crossword.puzzle.near`.
- Upgrade authority transferred to the chosen multisig after beta validation.

## Explicit non-evidence

The illustrative campaign catalog, deterministic adapter results, mock x402
challenge, testnet fixture tokens, green builds, and an open pull request are
useful development evidence. None demonstrates mainnet liquidity, production
settlement, adoption, or partner support.
