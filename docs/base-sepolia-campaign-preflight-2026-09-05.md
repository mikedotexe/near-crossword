# Base Sepolia one-slot campaign preflight, 2026-09-05

Status: one-slot campaign created and funded after Mike's explicit approval.
Sponsored claim, provider request and fresh wallet claim have not been performed.

## Signer setup

| Field | Value |
| --- | --- |
| Eligibility signer address | `0xD7F85d32390329cce4e7375d121c912fd3119bF5` |
| Keychain service | `xyz.crossword.base-sepolia.eligibility-signer` |
| Keychain account | `base-sepolia-eligibility-signer` |
| Local env | `BASE_ELIGIBILITY_PRIVATE_KEY` is present only in ignored `.env.local` |
| Funding authority | none; this signer should not hold ETH or USDC |

The eligibility signer can authorize rewards but cannot move assets by itself.
It must remain separate from the deployer/sponsor, CDP paymaster endpoint and
participant wallet.

## Approval transaction preflight

Mike explicitly approved this transaction with:
`approved to approve 1 Base Sepolia test USDC for the escrow`.

| Field | Value |
| --- | --- |
| Chain | Base Sepolia, chain 84532 |
| From | `0x3Bb5330334D301Cd1976cA025F0eFDEBeeeE7faA` |
| Token | Native Base Sepolia USDC, `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Function | `approve(address,uint256)` |
| Spender | `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304` |
| Amount | `1000000` atomic units, exactly 1 test USDC |
| Current allowance | 0 |
| Deployer nonce | 1 |
| Deployer ETH balance | 0.000088826683397187 test ETH |
| Deployer USDC balance | 1 native test USDC |
| Estimated gas | 56,240 |
| Suggested gas limit | 77,488 |
| Estimated max fee per gas | 7,000,000 wei |
| Estimated max priority fee | 1,000,000 wei |
| Suggested max cost | 0.000000542416 test ETH |

## Approval transaction result

| Field | Value |
| --- | --- |
| Transaction hash | `0xf472670687b4657841cf4cf7d10c2d5049b26c3e11d0e591f346392f291065f2` |
| Status | success |
| Block | `46441008` |
| Block hash | `0xb89979e9d99a391b9c019828f27de1890ee11b2aab996a66871ad897329e5b32` |
| Gas used | 55,437 |
| Transaction gas limit | 77,488 |
| Effective gas price | 6,000,000 wei |
| Fee paid | 0.000000332622 test ETH |
| Deployer nonce after approval | 2 |
| Deployer ETH after approval | 0.000088488025569621 test ETH |
| Deployer USDC after approval | 1 native test USDC |
| Escrow allowance after approval | `1000000` atomic units |
| Later finality observation | Approval block `46441008` was finalized before `createCampaign` preflight; finalized block `46443622` |

The allowance only let the deployed escrow pull exactly 1 test USDC. It was
spent to zero by the `createCampaign` transaction below.

## `createCampaign` transaction preflight

Mike explicitly approved this transaction with:
`approved to create the one-slot Base Sepolia test campaign`.

The schedule was recomputed immediately before signing because the earlier
preflight's start time had gone stale.

| Field | Value |
| --- | --- |
| Chain | Base Sepolia, chain 84532 |
| From / sponsor / refund address | `0x3Bb5330334D301Cd1976cA025F0eFDEBeeeE7faA` |
| Contract | `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304` |
| Function | `createCampaign(CampaignTerms)` |
| Reward per claim | `1000000` atomic units, exactly 1 test USDC |
| Maximum claims | 1 |
| Starts at | `1788658310` / 2026-09-06 01:31:50 UTC / 2026-09-05 18:31:50 PDT |
| Ends at | `1788679910` / 2026-09-06 07:31:50 UTC / 2026-09-06 00:31:50 PDT |
| Claim deadline | `1788766310` / 2026-09-07 07:31:50 UTC / 2026-09-07 00:31:50 PDT |
| Terms hash | `0x6f544fbc2b3e1f76ab16fa36aea6b2cd6c76c306bd64a941d91d73968bb01e89` |
| Eligibility signer | `0xD7F85d32390329cce4e7375d121c912fd3119bF5` |
| Current allowance | `1000000` atomic units |
| Current campaign count | 0 |
| Current total reserved | 0 |
| Deployer nonce | 2 |
| Estimated gas | 293,050 |
| Suggested gas limit | 371,660 |
| Estimated max fee per gas | 7,000,000 wei |
| Estimated max priority fee | 1,000,000 wei |
| Suggested max cost | 0.00000260162 test ETH |

Public terms commitment string:

```text
Crossword Base Sepolia one-slot sponsored-claim acceptance campaign|date=2026-09-05|chainId=84532|escrow=0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304|token=0x036CbD53842c5426634e7929541eC2318f3dCF7e|rewardAtomic=1000000|maxClaims=1|startsAt=1788658310|endsAt=1788679910|claimDeadline=1788766310|eligibilitySigner=0xD7F85d32390329cce4e7375d121c912fd3119bF5
```

## `createCampaign` transaction result

| Field | Value |
| --- | --- |
| Transaction hash | `0x1a1f49f3c06d37c1fe2295ad0188f0e27e78a8b1c0b4636a9e7f0f4175bf6182` |
| Status | success |
| Campaign ID | `1` |
| Block | `46444150` |
| Block hash | `0x6f5c4d4435f429d62e0304dc3621231b305db4c67e82a3745c2dbe70d425f66c` |
| Transaction index | 12 |
| Gas used | 276,149 |
| Transaction gas limit | 371,660 |
| Effective gas price | 6,000,000 wei |
| Max fee per gas | 7,000,000 wei |
| Max priority fee per gas | 1,000,000 wei |
| Fee paid | 0.000001656894 test ETH |
| Deployer nonce after creation | 3 |
| Deployer ETH after creation | 0.000086822276296911 test ETH |
| Deployer USDC after creation | 0 native test USDC |
| Escrow USDC after creation | `1000000` atomic units |
| Escrow allowance after creation | 0 |
| Escrow `campaignCount()` | 1 |
| Escrow `totalReserved()` | `1000000` |
| Campaign `outstanding(1)` | `1000000` |
| Campaign signer epoch | 1 |
| Campaign paid/refunded | 0 paid, 0 refunded |
| Campaign flags | not paused, not closed |
| Latest/finalized observation | Latest `46444426`, finalized `46443973`; campaign block not finalized yet |

The campaign is funded and ready for the fresh-wallet sponsored-claim acceptance
path after finality catches up and the hosted wallet/provider wire checks pass.
