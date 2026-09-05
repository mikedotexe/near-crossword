# Base Sepolia deployment record, 2026-09-05

Status: deployed on Base Sepolia after Mike's explicit approval. No campaign has
been created, no USDC has been approved/transferred into the escrow, no provider
sponsorship request has been made, and no fresh hosted-wallet claim has been
tested.

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
| Artifact runtime template hash | `0x718c2e23a4d7c70694743697af861c642f920790067ad666a215f1bba9d45dfa` |
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

## Deployment result

| Field | Value |
| --- | --- |
| Explicit approval | Mike wrote "approved to deploy Base Sepolia escrow" |
| Transaction hash | `0x0419e4a8a2334233cec9272a846f95b77cb35915931e5115599d1c454e6a7a03` |
| Status | success |
| Deployed to | `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304` |
| Block | `46440190` |
| Block hash | `0x9f4c61b1eb34fb10040abfc52d6066f3dcf53801d5614b0683e670d8b2a4d7b3` |
| Gas used | 1,808,772 |
| Transaction gas limit | 2,239,154 |
| Effective gas price | 6,000,000 wei |
| Max fee per gas | 7,000,000 wei |
| Max priority fee per gas | 1,000,000 wei |
| Fee paid | 0.000010852632 test ETH |
| Actual deployed runtime code hash | `0xebc5371a9a09231045c01981600b619436374e6226048855a6116d1d0c2dce00` |
| Deployed code size | 7,940 bytes |
| `token()` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| `totalReserved()` | 0 |
| `campaignCount()` | 0 |
| Deployer nonce after deployment | 1 |
| Deployer balance after deployment | 0.000088826683397187 test ETH |
| Deployer USDC after deployment | 1 native test USDC |
| Latest/finalized observation | Latest `46440324`, finalized `46439633`; deployment block not finalized yet |

The artifact runtime template hash differs from the actual deployed runtime hash
because constructor immutables are patched into runtime bytecode. Pin the actual
on-chain hash above in environment configuration.

Two earlier local attempts did not reach the chain: one fell back to localhost
because constructor arguments consumed the later RPC option, and one stopped at
argument parsing. A nonce/balance check before the successful attempt confirmed
no transaction had been sent.

## CDP Paymaster policy

After deployment, CDP Paymaster was left on **Base Testnet (Sepolia)** and saved
with:

- Paymaster enabled.
- Contract allowlist entry named `Crossword Claim`.
- Contract address `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304`.
- Function selector `0x8bd53692`, the selector for
  `claim((uint256,uint32,bytes32,address,uint256,uint64,uint64),bytes)`.
- Global sponsored gas limit visible as `$1`.
- Per-user sponsored gas limit visible as `$1`.
- Per-user operation count set to `10`.
- Limit cycle `None`.
- Sponsor display name `Crossword`.
- Per-user-operation USD limit disabled.
- Coinbase verified user / Coinbase One requirements disabled.

Treat this as a testnet pilot policy. It proves the portal accepted a restrictive
allowlist, not that our proxy has accepted real CDP `pm_getPaymaster*` responses.

## Remaining launch gates

1. Wait for the deployment block to be finalized, then verify the finalized code
   hash and deployment anchor.
2. Configure the independent eligibility signer and create one tiny test
   campaign after explicit transaction approval.
3. Prove the hosted Base Account/paymaster wire path with a genuinely fresh
   zero-ETH participant wallet and exact finalized `RewardPaid` receipt.
4. Keep every production and local spending gate disabled until that acceptance
   evidence is complete.
