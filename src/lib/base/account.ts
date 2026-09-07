import {
  encodeFunctionData,
  getAddress,
  hashTypedData,
  type Address,
  type Hex,
} from "viem";
import type {
  SendUserOperationOptions,
  SendUserOperationResult,
} from "@coinbase/cdp-core";
import { baseClaimTypedData } from "./claim";
import { learningRewardsAbi } from "./escrow-abi";

export type WalletConfiguration = {
  enabled: boolean;
  sponsoredGas: boolean;
  proxyUrl: string | null;
};
export type SponsorshipPermit = { token: string; expiresAt: number; digest: Hex };
export type AuthorizedReward = {
  status: "AUTHORIZED";
  digest: Hex;
  signature: Hex;
  typedData: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: Address;
    };
    message: {
      campaignId: string;
      slot: number;
      participantId: Hex;
      recipient: Address;
      amount: string;
      deadline: string;
      signerEpoch: string;
    };
  };
};

export type CdpSendUserOperation = (
  options: SendUserOperationOptions,
) => Promise<SendUserOperationResult>;

export function claimCall(
  reward: AuthorizedReward,
  expected: {
    recipient: string;
    chainId: number;
    escrow: string;
    onChainId: string;
    rewardAtomic: string;
    claimDeadline: number;
  },
) {
  const domain = reward.typedData.domain,
    m = reward.typedData.message;
  if (
    reward.status !== "AUTHORIZED" ||
    domain.chainId !== expected.chainId ||
    domain.verifyingContract.toLowerCase() !== expected.escrow.toLowerCase() ||
    domain.name !== "Crossword Learning Rewards" ||
    domain.version !== "1" ||
    m.recipient.toLowerCase() !== expected.recipient.toLowerCase() ||
    m.campaignId !== expected.onChainId ||
    m.amount !== expected.rewardAtomic ||
    BigInt(m.deadline) !== BigInt(expected.claimDeadline) ||
    BigInt(m.deadline) < BigInt(Math.floor(Date.now() / 1000))
  )
    throw new Error("Reward details changed. Refresh before continuing.");
  const claim = {
    ...m,
    campaignId: BigInt(m.campaignId),
    amount: BigInt(m.amount),
    deadline: BigInt(m.deadline),
    signerEpoch: BigInt(m.signerEpoch),
  };
  if (
    hashTypedData(
      baseClaimTypedData(domain.chainId, domain.verifyingContract, claim),
    ) !== reward.digest
  )
    throw new Error("Reward commitment does not match");
  return {
    to: domain.verifyingContract,
    value: "0x0" as const,
    data: encodeFunctionData({
      abi: learningRewardsAbi,
      functionName: "claim",
      args: [claim, reward.signature],
    }),
  };
}

export async function sendSponsoredClaim(
  sendUserOperation: CdpSendUserOperation,
  reward: AuthorizedReward,
  expected: Parameters<typeof claimCall>[1],
  configuration: WalletConfiguration,
  permit: SponsorshipPermit,
  beforeSubmission?: () => void,
) {
  if (
    !configuration.enabled ||
    !configuration.sponsoredGas ||
    !configuration.proxyUrl
  )
    throw new Error("Sponsored claims are not enabled");
  const proxy = new URL(configuration.proxyUrl);
  if (
    proxy.protocol !== "https:" ||
    proxy.username ||
    proxy.password ||
    proxy.search ||
    proxy.hash ||
    proxy.hostname === "api.developer.coinbase.com"
  )
    throw new Error("A reviewed sponsorship proxy is required");
  const call = claimCall(reward, expected);
  if (!permit || !/^[0-9a-f]{64}$/.test(permit.token) || permit.digest !== reward.digest ||
      !Number.isSafeInteger(permit.expiresAt) || permit.expiresAt <= Math.floor(Date.now() / 1000) + 15)
    throw new Error("A fresh claim-specific gas permit is required");
  const network = expected.chainId === 84532
    ? "base-sepolia"
    : expected.chainId === 8453
      ? "base"
      : null;
  if (!network) throw new Error("CDP Wallet is unavailable on this network");
  beforeSubmission?.();
  const result = await sendUserOperation({
    evmSmartAccount: getAddress(expected.recipient),
    network,
    calls: [{ ...call, value: 0n }],
    paymasterUrl: proxy.href,
    paymasterContext: { token: permit.token },
  });
  const id = result?.userOperationHash;
  if (typeof id !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(id))
    throw new Error(
      "Wallet submission is uncertain. Check your reward before trying again.",
    );
  return id;
}
