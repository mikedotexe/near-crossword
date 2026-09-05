# Base Sepolia one-slot campaign preflight, 2026-09-05

Status: USDC approval sent after Mike's explicit approval. `createCampaign`,
sponsored claim, provider request and fresh wallet claim have not been performed
from this preflight.

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
| Latest/finalized observation | Latest `46441024`, finalized `46440531`; approval block not finalized yet |

The deployer still holds the 1 test USDC until `createCampaign` succeeds. The
allowance only lets the deployed escrow pull that exact amount.

## `createCampaign` transaction preflight

This is the next proposed transaction, not yet sent. It should be recomputed if
the chain time catches up to or passes `startsAt`.

| Field | Value |
| --- | --- |
| Chain | Base Sepolia, chain 84532 |
| From / sponsor / refund address | `0x3Bb5330334D301Cd1976cA025F0eFDEBeeeE7faA` |
| Contract | `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304` |
| Function | `createCampaign(CampaignTerms)` |
| Reward per claim | `1000000` atomic units, exactly 1 test USDC |
| Maximum claims | 1 |
| Starts at | `1788652194` / 2026-09-05 23:49:54 UTC / 2026-09-05 16:49:54 PDT |
| Ends at | `1788673794` / 2026-09-06 05:49:54 UTC / 2026-09-05 22:49:54 PDT |
| Claim deadline | `1788760194` / 2026-09-07 05:49:54 UTC / 2026-09-06 22:49:54 PDT |
| Terms hash | `0xcb93af85bf4d58a2377067d03efc3ead972cdc4f344e0b21e9467dd00a535163` |
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
Crossword Base Sepolia one-slot sponsored-claim acceptance campaign|date=2026-09-05|chainId=84532|escrow=0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304|token=0x036CbD53842c5426634e7929541eC2318f3dCF7e|rewardAtomic=1000000|maxClaims=1|startsAt=1788652194|endsAt=1788673794|claimDeadline=1788760194|eligibilitySigner=0xD7F85d32390329cce4e7375d121c912fd3119bF5
```
