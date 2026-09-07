# Base Sepolia campaign 2 mismatch recovery

Status: created, funded, finalized, and safely recovered on 2026-09-07.

This one-slot Base Sepolia campaign was initially intended for the combined CDP
User Wallet acceptance. Before any participant authorization was issued, local
binding exposed that its human-readable terms string did not equal the
application review's canonical public-terms commitment. The application
correctly refused the mismatch. The slot was then consumed by an explicitly
labeled, direct-gas recovery claim returning the full test USDC to the sponsor.

## Authorization boundary

Mike granted standing approval on 2026-09-07 for low-balance transfers while
building the live product. Engineering applies that approval only to small Base
Sepolia test-asset operations and incidental testnet gas. It does not authorize
mainnet funds, production activation, a Batches submission, or materially larger
spending.

## Preflight

The transaction harness failed closed unless all of these observations matched:

| Field | Required and observed value |
| --- | --- |
| Chain | Base Sepolia, `84532` |
| Sponsor | `0x3Bb5330334D301Cd1976cA025F0eFDEBeeeE7faA` |
| Escrow | `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304` |
| Escrow runtime hash | `0xebc5371a9a09231045c01981600b619436374e6226048855a6116d1d0c2dce00` |
| Token | Native Base Sepolia USDC, `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Existing campaigns / reserve | `1` / `0` atomic units |
| Sponsor nonce | `4` |
| Sponsor USDC / allowance | `1000000` / `1000000` atomic units |
| Escrow USDC | `0` atomic units |
| Reward / maximum claims | `1000000` atomic units / `1` |
| Eligibility signer | `0xD7F85d32390329cce4e7375d121c912fd3119bF5` |
| Estimated gas / submitted limit | `275713` / `344642` |
| Fee caps | `7000000` max fee and `1000000` priority fee, wei per gas |
| Maximum bounded L2 execution cost | `0.000002412494` test ETH |

The harness independently checked escrow bytecode, immutable token, current
balances, exact allowance, nonce, schedule validity, transaction simulation,
and a `0.00001` test-ETH L2 execution-cost ceiling before loading the encrypted
deployer signer. That send-time check did not separately estimate Base's L1
data fee; the corrected harness now adds twice the current L1 estimate to its
total ceiling.

## Immutable campaign terms

| Field | Value |
| --- | --- |
| Campaign ID | `2` |
| Reward per claim | `1000000` atomic units, exactly 1 test USDC |
| Maximum claims | `1` |
| Starts at | `1788810444` / 2026-09-07 19:47:24 UTC / 12:47:24 PDT |
| Ends at | `1789069644` / 2026-09-10 19:47:24 UTC / 12:47:24 PDT |
| Claim deadline | `1789674444` / 2026-09-17 19:47:24 UTC / 12:47:24 PDT |
| Terms hash | `0x3b60ea34ab812431829219dd6ffb9947198cc2068cc9373604cff73bff88594e` |
| Eligibility signer | `0xD7F85d32390329cce4e7375d121c912fd3119bF5` |

Public terms commitment string:

```text
Crossword Base Sepolia CDP User Wallet one-slot acceptance campaign|version=1|chainId=84532|escrow=0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304|token=0x036CbD53842c5426634e7929541eC2318f3dCF7e|rewardAtomic=1000000|maxClaims=1|startsAt=1788810444|endsAt=1789069644|claimDeadline=1789674444|eligibilitySigner=0xD7F85d32390329cce4e7375d121c912fd3119bF5
```

## Transaction result

| Field | Value |
| --- | --- |
| Transaction | `0xb8c25e901974647e86c18ff98d227fed29da39c48c17862946191b9cf27ba803` |
| Status | success |
| Block | `46520630` |
| Block hash | `0xe98f82c93d97f457d50fd49a72de19044ae44e15db9a9989be247763c3f2b53e` |
| Transaction nonce | `4` |
| Gas limit / used | `344642` / `259049` |
| Effective gas price | `6000000` wei |
| L2 execution fee | `0.000001554294` test ETH |
| L1 data fee | `0.000000008216468571` test ETH |
| Total fee | `0.000001562510468571` test ETH |
| Post-transaction sponsor nonce | `5` |

The `CampaignFunded` event contains campaign `2`, the pinned sponsor/token,
`1000000` funded atomic units, signer epoch `1`, and the terms above.

## Reconciled state

Independent reads after inclusion returned:

- `campaignCount() = 2`
- `totalReserved() = 1000000`
- `outstanding(2) = 1000000`
- sponsor USDC and allowance are both `0`
- escrow USDC is `1000000`
- slot `0` is unused; paid and refunded amounts are `0`
- the campaign is not paused or closed

The first immediate postflight read reached a lagging public RPC replica and
reported campaign `2` as unknown. No retry transaction was sent. Subsequent
nonce, event, balance, and campaign reads all agreed on the successful single
transaction. The harness now retries postflight reads at the receipt block to
tolerate that replica lag and includes a doubled L1 fee estimate in future
total-cost checks.

Latest/finalized at the first postflight observation were `46520729` and
`46520143`. The finalized tag later advanced to block `46520808`, beyond the
campaign block. At that finalized block, the transaction receipt and canonical
block hash both equal
`0xe98f82c93d97f457d50fd49a72de19044ae44e15db9a9989be247763c3f2b53e`.
Hash-pinned reads returned the exact runtime code, campaign terms, reserve,
outstanding amount, unused slot, balances, and zero allowance recorded above.

## Binding mismatch

The intended local application campaign is
`247c4bff-fb70-4a50-b78e-9d6ed194ab4d`. Its approved revision `2` commits to
canonical terms hash
`0x8ceb4b64f564424caf61e0957dc2bd090ce7cf315178f498468f1ed482d97ad8`.
Campaign `2` instead stores
`0x3b60ea34ab812431829219dd6ffb9947198cc2068cc9373604cff73bff88594e`.
`BaseRewardIssuer.matchingState` therefore rejected binding exactly as designed.

No participant allocation, participant signature, or paymaster request was made.
The replacement process prepared and approved the exact application review
before creating another campaign.

## Recovery result

The recovery harness required finalized campaign funding, the exact runtime and
campaign terms, one unused slot, the dedicated eligibility signer, zero prior
payments/refunds, exact balances, sponsor nonce `5`, successful simulation, and
a total fee estimate below `0.00001` test ETH. It signed a one-use claim with:

| Field | Value |
| --- | --- |
| Participant ID | `0xc2cb3a280074d729e0f7434c625347b9d0960c48150e28a80eb7f5475c95a56c` |
| Recipient | Sponsor, `0x3Bb5330334D301Cd1976cA025F0eFDEBeeeE7faA` |
| Slot / amount | `0` / `1000000` atomic units |
| Claim deadline | `1788816600` |
| Signature hash | `0x7108213f58f9f753e794a6f2b48d9b01c11b3d03b964d9d152b0f180d60636ab` |
| Transaction | `0x865c8aaca90733d4b5ec1d390e66d3aa01287d1420559d4b37ce1cae7d704224` |
| Block / canonical hash | `46521526` / `0xf9cd8718b0490ea3799f43866dac92d4b178b9bb7aa5457f09749800d5e2d480` |
| Gas used | `138564` |
| L2 / L1 / total fee | `0.000000831384` / `0.000000011874809629` / `0.000000843258809629` test ETH |

The finalized tag advanced to block `46521565`, beyond recovery inclusion.
Canonical reads then showed campaign `2` paid count `1`, outstanding and total
reserved amounts `0`, used slot and participant markers, escrow USDC `0`, and
sponsor USDC `1000000`. The first receipt lookup briefly returned a zero block
hash from one RPC replica; independent receipt, raw RPC, and canonical block
reads converged on the hash above, and no retry transaction was sent.

## Replacement step

Campaign `3` is the correctly committed replacement for participant acceptance.
Its separate dated record contains the exact review, funding, and finality
evidence. Add `https://crossword.xyz` to the CDP project's allowed domains when
the authenticated dashboard is available, then use campaign `3` only for the
returning email-backed participant flow.

No real participant claim, provider sponsorship request, production setting,
mainnet transfer, credential print, or Batches submission occurred in this step.
