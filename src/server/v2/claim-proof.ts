import { createPublicKey, verify } from "node:crypto";
import type { SolutionProof } from "./types";

const domain = Buffer.from("crossword-campaign-claim:v1", "utf8");
const ed25519SpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");

function lengthPrefixed(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function u64(value: string): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

export function buildClaimMessage(input: {
  contractId: string;
  campaignId: string;
  receiverId: string;
  payoutDigest: string;
  nonce: string;
  deadlineMs: string;
}): Buffer {
  return Buffer.concat([
    domain,
    lengthPrefixed(input.contractId),
    lengthPrefixed(input.campaignId),
    lengthPrefixed(input.receiverId),
    Buffer.from(input.payoutDigest, "base64"),
    u64(input.nonce),
    u64(input.deadlineMs),
  ]);
}

export function verifyClaimProof(input: {
  solutionPublicKey: string;
  contractId: string;
  campaignId: string;
  receiverId: string;
  proof: SolutionProof;
}): boolean {
  try {
    const rawKey = Buffer.from(input.solutionPublicKey, "base64");
    if (rawKey.length !== 32) return false;
    const key = createPublicKey({
      key: Buffer.concat([ed25519SpkiPrefix, rawKey]),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      buildClaimMessage({
        contractId: input.contractId,
        campaignId: input.campaignId,
        receiverId: input.receiverId,
        payoutDigest: input.proof.payoutDigest,
        nonce: input.proof.nonce,
        deadlineMs: input.proof.deadlineMs,
      }),
      key,
      Buffer.from(input.proof.signature, "base64"),
    );
  } catch {
    return false;
  }
}
