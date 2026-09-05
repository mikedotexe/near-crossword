# Operations and continuation

Implementation worktree: `/Users/mikepurvis/other/near-crossword-launch-candidate`,
branch `codex/early-launch-discovery`. The original `near-crossword` worktree on
`codex/crossword-campaigns` contains pre-existing changes and is not a disposable
copy. Inspect both before work; never reset, overwrite or implicitly merge them.

Follow [QA](../QA.md) with coverage scaled to the change. Database integrations
must use an explicit disposable local `TEST_DATABASE_URL`, never fall back to
production `DATABASE_URL`. Apply new additive migrations and verify replay.
Session 7 reaches migration 012 and adds publication plus synthetic counterfactual
verification to the disposable Anvil/Postgres acceptance path. The local EVM
covers EOA, deployed ERC-1271 and undeployed ERC-6492 recipients; it does not prove
a real fresh Base passkey or sponsored gas. The built-production HTTP check runs
after `yarn build`, verifies the shipped layout source and denies practice routes.
Keep dependencies pinned; contract and browser regression evidence is separate
from unit tests. Production targets Node 20.
Run standalone typecheck and the Next build sequentially: the build regenerates
`.next/types`, which the typecheck reads. An overlap can cause transient missing
generated-file errors; repeat after the build, not by changing source types.

After each implementation session update this chapter's affected subjects,
the [checkpoint](../docs/reshape-progress.md), work order and QA evidence. After
any live check/configuration change update the [launch register](../docs/early-launch-status.md).
Keep implemented, configured, enabled and observed behavior distinct. Preserve
historical failures and remaining tests; do not silently close gates.

No automatic background monitoring is configured. A request to continue local
development is not authorization to stake, broadcast a funded transaction,
change Render or activate paid services. Exact network, token, amount, payer,
receiver and recovery address must be approved for a funded pilot. Preserve NEAR
legacy access until actual outstanding balances and claims are reconciled.
Keep `BASE_PARTICIPANT_ENABLED` and `BASE_CLAIM_ISSUANCE_ENABLED` false until the
remaining participant/policy/deployment gates are reviewed. A read recovery API
does not need a signing key; never disable necessary recovery merely to disable
new authorizations. Healthy, fresh supervised indexing remains necessary for both.
