# Local Base Sepolia setup

Recorded 2026-09-05, sessions 9-14. Testnet deployment and one-slot campaign
funding only: no provider sponsorship request, fresh hosted-wallet claim,
mainnet transfer or production change.

## Configuration state

- Active worktree: `/Users/mikepurvis/other/near-crossword-launch-candidate`,
  branch `codex/early-launch-discovery`, after `8a4b951`.
- Its new ignored `.env.local` is owner-readable/writable only (0600). It sets
  chain 84532 and the public `https://sepolia.base.org` RPC. All claim, signing,
  indexer, sponsorship, publication, x402 and broadcast gates remain false.
- `BASE_PAYMASTER_UPSTREAM_URL` is present in this ignored local file. Its shape
  validates as the CDP Base Sepolia RPC path, and a read-only `eth_chainId` call
  returned `0x14a34`. The endpoint was not printed or committed. It is still a
  private credential, not a public proxy URL and not a launch gate by itself.
- The Base Sepolia Paymaster portal page shows Paymaster enabled with a claim-only
  allowlist entry for the deployed escrow's `claim` selector, visible $1 global
  and per-user limits, 10 per-user operations and sponsor name `Crossword`. Treat
  that as **not live-ready** until hosted-wallet/provider wire evidence and actual
  provider billing/cost evidence are reviewed.
- Deployment preflight is recorded in
  [base-sepolia-deployment-preflight-2026-09-05.md](base-sepolia-deployment-preflight-2026-09-05.md).
  It records the successful Base Sepolia escrow deployment and CDP allowlist. The
  deployment block has since been finalized and the finalized code hash matched.
- Code/deployment pins, provider limits and the public HTTPS proxy URL remain
  blank. No addresses or review flags were guessed to bypass the gates.
- The original repo's `.env`, facilitator credentials, AWS and Render remain
  untouched. Do not assume the original worktree has this local configuration.

## Paymaster versus deployment wallet

The [CDP billing FAQ](https://docs.cdp.coinbase.com/paymaster/faqs) currently
describes monthly USD billing based on actual gas cost plus 7%. CDP's managed
paymaster/bundler uses a private endpoint, not a seed phrase or an ETH deposit
address we create. Check the actual project's testnet credits and billing rules
in the Portal before enabling any request. No billing commitment was made here.

The separate wallet below is for deploying the escrow and funding a test
campaign. It is neither the paymaster, the server eligibility signer, nor the
fresh participant Base Account. Keep all those roles separate.

## Test deployment wallet

| Field | Value |
| --- | --- |
| Intended network | Base Sepolia, chain 84532, test funds only |
| Public address | `0x3Bb5330334D301Cd1976cA025F0eFDEBeeeE7faA` |
| Encrypted keystore | `/Users/mikepurvis/.local/share/crossword/base-sepolia-deployer/9fd9af63-cd7b-4ce7-a4a2-e35d88965823` |
| Keychain service | `xyz.crossword.base-sepolia.deployer` |
| Keychain account | `base-sepolia-deployer` |
| Keychain label | `Crossword-Base-Sepolia-Deployer` |
| Recovery check | Keystore decryption/address derivation and independently recovered offline message signature passed |
| Initial chain observation | Block `46429850`: 0 test ETH, 0 native test USDC, nonce 0, no account code |
| Faucet funding | CDP Base Sepolia faucet funded 0.0001 test ETH and 1 native test USDC; latest balance check returned `0.000100000000000000` ETH and `1000000` USDC atomic units |
| Deployment spend | Escrow deployment used 1,808,772 gas and 0.000010852632 test ETH |
| Post-deploy balance | 0.000088826683397187 test ETH and 1 native test USDC; nonce 1 |
| Approval spend | USDC approval used 55,437 gas and 0.000000332622 test ETH |
| Post-approval balance | 0.000088488025569621 test ETH and 1 native test USDC; nonce 2 |
| Campaign creation spend | `createCampaign` used 276,149 gas and 0.000001656894 test ETH |
| Post-campaign balance | 0.000086822276296911 test ETH and 0 native test USDC; nonce 3 |

## Deployed escrow

| Field | Value |
| --- | --- |
| Contract | `LearningRewards` |
| Address | `0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304` |
| Transaction | `0x0419e4a8a2334233cec9272a846f95b77cb35915931e5115599d1c454e6a7a03` |
| Deployment block | `46440190` |
| Deployment block hash | `0x9f4c61b1eb34fb10040abfc52d6066f3dcf53801d5614b0683e670d8b2a4d7b3` |
| Actual runtime code hash | `0xebc5371a9a09231045c01981600b619436374e6226048855a6116d1d0c2dce00` |
| Immutable token | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Initial state | `totalReserved() = 0`, `campaignCount() = 0` |
| Funded campaign | Campaign `1` created by transaction `0x1a1f49f3c06d37c1fe2295ad0188f0e27e78a8b1c0b4636a9e7f0f4175bf6182`; `totalReserved() = 1000000`, `outstanding(1) = 1000000` |
| Finality | Deployment finalized and code hash verified at later observation; latest `46441104`, finalized `46440531` |

CDP Paymaster on Base Testnet (Sepolia) was saved with one `Crossword Claim`
allowlist entry for this contract and selector `0x8bd53692`, the selector for
`claim((uint256,uint32,bytes32,address,uint256,uint64,uint64),bytes)`. The
visible gas policy is `$1` global, `$1` per user, 10 operations per user, no
cycle, with sponsor name `Crossword`. This does not prove wallet/provider wire
compatibility yet.

## Eligibility signer

| Field | Value |
| --- | --- |
| Public address | `0xD7F85d32390329cce4e7375d121c912fd3119bF5` |
| Keychain service | `xyz.crossword.base-sepolia.eligibility-signer` |
| Keychain account | `base-sepolia-eligibility-signer` |
| Local env | `BASE_ELIGIBILITY_PRIVATE_KEY` is present only in ignored `.env.local` |
| Spending authority | none; do not fund this address |

This signer is for test eligibility only. It can authorize reward claims, so it
is operationally sensitive, but it cannot spend campaign funds without the
escrow's separate sponsor-funded allocation. It remains distinct from deployer,
paymaster, and participant identities.

Created with the already installed Foundry Cast random-wallet/encrypted-keystore
command. It is a Web3 V3 encrypted key, not a mnemonic wallet. The keystore and
directory have permissions 0600/0700. A separately generated random password
is stored in this Mac's login Keychain, not in `.env`, Git, command arguments or
chat. A short-lived owner-only password file used for recovery was removed.
No private key, password or signature was printed as evidence.

The installed Cast version omits the address field from its keystore JSON.
The initial metadata check stopped after creation; we recovered the **same**
file and verified its address/signature rather than regenerating a wallet.
Similarly, a nonzero interactive Keychain wrapper exit was reconciled by reading
the newly created item; it was not overwritten. These were local setup issues,
not failed chain transactions or provider requests.

Recovery needs **both** the keystore and its Keychain password. This is local
encrypted storage, not a hardware wallet or an independently verified backup.
Before any future real-value use, establish an independent secure backup and
review a suitable production custody arrangement. Do not print the password
through a terminal/tool, place it beside the keystore, or give the web service
deployer signing authority. In Keychain Access, locate the label above for
user-controlled backup/recovery. No independent backup is verified yet.

An EVM address can receive assets on other networks, but that does not authorize
their use here. **Do not send real ETH or mainnet USDC to this test wallet.**
[Base's funding guide](https://docs.base.org/get-started/get-funds) links free
Base Sepolia ETH and USDC faucets; the Circle faucet must be set to Base Sepolia.
No purchase or mainnet bridge is required.

## Faucet and mainnet custody posture

The first funding attempt used the Coinbase Developer Platform faucet while
signed in and succeeded for both Base Sepolia ETH and native test USDC. If more
test fuel is needed, repeat CDP/Base Sepolia faucets against the public
test-deployer address above before considering any real-ETH movement.

If mainnet ETH is eventually needed, send only a tiny, reviewed amount from
Coinbase on the **Base** network to a fresh production custody address whose
backup has already been verified. Do not use the hacked MetaMask profile, do not
reuse this test-deployer keystore for mainnet value, and do not put a mainnet
mnemonic or private key in `.env`. A server-side production key, if we ever need
one, should live in a dedicated secret manager or hardware-backed signer with
explicit spending limits and a runbook.

## Continue setup

1. Wait for finalization of campaign block `46444150`, then verify campaign
   state against finalized chain history before issuing a claim.
2. The one-slot approval and campaign transactions recorded in
   [base-sepolia-campaign-preflight-2026-09-05.md](base-sepolia-campaign-preflight-2026-09-05.md)
   are mined. Campaign `1` holds exactly 1 native test USDC in escrow; allowance
   is back to zero.
3. Complete the [live acceptance checklist](base-sepolia-sponsorship-acceptance.md):
   reviewed deployment/account pins, real session, healthy scanner, hosted
   wallet compatibility, bounded CDP responses and fresh zero-ETH participant.
   An encrypted deployer wallet does not satisfy the fresh-passkey test.

The local nonpaying player/editor preview remains separate from provider setup.
Creating a wallet or filling a credential slot must not enable spending.
