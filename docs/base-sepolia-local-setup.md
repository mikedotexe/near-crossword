# Local Base Sepolia setup

Recorded 2026-09-05, session 9. Preparation only: no deployment, payment,
campaign funding, provider sponsorship request, or production change.

## Configuration state

- Active worktree: `/Users/mikepurvis/other/near-crossword-launch-candidate`,
  branch `codex/early-launch-discovery`, following `3362ad5`.
- Its new ignored `.env.local` is owner-readable/writable only (0600). It sets
  chain 84532 and the public `https://sepolia.base.org` RPC. All claim, signing,
  indexer, sponsorship, publication, x402 and broadcast gates remain false.
- `BASE_PAYMASTER_UPSTREAM_URL` is an empty slot, **not a working credential**.
  The CDP Portal opened at sign-in; no project, endpoint, allowlist, billing
  policy, credit balance or payment method has been created/verified there.
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

## Continue setup

1. Mike completes Coinbase Developer Platform sign-in in the open browser tab.
   Select/create a dedicated Crossword project and inspect Paymaster on Base
   Sepolia. Review any account terms or charge-bearing action before accepting.
2. Put the dedicated endpoint into `BASE_PAYMASTER_UPSTREAM_URL` in this
   worktree's `.env.local`, never chat or a `NEXT_PUBLIC_` variable. Keep the
   public proxy URL separate. No endpoint has been saved yet.
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
