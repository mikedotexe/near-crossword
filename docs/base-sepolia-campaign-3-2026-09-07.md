# Base Sepolia CDP participant campaign 3

Status: funded, finalized, and locally bound/published on 2026-09-07;
participant claim pending.

Campaign `3` is the one-slot replacement reserved for the combined CDP User
Wallet, wallet-challenge, database issuance, sponsored UserOperation, and
finalized reward recovery acceptance. It uses Base Sepolia test assets only and
commits to the exact public terms approved by the application before funding.

## Authorization boundary

Mike granted standing approval on 2026-09-07 for low-balance transfers while
building the live product. Engineering applies that approval only to small Base
Sepolia test-asset operations and incidental testnet gas. It does not authorize
mainnet funds, production activation, a Batches submission, or materially larger
spending.

## Application commitment

| Field | Approved value |
| --- | --- |
| Application campaign | `247c4bff-fb70-4a50-b78e-9d6ed194ab4d` |
| Review revision / status | `2` / approved |
| Private review hash | `f092f1f02b77173432012efc46e3bd2bdf0b93ca14c541356552cb4fc74c168a` |
| Public content hash | `0xe9bcd7414d0e1ec148a2b78789044997180c99149d58c6b27d8e92f77e7a35bb` |
| Canonical public-terms hash | `0x8ceb4b64f564424caf61e0957dc2bd090ce7cf315178f498468f1ed482d97ad8` |
| Approved layout hash | `0x4b39dace2fd83e6c8fdb58782aeee5c7edc178c5df37b309abe4d8780efb9490` |

The local database contains the approved revision and layout, but no funding
binding or publication. Private source, answer, participant, and email material
is not reproduced in this record.

## Recovery prerequisite

Campaign `2` was recovered before reusing its test USDC. The finalized tag
advanced to block `46521565`, beyond recovery block `46521526`. Canonical reads
showed campaign `2` fully consumed by the labeled sponsor recovery, zero escrow
liability, and exactly `1000000` atomic units returned to the sponsor. See the
[campaign 2 recovery record](base-sepolia-campaign-2-2026-09-07.md).

## Exact allowance

The allowance harness required the finalized recovery state, exact escrow
runtime, campaign count `2`, zero reserve, sponsor nonce `6`, sponsor USDC
`1000000`, escrow USDC `0`, and allowance `0`. It simulated and approved exactly
`1000000` atomic units with a maximum total fee estimate of
`0.000000500643438596` test ETH.

| Field | Value |
| --- | --- |
| Transaction | `0x519ae06cd5269f368deab1bd7ab739c9ec8a20947c6c0207559307787cd3d319` |
| Block / canonical hash | `46522022` / `0x21e8a359bb05f70080e7c38761cc8d482ad16921f295e33931f0299dbcc209d4` |
| Transaction nonce | `6` |
| Gas used | `55437` |
| L2 / L1 / total fee | `0.000000332622` / `0.000000004271719298` / `0.000000336893719298` test ETH |
| Resulting allowance | `1000000` atomic units |

## Campaign preflight

The one-shot campaign harness failed closed unless these observations matched:

| Field | Required and observed value |
| --- | --- |
| Chain | Base Sepolia, `84532` |
| Sponsor | `0x3Bb5330334D301Cd1976cA025F0eFDEBeeeE7faA` |
| Escrow | `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304` |
| Escrow runtime hash | `0xebc5371a9a09231045c01981600b619436374e6226048855a6116d1d0c2dce00` |
| Token | Native Base Sepolia USDC, `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Existing campaigns / reserve | `2` / `0` atomic units |
| Sponsor nonce | `7` |
| Sponsor USDC / allowance | `1000000` / `1000000` atomic units |
| Escrow USDC | `0` atomic units |
| Reward / maximum claims | `1000000` atomic units / `1` |
| Eligibility signer | `0xD7F85d32390329cce4e7375d121c912fd3119bF5` |
| Estimated gas / submitted limit | `275713` / `344642` |
| Maximum bounded all-in cost | `0.000002423116055348` test ETH |

The harness independently checked bytecode, immutable token, balances, exact
allowance, nonce, future schedule, application hash recomputation, transaction
simulation, and a `0.00001` test-ETH ceiling covering maximum L2 execution plus
twice the current L1 data-fee estimate before loading the encrypted signer.

## Immutable campaign terms

| Field | Value |
| --- | --- |
| Campaign ID | `3` |
| Reward per claim | `1000000` atomic units, exactly 1 test USDC |
| Maximum claims | `1` |
| Starts at | `1788818400` / 2026-09-07 22:00:00 UTC / 15:00:00 PDT |
| Ends at | `1789423200` / 2026-09-14 22:00:00 UTC / 15:00:00 PDT |
| Claim deadline | `1790028000` / 2026-09-21 22:00:00 UTC / 15:00:00 PDT |
| Terms hash | `0x8ceb4b64f564424caf61e0957dc2bd090ce7cf315178f498468f1ed482d97ad8` |
| Eligibility signer | `0xD7F85d32390329cce4e7375d121c912fd3119bF5` |

The committed JSON is versioned `base-learning-terms:v1` and includes the
application UUID, revision, public-content hash, chain/deployment addresses,
reward schedule, and the verified-email, privacy, and signer policy identifiers.
The creation harness serializes it in the same schema-established key order as
the application and recomputes the hash before simulation or signing.

## Funding transaction

| Field | Value |
| --- | --- |
| Transaction | `0x4c9199cfaa7f8c138bc64da55a2ab7cddbe7a8eab77e9f7adfff99b13a1cbd99` |
| Status | success |
| Block / canonical hash | `46522033` / `0x997b739723de77b81453c2fd254580abdfdec4e282b19a360512b8f9f21851b2` |
| Transaction nonce | `7` |
| Gas limit / used | `344642` / `259049` |
| Effective gas price | `6000000` wei |
| L2 / L1 / total fee | `0.000001554294` / `0.000000005188293718` / `0.000001559482293718` test ETH |

Canonical inclusion reads showed `campaignCount() = 3`, `totalReserved() =
1000000`, escrow USDC `1000000`, sponsor USDC and allowance `0`, and the exact
stored terms above. No duplicate transaction was sent.

## Finality reconciliation

The finalized tag advanced to block `46522071`, hash
`0xdba53ca9b380763ffa72c35d1ac76460a6aef2db45cf2316f3c4cd9c699dacc3`,
beyond funding block `46522033`. Hash-pinned reads verified:

- the funding receipt hash matches canonical block
  `0x997b739723de77b81453c2fd254580abdfdec4e282b19a360512b8f9f21851b2`
- runtime hash
  `0xebc5371a9a09231045c01981600b619436374e6226048855a6116d1d0c2dce00`
  and the immutable native Base Sepolia USDC token
- campaign count `3`, total reserve and escrow balance `1000000`, sponsor USDC
  and allowance `0`, and sponsor nonce `8`
- exact sponsor, reward, schedule, terms hash, signer, signer epoch `1`, funded
  and outstanding amount `1000000`, zero refunds/payments, unused slot `0`, and
  unpaused/open campaign state

## Local publication

The dry-run-first binding harness accepted only local database `near_crossword`,
owner `1`, application campaign `247c4bff-fb70-4a50-b78e-9d6ed194ab4d`, review
revision `2`, the exact terms/layout hashes above, and the finalized untouched
campaign state. It then bound on-chain campaign `3` and published the local
lesson with publication hash
`0xd3988864ebb85055be484ba49647be36dd931152cef4fec6d208dd2e586d90da`.
A second dry run reported `alreadyBound: true` and `alreadyPublished: true` with
the same finalized state. No private source, answer, email, or participant data
was emitted.

## Remaining acceptance

1. Add `https://crossword.xyz` to the CDP project's allowed domains when the
   authenticated dashboard is available.
2. Use the returning email-backed CDP participant to complete wallet challenge,
   claim issuance, sponsored submission, finalized recovery, and duplicate
   behavior checks.

No participant claim, provider sponsorship request, production setting, mainnet
transfer, credential print, or Batches submission occurred in this funding step.
