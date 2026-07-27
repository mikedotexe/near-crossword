---
name: crossword-campaigns
description: >
  Create, inspect, solve, and reconcile sponsor-funded Crossword Campaigns
  using pinned NEAR USDC escrow, NEAR Intents/1Click routing, and x402-paid
  creator services. Use for free-to-play reward puzzles and their evidence.
metadata:
  product: Crossword Campaigns
  escrow: deployment-pinned native USDC on NEAR
  contract_version: v2
---

# Crossword Campaigns

Use this project when a user wants to:

- create a sponsored, winner-take-all crossword campaign;
- fund a complete prize directly on NEAR or through a supported 1Click route;
- solve anonymously and select a supported payout destination;
- inspect escrow, funding, claim, expiry, or refund evidence;
- buy one discrete AI-assisted puzzle draft through x402.

## Boundaries

- Solving is free. Paid entry, raffles, pooled prizes, and public first-N
  payouts are not supported.
- “Any asset” means an asset and viable route returned by the current 1Click
  catalog/quote API.
- x402 may pay for a creator service. It may not fund a prize implicitly or
  authorize arbitrary merchant spending.
- Only the deployment-pinned native USDC contract can be escrowed.
- A creator knows the puzzle solution and could collude or self-claim. Do not
  describe the campaign as trustless with respect to its sponsor.
- The legacy `crossword.puzzle.near` contract is claim-only and isolated under
  `/legacy`; never migrate, upgrade, or spend from it as part of a v2 workflow.

## Safe workflow

1. Build or edit the puzzle while it is a draft.
2. Derive the versioned, campaign-bound solution public key in the browser.
3. Freeze the public puzzle, public key, canonical content hash, campaign
   window, prize amount, and recovery destination.
4. Request a short-lived funding quote.
5. Before any live transfer, ask the user to confirm the network, asset, exact
   amount, payer, deposit destination, and refund account.
6. Publish only after both the workflow ledger and v2 contract prove the full
   USDC prize is reserved.
7. Let the solver choose a direct NEAR or live-catalog cross-chain payout.
8. Bind the quote receiver, payout digest, nonce, and deadline into the local
   claim signature.
9. Track the contract transfer and, for 1Click, downstream settlement or
   winner-controlled refund.
10. Retain sanitized evidence and reconcile contract reserved value, token
    balance, and live ledger liabilities.

## Privacy and key handling

Puzzle answers and solution private keys remain in transient browser memory.
Browser storage may contain only per-campaign letters/progress. Never request,
log, transmit, or persist operator private keys, payment credentials, solution
signatures, raw answers, or funded-wallet data.

## Runtime modes

`V2_FUNDING_MODE=mock` is a local, non-production simulator. It moves no funds
and does not accept a mock x402 header as payment. Production requires Postgres,
the v2 contract ID, and both pinned USDC identifiers.

All chain mutations are additionally gated by
`V2_CHAIN_BROADCAST_ENABLED=true`. Do not enable it without the explicit live
transaction confirmation described above.

Use `README.md` for architecture and commands, `QA.md` for evidence gates,
`contract-v2/README.md` for the exact claim encoding, and
`docs/launch-runbook.md` for staging and approved mainnet canaries.
