# Private mainnet direct-USDC canary — 2026-07-27

This is a narrow implementation canary, not a public launch or evidence of
partner adoption. It used no server-funded subsidy and no shared-balance
attribution.

## Scope

- Contract: [`crossword-campaigns-v2.mike.near`](https://nearblocks.io/address/crossword-campaigns-v2.mike.near)
- Owner and operator: `mike.near`
- Pinned NEP-141 USDC contract:
  `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`
- WASM SHA-256:
  `82812887b2e7858621a038574129a01884c81f40b9c3fdb3bbe5479612fbe429`
- Campaign: `mainnet-canary-1785174252178`
- Prize: exactly `100000` USDC atomic units (0.100000 USDC)
- Creator, controller, sponsor, direct winner, refund destination, and recovery
  account: `mike.near`

The campaign was private. Its canonical answer material and solution private
key were held only for the live claim and were not committed, logged, or stored
in the application.

## On-chain evidence

| Operation | Transaction | Result |
| --- | --- | --- |
| Create independent v2 account | [`8NBF…Ex1y`](https://nearblocks.io/txns/8NBFkm1qkhTPuxpaTqYHLuPBpisPPNwLevjFWoX9Ex1y) | New account; legacy contract untouched. |
| Deploy and initialize v2 contract | [`8M3t…A36r`](https://nearblocks.io/txns/8M3tDWwWwRgTQdYdEwV4bZ7kuBxpmrQ1FJXJVmMaA36r) | Pinned owner, operator, and USDC contract verified by `get_config`. |
| Register v2 account for USDC | [`GHSz…2top`](https://nearblocks.io/txns/GHSziU5WN1EUsHqhCYmVh1bhi1qwyiUDgTRp62KW2top) | NEP-145 storage registration completed. |
| Direct USDC funding | [`H4QY…F9tE`](https://nearblocks.io/txns/H4QY7bBVRxSKPr1GHRqjTomDa4waYnJB3pbdnesNF9tE) | Exact 0.100000 USDC entered v2 escrow; campaign became active; `total_reserved` was 100000. |
| Signed direct claim | [`49xV…Gddh`](https://nearblocks.io/txns/49xVNGhuy5X4gFquExtrvrieJzimFaQ9jjfjsqqzGddh) | Correct receiver-bound permit transferred exactly 0.100000 USDC to `mike.near`; claim callback succeeded. |
| Replay attempt | [`BEYz…n6FN`](https://nearblocks.io/txns/BEYzo9NdRPuxXksT8fDCs8PuShibZ2BY8Pds1SX7n6FN) | Rejected on-chain with `ERR_NONCE`; no token transfer occurred. |

Final reads after the successful claim:

- Campaign status: `claimed`; consumed nonce: `0`; next nonce: `1`.
- Contract `total_reserved`: `0`; computed liabilities: `0`; invariant holds.
- Contract USDC balance: `0`.
- `mike.near` USDC balance returned exactly to its pre-canary value.

## What this does and does not prove

This proves new-account deployment, pinned-USDC registration, atomic direct
funding, receiver-bound ed25519 claim verification, successful payout callback,
and replay rejection on mainnet.

It does **not** prove the still-pending 1Click cross-chain funding or payout
routes, winner-controlled route-refund recovery, x402 payment idempotency,
public campaign publication, Render runtime configuration, audit completion, or
production partner support. Those remain launch gates in [QA.md](../QA.md).
