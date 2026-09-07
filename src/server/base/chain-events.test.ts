import assert from "node:assert/strict";
import { test } from "node:test";
import { chainFixture, encodeEscrowEvent, participant, testHash } from "./chain.fixture";
import { projectEscrowEvents, reconcileCampaign, reconcileTotals } from "./chain-events";
import { recipient } from "./workflow.fixture";

test("event projection reconstructs funded, paid and reserved principal; donations remain surplus", () => {
  const fixture = chainFixture();
  const projection = projectEscrowEvents(fixture.deployment, [10n, 11n].map((n) => ({ block: fixture.blocks.get(n)!, logs: fixture.logs.get(n)! })));
  assert.equal(projection.get("1")!.paidCount, 1); assert.equal(projection.get("1")!.outstandingAtomic, 200000n);
  reconcileCampaign(projection.get("1")!, fixture.stateAt(fixture.blocks.get(11n)!), fixture.blocks.get(11n)!);
  assert.deepEqual(reconcileTotals(projection, { campaignCount: 1n, totalReserved: 200000n, balance: 200017n }), { fundedAtomic: 300000n, reservedAtomic: 200000n, surplusAtomic: 17n });
  assert.throws(() => reconcileTotals(projection, { campaignCount: 2n, totalReserved: 200000n, balance: 200000n }));
  assert.throws(() => reconcileTotals(projection, { campaignCount: 1n, totalReserved: 200000n, balance: 199999n }));
  assert.throws(() => reconcileCampaign(projection.get("1")!, { ...fixture.stateAt(fixture.blocks.get(11n)!), paidCount: 0 }, fixture.blocks.get(11n)!));
});

test("duplicate slots, participants, transaction locations and incorrect payments fail reconstruction", () => {
  for (const mutation of [{ slot: 0, participantId: testHash(901) }, { slot: 1, participantId: participant }, { slot: 3, participantId: testHash(901) }, { slot: 1, participantId: testHash(901), amount: 1n }]) {
    const fixture = chainFixture();
    const log = encodeEscrowEvent("RewardPaid", { campaignId: 1n, recipient, amount: 100000n, ...mutation }, fixture.blocks.get(12n)!);
    assert.throws(() => projectEscrowEvents(fixture.deployment, [
      { block: fixture.blocks.get(10n)!, logs: fixture.logs.get(10n)! }, { block: fixture.blocks.get(11n)!, logs: fixture.logs.get(11n)! }, { block: fixture.blocks.get(12n)!, logs: [log] },
    ]), { code: "BASE_RECONCILIATION_MISMATCH" });
  }
});

test("rotation, pause and expiry refunds preserve exact accounting", () => {
  const fixture = chainFixture();
  const block = { ...fixture.blocks.get(12n)!, timestamp: fixture.base.claimDeadline + 1 };
  const logs = [
    encodeEscrowEvent("EligibilitySignerChanged", { campaignId: 1n, previousSigner: fixture.base.signer, newSigner: recipient, signerEpoch: 2n }, block, 0),
    encodeEscrowEvent("CampaignPauseChanged", { campaignId: 1n, paused: true }, block, 1),
    encodeEscrowEvent("CampaignRefunded", { campaignId: 1n, sponsor: fixture.base.sponsor, amount: 200000n, reason: 1 }, block, 2),
  ];
  const history = [10n, 11n].map((n) => ({ block: fixture.blocks.get(n)!, logs: fixture.logs.get(n)! }));
  const projection = projectEscrowEvents(fixture.deployment, [...history, { block, logs }]);
  const state = projection.get("1")!;
  assert.equal(state.signerEpoch, 2n); assert.equal(state.closed, true); assert.equal(state.paused, true);
  assert.equal(state.refundedAtomic, 200000n); assert.equal(state.outstandingAtomic, 0n);
  assert.throws(() => projectEscrowEvents(fixture.deployment, [...history, { block, logs: [...logs, encodeEscrowEvent("CampaignPauseChanged", { campaignId: 1n, paused: false }, block, 3)] }]));
  assert.throws(() => projectEscrowEvents(fixture.deployment, [...history, { block: { ...block, timestamp: fixture.base.claimDeadline }, logs }]));
});

test("cancellation requires the full remainder before campaign start", () => {
  const fixture = chainFixture();
  const funding = { block: fixture.blocks.get(10n)!, logs: fixture.logs.get(10n)! };
  const block = { ...fixture.blocks.get(11n)!, timestamp: fixture.base.startsAt - 1 };
  const refund = encodeEscrowEvent("CampaignRefunded", { campaignId: 1n, sponsor: fixture.base.sponsor, amount: 300000n, reason: 0 }, block);
  assert.equal(projectEscrowEvents(fixture.deployment, [funding, { block, logs: [refund] }]).get("1")!.refundedAtomic, 300000n);
  assert.throws(() => projectEscrowEvents(fixture.deployment, [funding, { block: { ...block, timestamp: fixture.base.startsAt }, logs: [refund] }]));
  const short = encodeEscrowEvent("CampaignRefunded", { campaignId: 1n, sponsor: fixture.base.sponsor, amount: 1n, reason: 0 }, block);
  assert.throws(() => projectEscrowEvents(fixture.deployment, [funding, { block, logs: [short] }]));
});

test("unknown events, skipped signer epochs and a transaction in two canonical blocks are rejected", () => {
  const fixture = chainFixture();
  const history = [10n, 11n].map((n) => ({ block: fixture.blocks.get(n)!, logs: fixture.logs.get(n)! }));
  const block = fixture.blocks.get(12n)!;
  const payment = encodeEscrowEvent("RewardPaid", { campaignId: 1n, slot: 1, participantId: testHash(901), recipient, amount: 100000n }, block);
  const cases = [
    { ...payment, topics: [testHash(999)] as typeof payment.topics },
    encodeEscrowEvent("EligibilitySignerChanged", { campaignId: 1n, previousSigner: fixture.base.signer, newSigner: recipient, signerEpoch: 3n }, block),
    { ...payment, transactionHash: fixture.logs.get(11n)![0].transactionHash },
  ];
  for (const log of cases) assert.throws(() => projectEscrowEvents(fixture.deployment, [...history, { block, logs: [log] }]));
});
