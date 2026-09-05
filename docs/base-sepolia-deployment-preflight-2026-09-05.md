# Base Sepolia deployment preflight, 2026-09-05

Status: ready for Mike's explicit deployment approval. No signed transaction or
broadcast has been performed from this preflight.

## Environment checks

| Check | Result |
| --- | --- |
| Worktree | `/Users/mikepurvis/other/near-crossword-launch-candidate` |
| Branch | `codex/early-launch-discovery` |
| `.env.local` permissions | 0600 |
| Spending gates | All recorded launch/sponsorship gates remain false |
| CDP endpoint | Present locally, shape validated, not printed |
| CDP read-only check | `eth_chainId` returned `0x14a34` |
| Public RPC chain | Base Sepolia, chain 84532 |
| Native test USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Token identity | `symbol() = USDC`, `decimals() = 6`, code present |
| Contract tests | `yarn test:contract:base` passed 29/29 |

## Proposed deployment

| Field | Value |
| --- | --- |
| Contract | `contract-base/src/LearningRewards.sol:LearningRewards` |
| Constructor | `LearningRewards(IERC20 token_)` |
| Constructor argument | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Deployer | `0x3Bb5330334D301Cd1976cA025F0eFDEBeeeE7faA` |
| Deployer nonce | 0 |
| Expected contract address | `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304` |
| Runtime code hash | `0x718c2e23a4d7c70694743697af861c642f920790067ad666a215f1bba9d45dfa` |
| Init data length | 9,090 bytes |
| Estimated gas | 1,824,295 |
| Suggested gas limit | 2,239,154 |
| Estimated max fee per gas | 7,000,000 wei |
| Estimated max priority fee | 1,000,000 wei |
| Estimated max cost | 0.000012770065 test ETH |
| Suggested max cost | 0.000015674078 test ETH |
| Current deployer balance | 0.0001 test ETH |
| Balance covers suggested max | yes |

The expected address assumes the deployer nonce remains 0 and no other
transaction is sent from the deployer first. Recompute this preflight immediately
before broadcasting if any transaction is attempted, cancelled, or appears
ambiguous.

## Approval boundary

Deployment approval should name:

1. Chain: Base Sepolia, chain 84532.
2. Deployer: `0x3Bb5330334D301Cd1976cA025F0eFDEBeeeE7faA`.
3. Contract and constructor argument above.
4. Maximum gas envelope: no more than 2,239,154 gas and 0.000016 test ETH.
5. Expected contract address above, assuming nonce 0.

After deployment, record the transaction hash, deployment block/hash, code hash,
and deployment anchor in the ignored local env and launch register. Then add the
deployed escrow's `claim` function to the CDP contract allowlist before enabling
any paymaster proxy flag.
