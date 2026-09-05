# Base accounting

Implemented locally in session 5. Local code is not deployment evidence.

The reader pins chain, escrow, native USDC, runtime bytecode hash, deployment
block number/hash and an explicitly reviewed finalized-lag policy. No default
escrow address or funded signer is inferred. Chain 31337 is allowed only by an
explicit local-test constructor option, never the environment factory.

All state in a snapshot uses one EIP-1898 block hash with `requireCanonical`.
The `finalized` tag is required for claim/funding reads; do not fall back to
`latest`, preconfirmations, or a guessed confirmation count. Read-only RPC uses
the pinned viem client, cancellation, bounded responses, disabled retries and
redirects, and no off-chain lookup. Provider errors may contain URL credentials;
return only sanitized application errors.

## Implementation map

- `src/lib/base/escrow-abi.ts`: exact contract view/event ABI and Circle token
  pins shared with review validation. The compiled-contract acceptance test
  exercises ABI conformance, not just a mocked encoding of the same definitions.
- `src/server/base/chain-reader.ts`: bounded RPC adapter and validated deployment
  configuration. Every snapshot verifies chain, deployment anchor, bytecode and
  immutable token. Claim-use queries are pinned to canonical finalized history.
- `chain-events.ts`: strict event decoding and replay of every campaign's budget,
  unique slot/participant payments, signer epochs, pause, cancellation and expiry.
  Logs with impossible transitions, gaps in campaign IDs, incorrect amounts,
  duplicate payments or inconsistent getter totals fail reconciliation.
- `chain-indexer.ts` and migration 010: canonical block history, immutable logs,
  finalized campaign snapshots and a versioned deployment cursor. The migration
  is additive and never modifies NEAR records or reserved Base allocations.
- `reconciled-chain-reader.ts`: the reader to inject into `BaseRewardIssuer`.
  Requires a healthy ledger checked within 60 seconds, identical deployment pins,
  and exactly the current finalized snapshot. A new finalized head requires the
  scanner to catch up before more issuance; an RPC result cannot bypass a halt.

## Indexing and finality

Each sync fetches at most 32 blocks by default (constructor maximum 128), from
the deployment block onward. All blocks, including empty ones, carry parent
links. Escrow logs are fetched by block hash, normalized and deduplicated; a
conflicting duplicate or changed log set for an already observed hash fails.
RPC responses are bounded to 2 MiB, and a block to 2,000 escrow logs. Provider
retry is disabled; a complete sync has a 60-second deadline.

The scanner can observe `latest` history, but only events at or below its verified
finalized checkpoint contribute to campaign snapshots. It rebuilds all campaign
totals from canonical events and compares every getter, `campaignCount`,
`totalReserved` and the escrow's token balance at that hash. Donations remain
surplus; they cannot make a campaign appear funded. Refund and payout accounting
include transactions sent by any relayer, not only our application.

Preparation happens outside the write transaction. A deployment version check
serializes publication of new blocks, events, snapshots and cursor together;
concurrent/stale scanners must retry. A failed or ambiguous run is safe to replay.
The current bounded rebuild supports at most 100,000 canonical events and 1,000
campaigns; exceeding capacity fails closed. This is not a throughput promise.
Benchmark/paginate incremental projections before large-scale deployment.

`HEALTHY` means caught up to the sampled finalized head, not to every latest
block and not perpetually fresh. `CATCHING_UP` and stale `checked_at` cannot
authorize new rewards through the reconciled reader. Session 6's private payment
recovery also requires canonical blocks at or below `finalized_number`, exact
allocation/event matches, contract uniqueness flags and the healthy/freshness gate.
Raw log presence is not a confirmed-payment status. See [participants](06-participants-and-recovery.md).

## Reorg and recovery

Before extending history, the scanner rechecks its previous finalized hash and
tip. An ordinary reorg walks back at most 128 stored blocks by default (maximum
1,024), orphans observations above the common ancestor, and returns. The next
sync ingests the replacement branch. Orphaned blocks/logs are retained, not
deleted, and a block can return without duplicating its original immutable logs.
Finalized accounting and private allocations are not recycled during rewind.

A contradiction in finalized history, a deeper-than-supported reorg, or an
accounting mismatch sets `HALTED` without advancing the reconciled checkpoint.
Transport failures leave the previous checkpoint intact; they do not persist
provider error bodies. There is no automatic unhalt/reset command.

For a halt: stop the scanner/issuance supervisor, compare history using independent
trusted RPC providers, diagnose the mismatch and add a regression test. Rebuild
candidate accounting in an isolated schema from the pinned deployment and compare
it to the original audit history and allocations. Promotion/unhalting needs an
explicit reviewed operational action. Never delete allocations, rewrite finalized
receipts or raise the rewind limit merely to make an error disappear.

## Operator entry point

`yarn base:reconcile` performs one read-only-chain batch, then exits. It writes
only the accounting database and is gated by `BASE_INDEXER_ENABLED=true`.
No scheduler, production reader composition, public receipts API, signer, relayer
or transaction broadcast is activated by this command.

Required configuration: `DATABASE_URL`, `BASE_CHAIN_ID` (8453 or 84532),
`BASE_RPC_URL`, `BASE_ESCROW_ADDRESS`, `BASE_ESCROW_RUNTIME_CODE_HASH`,
`BASE_ESCROW_DEPLOYMENT_BLOCK`, `BASE_ESCROW_DEPLOYMENT_BLOCK_HASH`, and
`BASE_MAX_FINALIZED_LAG_SECONDS`. The native token is pinned by chain ID. None of
the deployment values or the allowed finalized lag is guessed. The RPC URL may
contain a provider key and is never persisted in deployment pins or errors.

Finalized lag is a freshness allowance, not a finality duration or confirmation
threshold. The local EVM's short epochs are a simulation, not Base policy. Before
activation verify the deployed bytecode including immutables, RPC hash-selector
support, observed finality lag, scan throughput and a supervised run cadence that
keeps the 60-second application checkpoint gate fresh.

## Verification

`yarn test:unit` covers strict RPC/hash/token/code checks and event accounting.
`yarn test:integration:base` requires disposable local `TEST_DATABASE_URL` and
tests real Postgres replay, concurrency, rewinds, halts and issuance gating.
`yarn test:integration:base-chain` additionally builds the Solidity artifacts and
starts its own pinned Anvil 1.7.1 on a loopback ephemeral port. It uses public
fixture keys and synthetic tokens, then stops the node and drops its isolated
schema. Funding, reward, rotation, pause, refund and surplus reconcile against
the actual compiled contract. CI runs both integrations.

References: [Base block tags](https://docs.base.org/base-chain/api-reference/rpc-overview),
[EIP-1898](https://eips.ethereum.org/EIPS/eip-1898),
[Circle native USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses),
[our contract specification](../docs/base-reward-contract.md).
