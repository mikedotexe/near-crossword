# Local Base Sepolia setup

Recorded 2026-09-05, sessions 9-11. Preparation only: no deployment, payment,
campaign funding, provider sponsorship request, or production change.

## Configuration state

- Active worktree: `/Users/mikepurvis/other/near-crossword-launch-candidate`,
  branch `codex/early-launch-discovery`, after `184379a`.
- Its new ignored `.env.local` is owner-readable/writable only (0600). It sets
  chain 84532 and the public `https://sepolia.base.org` RPC. All claim, signing,
  indexer, sponsorship, publication, x402 and broadcast gates remain false.
- `BASE_PAYMASTER_UPSTREAM_URL` is present in this ignored local file. Its shape
  validates as the CDP Base Sepolia RPC path, and a read-only `eth_chainId` call
  returned `0x14a34`. The endpoint was not printed or committed. It is still a
  private credential, not a public proxy URL and not a launch gate by itself.
- The Base Sepolia Paymaster portal page currently shows Paymaster enabled with
  a visible default $1 global limit, $1 per-user limit, 1000 per-user operations
  and no contract allowlist. Treat that as **not live-ready** until the escrow is
  deployed, the claim contract/function allowlist is set, and provider/billing
  evidence is reviewed.
- Deployment preflight is recorded in
  [base-sepolia-deployment-preflight-2026-09-05.md](base-sepolia-deployment-preflight-2026-09-05.md).
  It estimates the escrow deployment but does not approve or broadcast it.
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

1. Get explicit approval for the exact deployment preflight, then broadcast the
   Base Sepolia escrow deployment and record the transaction/deployment anchor.
2. Add the deployed escrow and exact `claim` function to the CDP contract
   allowlist before any proxy activation. The current default project settings
   are visible but not accepted as the final launch policy.
3. Establish the actual provider policy and explicit billing cap, review the
   escrow deployment and gas estimate, and choose exact transaction identities.
   The wallet above is available as the test deployer and proposed refund
   destination; no funded campaign or transfer-specific approval is implied.
4. Complete the [live acceptance checklist](base-sepolia-sponsorship-acceptance.md):
   reviewed deployment/account pins, real session, healthy scanner, hosted
   wallet compatibility, bounded CDP responses and fresh zero-ETH participant.
   An encrypted deployer wallet does not satisfy the fresh-passkey test.

The local nonpaying player/editor preview remains separate from provider setup.
Creating a wallet or filling a credential slot must not enable spending.
