import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import nacl from "tweetnacl";
import {
  buildClaimMessage,
  canonicalizeSolution,
  deriveSolutionPublicKey,
  normalizeAnswer,
  signClaimPermit,
  verifyClaimSignature,
} from "./solution";

const entries = [
  { number: 2, direction: "down" as const, answer: "One-Click" },
  { number: 1, direction: "down" as const, answer: "Escrow" },
  { number: 1, direction: "across" as const, answer: "USDC" },
];

const claim = {
  contractId: "crossword-v2.testnet",
  campaignId: "campaign-7",
  receiverId: "winner.testnet",
  payoutDigest: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  nonce: 4n,
  deadlineMs: 1_900_000_000_000n,
};

test("answers normalize and sort deterministically", () => {
  assert.equal(normalizeAnswer(" one-click "), "ONECLICK");
  assert.deepEqual(
    canonicalizeSolution(entries).map(
      ({ number, direction, answer }) => `${number}:${direction}:${answer}`,
    ),
    ["1:across:USDC", "1:down:ESCROW", "2:down:ONECLICK"],
  );
});

test("solution public key is independent of input ordering", async () => {
  const first = await deriveSolutionPublicKey("campaign-7", entries);
  const second = await deriveSolutionPublicKey(
    "campaign-7",
    entries.slice().reverse(),
  );
  assert.equal(first, second);
});

test("claim signature binds recipient, nonce, deadline and payout digest", async () => {
  const signed = await signClaimPermit("campaign-7", entries, claim);
  assert.equal(
    verifyClaimSignature(signed.solutionPublicKey, signed.signature, claim),
    true,
  );
  assert.equal(
    verifyClaimSignature(signed.solutionPublicKey, signed.signature, {
      ...claim,
      receiverId: "attacker.testnet",
    }),
    false,
  );
  assert.equal(
    verifyClaimSignature(signed.solutionPublicKey, signed.signature, {
      ...claim,
      nonce: 5n,
    }),
    false,
  );
});

test("claim message layout is stable", () => {
  const bytes = buildClaimMessage(claim);
  assert.equal(
    new TextDecoder().decode(bytes.slice(0, 27)),
    "crossword-campaign-claim:v1",
  );
  assert.ok(bytes.length > 100);
});

test("matches the Rust contract claim-permit fixture", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../../../contract-v2/fixtures/claim-permit-v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const message = buildClaimMessage({
    contractId: fixture.contract_id,
    campaignId: fixture.campaign_id,
    receiverId: fixture.receiver_id,
    payoutDigest: fixture.payout_digest_base64,
    nonce: fixture.nonce,
    deadlineMs: fixture.deadline_ms,
  });

  assert.equal(Buffer.from(message).toString("base64"), fixture.claim_message_base64);
  assert.equal(
    verifyClaimSignature(
      fixture.solution_public_key_base64,
      fixture.signature_base64,
      {
        contractId: fixture.contract_id,
        campaignId: fixture.campaign_id,
        receiverId: fixture.receiver_id,
        payoutDigest: fixture.payout_digest_base64,
        nonce: fixture.nonce,
        deadlineMs: fixture.deadline_ms,
      },
    ),
    true,
  );

  const keyPair = nacl.sign.keyPair.fromSeed(
    new Uint8Array(Buffer.from(fixture.seed_base64, "base64")),
  );
  assert.equal(
    Buffer.from(keyPair.publicKey).toString("base64"),
    fixture.solution_public_key_base64,
  );
});
