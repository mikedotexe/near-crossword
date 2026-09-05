import { getAddress, hashTypedData, isHex, size, type Address, type Hex } from "viem";

export interface BaseClaim {
  campaignId: bigint;
  slot: number;
  participantId: Hex;
  recipient: Address;
  amount: bigint;
  deadline: bigint;
  signerEpoch: bigint;
}

export const baseClaimTypes = {
  Claim: [
    { name: "campaignId", type: "uint256" },
    { name: "slot", type: "uint32" },
    { name: "participantId", type: "bytes32" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "signerEpoch", type: "uint64" },
  ],
} as const;

export function baseClaimTypedData(chainId: number, contract: Address, claim: BaseClaim) {
  if (chainId !== 8453 && chainId !== 84532 && chainId !== 31337) throw new Error("Unsupported reward chain");
  const verifyingContract = getAddress(contract);
  const recipient = getAddress(claim.recipient);
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  if (verifyingContract === zeroAddress || recipient === zeroAddress || recipient === verifyingContract) {
    throw new Error("Invalid claim address");
  }
  if (!Number.isInteger(claim.slot) || claim.slot < 0 || claim.slot >= 2 ** 32) throw new Error("Invalid slot");
  if (!isHex(claim.participantId, { strict: true }) || size(claim.participantId) !== 32 || BigInt(claim.participantId) === 0n) {
    throw new Error("Invalid participant ID");
  }
  for (const [value, bits] of [[claim.campaignId, 256n], [claim.amount, 256n], [claim.deadline, 64n], [claim.signerEpoch, 64n]]) {
    if (typeof value !== "bigint" || value <= 0n || value >= 1n << bits) throw new Error("Invalid claim integer");
  }
  return {
    domain: { name: "Crossword Learning Rewards", version: "1", chainId, verifyingContract },
    types: baseClaimTypes,
    primaryType: "Claim" as const,
    message: { ...claim, recipient },
  };
}

export function baseClaimDigest(chainId: number, contract: Address, claim: BaseClaim): Hex {
  return hashTypedData(baseClaimTypedData(chainId, contract, claim));
}
