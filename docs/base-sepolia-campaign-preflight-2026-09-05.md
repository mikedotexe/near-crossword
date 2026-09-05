# Base Sepolia one-slot campaign preflight, 2026-09-05

Status: waiting for explicit transaction approval. No USDC approval,
`createCampaign`, sponsored claim, provider request or fresh wallet claim has
been performed from this preflight.

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

This is the next proposed transaction, not yet sent:

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

After this approval is mined, recompute the `createCampaign` gas estimate against
the new allowance. Proposed campaign scope remains one 1-USDC slot with the same
deployer as sponsor/refund address, but its schedule and `termsHash` should be
recorded immediately before that second transaction.
