# NEAR mainnet traction

Audited September 8, 2026 against NEAR mainnet. This chapter records the legacy
product's historical usage separately from the current Base MVP's sponsor and
participant traction.

## Result

| Contract | Distinct puzzles solved | Successful payouts | NEAR paid |
| --- | ---: | ---: | ---: |
| `crossword.puzzle.near` | 138 | 135 | 2,213 |
| `shitzu.crossword.puzzle.near` | 22 | 22 | 410 |
| **Total** | **160** | **157** | **2,623** |

The first verified solve was June 8, 2022 and the last was January 6, 2024.
Three puzzles on `crossword.puzzle.near` were solved but have no successful
claim-finalization event. Both contracts returned zero currently unsolved
puzzles at final blocks `214852865` and `214852874` during the reproducible run.

## Method

The repeatable audit is [`scripts/audit-near-mainnet-history.ts`](../scripts/audit-near-mainnet-history.ts).
It uses FastNear's indexed account history and transaction lookup APIs, then a
final-state RPC view call:

1. Read every function-call transaction received by each contract and retrieve
   the full receipt tree.
2. Count a solve only when a successful contract receipt logs `Puzzle ...
   solved`, then normalize the logged 33-byte puzzle key and require uniqueness.
3. Count a payout only when a successful callback logs `Puzzle ... claimed`.
4. Require the logged reward to equal successful value leaving the contract in
   that transaction. This includes direct NEAR transfers and NEAR attached to
   the account-creation call used by the new-account claim path.
5. Require every paid puzzle key to have a corresponding successful solve.

All 160 solve keys and all 157 claim keys were distinct. Every claim matched a
solve and its exact outbound receipt value. The 157 matching rewards sum to
exactly 2,623 NEAR.

Run the audit without putting the API key in a command or URL:

```bash
yarn near:audit-mainnet --env-file .env
```

The script reads `FASTNEAR_API_KEY`, sends it as a Bearer header, and does not
print it. FastNear documents the same authenticated backend pattern in its
[authentication guide](https://docs.fastnear.com/auth), the indexed history in
the [Transactions API](https://docs.fastnear.com/tx), and final
contract reads in the [RPC reference](https://docs.fastnear.com/rpc).

## Public evidence

- [`crossword.puzzle.near`](https://nearblocks.io/address/crossword.puzzle.near)
- [`shitzu.crossword.puzzle.near`](https://nearblocks.io/address/shitzu.crossword.puzzle.near)
- [First verified solve](https://nearblocks.io/txns/DMPA9gBRD1RX4zBf7DsRVvJ3F2JY8Z4pjffVeYZPy2qu)
- [Last verified solve](https://nearblocks.io/txns/2X3hFh7iP9q2ytALJrZXsxHDHxhC9XiKLRgzXkF5tWr7)
- [Last verified payout](https://nearblocks.io/txns/C3uJxq7phbyh9kNYKfxWkJvq3Z2UEtPeqzYH4nMxdqh1)

## Claim boundary

Safe public wording:

> The original NEAR version recorded 160 distinct mainnet puzzle solves and 157
> successful payouts totaling 2,623 NEAR between June 2022 and January 2024.

These figures are historical winner/payout events, not 160 unique people, 160
current users, sponsor revenue, or traction for the new Base product. The legacy
contract awarded the first successful solver, so the chain cannot reveal all
attempts or everyone who participated without winning.
