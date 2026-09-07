import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { baseClaimDigest, baseClaimTypedData, type BaseClaim } from "./claim";

const fixture = JSON.parse(readFileSync(new URL("../../../contract-base/test/fixtures/claim-v1.json", import.meta.url), "utf8"));
const claim: BaseClaim = {
  ...fixture.claim,
  campaignId: BigInt(fixture.claim.campaignId), amount: BigInt(fixture.claim.amount),
  deadline: BigInt(fixture.claim.deadline), signerEpoch: BigInt(fixture.claim.signerEpoch),
};

describe("Base claim typed data", () => {
  it("matches the Solidity digest and recovers the fixture signer", async () => {
    assert.equal(baseClaimDigest(fixture.chainId, fixture.contract, claim), fixture.digest);
    assert.equal(await recoverTypedDataAddress({
      ...baseClaimTypedData(fixture.chainId, fixture.contract, claim), signature: fixture.signature,
    }), fixture.signer);
  });

  it("changes the digest for every signed field and domain", () => {
    const changes: Partial<BaseClaim>[] = [
      { campaignId: 8n }, { slot: 3 }, { participantId: `0x${"44".repeat(32)}` },
      { recipient: "0x4444444444444444444444444444444444444444" },
      { amount: 100001n }, { deadline: 2000000001n }, { signerEpoch: 2n },
    ];
    for (const change of changes) assert.notEqual(baseClaimDigest(8453, fixture.contract, { ...claim, ...change }), fixture.digest);
    assert.notEqual(baseClaimDigest(84532, fixture.contract, claim), fixture.digest);
    assert.notEqual(baseClaimDigest(8453, "0x4444444444444444444444444444444444444444", claim), fixture.digest);
  });

  it("rejects invalid ranges, unsupported chains, and invalid addresses", () => {
    const invalid: Partial<BaseClaim>[] = [
      { slot: -1 }, { slot: 2 ** 32 }, { slot: 0.5 }, { amount: 0n },
      { amount: 1n << 256n }, { deadline: 1n << 64n }, { signerEpoch: 0n },
      { campaignId: 0n }, { participantId: "0x01" }, { participantId: `0x${"00".repeat(32)}` },
      { participantId: "not hex" as Hex }, { recipient: "bad" as Address },
      { recipient: fixture.contract }, { recipient: "0x0000000000000000000000000000000000000000" },
    ];
    for (const value of invalid) assert.throws(() => baseClaimTypedData(8453, fixture.contract, { ...claim, ...value }));
    assert.throws(() => baseClaimTypedData(1, fixture.contract, claim));
  });
});
