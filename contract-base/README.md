# Base learning rewards

Local R3 implementation of the [fixed-slot escrow design](../docs/base-reward-contract.md).
Not deployed, not audited, and not connected to the live campaign database or UI.

## Toolchain and checks

- Solidity 0.8.30, Cancun EVM, optimizer 200 runs.
- Forge 1.7.1, pinned through the official `@foundry-rs/forge` npm package.
- OpenZeppelin Contracts 5.6.1, pinned in the root Yarn lockfile.
- forge-std 1.16.2, submodule commit `bf647bd6046f2f7da30d0c2bf435e5c76a780c1b`.

From the repository root:

```bash
git submodule update --init --recursive
yarn install --immutable
yarn contract:base:fmt
yarn test:contract:base
yarn contract:base:build
```

The package scripts invoke the installed Forge binary through `scripts/forge.mjs`
because this pinned npm release's default launcher does not propagate its child
exit status. Missing tools and failed builds/tests must fail CI, not silently
fall back to a global Forge. The `contract-base` CI job runs the checks above.
No command here broadcasts transactions or uses a funded signer.

Current local evidence: 28 unit/fuzz tests plus one stateful invariant test,
128 invariant sequences of 64 calls (8,192 calls, zero unexpected reverts),
and 256 fuzz examples for capped claims across multiple campaigns. Tests cover
EOA/ERC-1271 eligibility signers, all signed fields/domains, replay, rotation,
pause, deadlines, cancellation, refunds, token failures, reentrancy, and events.
The timestamp lint warnings are expected for the specified claim/refund windows;
they are not a promise of precise wall-clock execution or uninterrupted access.

`test/fixtures/claim-v1.json` is shared with `src/lib/base/claim.test.ts`. It
contains a public test signature, not a funded wallet key. Solidity checks both
the exact typed-data digest and recovered signer; TypeScript uses `viem`.
The NEAR claim encoding is unchanged.

## Contract interface

`LearningRewards` takes one immutable IERC20 token address. Production deployment
must separately verify the chain and native USDC address from the design. The
constructor's code-existence check does not prove token identity or decimals.
There is intentionally no deployment/broadcast script in this checkpoint.

- `createCampaign(terms)`: exact prefunding by the sponsor; immutable budget,
  reward, claim count, schedule, public terms hash, and sponsor/refund address.
- `claim(authorization, signature)`: permissionless relay to the signed recipient;
  consumes both a campaign slot and opaque campaign participant ID atomically.
- `setPaused`, `rotateSigner`, `cancelCampaign`: sponsor control, with the latter
  allowed only before opening. Rotation invalidates old epochs permanently.
- `refundExpired`: permissionless after the final deadline, always pays sponsor.
- `getCampaign`, `outstanding`, `totalReserved`, `usedSlots`,
  `claimedParticipants`, `claimDigest`: read-only state and signature helpers.

Funding, payout, refund, pause, and signer-change events expose only public
accounting facts. Funded equals paid plus outstanding plus refunded, and token
balance must cover total outstanding liabilities. Donations are not funding.

Eligibility and allocation remain trusted application work. This contract cannot
prove unique humans, learning, email ownership, or fair issuance. Sponsor pause
and signer rotation may prevent an outstanding authorization from being claimed.
The on-chain budget proof does not remove those controls or USDC issuer risk.

## Still required

Additive campaign/account schema, atomic slot issuance, wallet-control proof,
private consent and source review, production signer management, Base event
ingestion/reorg recovery, confirmation policy, sponsored gas, independent review,
and a separately approved small pilot. Do not migrate NEAR liabilities or expose
Base claims publicly solely because these local tests pass.
