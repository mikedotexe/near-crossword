import nacl from "tweetnacl";

const SOLUTION_DOMAIN = "crossword-campaign-solution:v1";
const CLAIM_DOMAIN = "crossword-campaign-claim:v1";
const textEncoder = new TextEncoder();

export type CrosswordDirection = "across" | "down";

export interface SolutionEntry {
  number: number;
  direction: CrosswordDirection;
  answer: string;
}

export interface ClaimMessageInput {
  contractId: string;
  campaignId: string;
  receiverId: string;
  payoutDigest: string;
  nonce: bigint | number | string;
  deadlineMs: bigint | number | string;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function lengthPrefixed(value: string): Uint8Array {
  const bytes = textEncoder.encode(value);
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, bytes.length, true);
  return concatBytes([prefix, bytes]);
}

function littleEndianU64(value: ClaimMessageInput["nonce"]): Uint8Array {
  const numeric = BigInt(value);
  if (numeric < 0n || numeric > 0xffff_ffff_ffff_ffffn) {
    throw new Error("Unsigned 64-bit value is out of range");
  }

  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, numeric, true);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function normalizeAnswer(answer: string): string {
  const normalized = answer.normalize("NFKC").toUpperCase();
  if (!/^[A-Z0-9 _.-]+$/.test(normalized)) {
    throw new Error("Answers may contain only letters, numbers, spaces, _, . or -");
  }

  const compact = normalized.replace(/[^A-Z0-9]/g, "");
  if (compact.length < 3) {
    throw new Error("Each normalized answer must contain at least 3 characters");
  }
  return compact;
}

export function canonicalizeSolution(entries: SolutionEntry[]): SolutionEntry[] {
  if (entries.length < 3) {
    throw new Error("A campaign requires at least 3 crossword entries");
  }

  const canonical = entries.map((entry) => ({
    number: entry.number,
    direction: entry.direction,
    answer: normalizeAnswer(entry.answer),
  }));

  canonical.sort((left, right) => {
    if (left.number !== right.number) return left.number - right.number;
    if (left.direction === right.direction) return 0;
    return left.direction === "across" ? -1 : 1;
  });

  const identities = new Set<string>();
  for (const entry of canonical) {
    if (!Number.isSafeInteger(entry.number) || entry.number <= 0) {
      throw new Error("Clue numbers must be positive integers");
    }
    const identity = `${entry.number}:${entry.direction}`;
    if (identities.has(identity)) {
      throw new Error(`Duplicate crossword entry ${identity}`);
    }
    identities.add(identity);
  }

  return canonical;
}

export async function deriveSolutionKeyPair(
  campaignId: string,
  entries: SolutionEntry[],
): Promise<nacl.SignKeyPair> {
  const canonical = canonicalizeSolution(entries);
  const parts: Uint8Array[] = [
    textEncoder.encode(SOLUTION_DOMAIN),
    lengthPrefixed(campaignId),
  ];

  for (const entry of canonical) {
    parts.push(littleEndianU64(entry.number));
    parts.push(lengthPrefixed(entry.direction));
    parts.push(lengthPrefixed(entry.answer));
  }

  const digestInput = concatBytes(parts);
  const digestBuffer = new ArrayBuffer(digestInput.byteLength);
  new Uint8Array(digestBuffer).set(digestInput);
  const seed = new Uint8Array(
    await crypto.subtle.digest("SHA-256", digestBuffer),
  );
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  seed.fill(0);
  return keyPair;
}

export async function deriveSolutionPublicKey(
  campaignId: string,
  entries: SolutionEntry[],
): Promise<string> {
  const keyPair = await deriveSolutionKeyPair(campaignId, entries);
  const publicKey = bytesToBase64(keyPair.publicKey);
  keyPair.secretKey.fill(0);
  return publicKey;
}

export function buildClaimMessage(input: ClaimMessageInput): Uint8Array {
  const payoutDigest = base64ToBytes(input.payoutDigest);
  if (payoutDigest.length !== 32) {
    throw new Error("Payout digest must encode exactly 32 bytes");
  }

  return concatBytes([
    textEncoder.encode(CLAIM_DOMAIN),
    lengthPrefixed(input.contractId),
    lengthPrefixed(input.campaignId),
    lengthPrefixed(input.receiverId),
    payoutDigest,
    littleEndianU64(input.nonce),
    littleEndianU64(input.deadlineMs),
  ]);
}

export async function signClaimPermit(
  campaignId: string,
  entries: SolutionEntry[],
  input: ClaimMessageInput,
): Promise<{ signature: string; solutionPublicKey: string }> {
  if (campaignId !== input.campaignId) {
    throw new Error("Campaign ID does not match the claim message");
  }

  const keyPair = await deriveSolutionKeyPair(campaignId, entries);
  const message = buildClaimMessage(input);
  const signature = nacl.sign.detached(message, keyPair.secretKey);
  const solutionPublicKey = bytesToBase64(keyPair.publicKey);
  keyPair.secretKey.fill(0);

  return {
    signature: bytesToBase64(signature),
    solutionPublicKey,
  };
}

export function verifyClaimSignature(
  solutionPublicKey: string,
  signature: string,
  input: ClaimMessageInput,
): boolean {
  const publicKey = base64ToBytes(solutionPublicKey);
  const signatureBytes = base64ToBytes(signature);
  if (publicKey.length !== 32 || signatureBytes.length !== 64) return false;
  return nacl.sign.detached.verify(
    buildClaimMessage(input),
    signatureBytes,
    publicKey,
  );
}
