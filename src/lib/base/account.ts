import {
  encodeFunctionData,
  getAddress,
  hashTypedData,
  numberToHex,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { baseClaimTypedData } from "./claim";
import { learningRewardsAbi } from "./escrow-abi";

export interface AccountProvider {
  request(args: {
    method: string;
    params?: readonly unknown[] | object;
  }): Promise<unknown>;
  on(
    event: "accountsChanged" | "chainChanged" | "disconnect",
    listener: () => void,
  ): unknown;
  removeListener(
    event: "accountsChanged" | "chainChanged" | "disconnect",
    listener: () => void,
  ): unknown;
}
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

export async function createAccountProvider(
  chainId: number,
): Promise<AccountProvider> {
  if (chainId !== 8453 && chainId !== 84532)
    throw new Error("Base Account is unavailable on this network");
  const { createBaseAccountSDK } = await import("@base-org/account/browser");
  return createBaseAccountSDK({
    appName: "Crossword",
    appChainIds: [chainId],
    preference: { telemetry: false },
  }).getProvider();
}

export async function connectAccount(
  provider: AccountProvider,
  chainId: number,
) {
  const result = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(result) || typeof result[0] !== "string")
    throw new Error("No account was connected");
  const recipient = getAddress(result[0]);
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: numberToHex(chainId) }],
  });
  await assertAccount(provider, recipient, chainId);
  return recipient;
}

export async function assertAccount(
  provider: AccountProvider,
  recipient: string,
  chainId: number,
) {
  const accounts = await provider.request({ method: "eth_accounts" });
  const network = await provider.request({ method: "eth_chainId" });
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== "string" ||
    accounts[0].toLowerCase() !== recipient.toLowerCase() ||
    typeof network !== "string" ||
    BigInt(network) !== BigInt(chainId)
  )
    throw new Error("Account or network changed. Reconnect before continuing.");
}

export async function signWalletChallenge(
  provider: AccountProvider,
  recipient: Address,
  chainId: number,
  message: string,
) {
  await assertAccount(provider, recipient, chainId);
  const signature = await provider.request({
    method: "personal_sign",
    params: [stringToHex(message), recipient],
  });
  await assertAccount(provider, recipient, chainId);
  if (
    typeof signature !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature) ||
    signature.length > 8194
  )
    throw new Error("Wallet returned an unsupported proof");
  return signature;
}

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
  provider: AccountProvider,
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
  await assertAccount(provider, expected.recipient, expected.chainId);
  const capabilities = await provider.request({
    method: "wallet_getCapabilities",
    params: [expected.recipient, [numberToHex(expected.chainId)]],
  });
  const support = capabilities as Record<
    string,
    { paymasterService?: { supported?: boolean } }
  > | null;
  if (!support?.[numberToHex(expected.chainId)]?.paymasterService?.supported)
    throw new Error(
      "This account cannot receive sponsored gas. No transaction was sent.",
    );
  await assertAccount(provider, expected.recipient, expected.chainId);
  beforeSubmission?.();
  const result = await provider.request({
    method: "wallet_sendCalls",
    params: [
      {
        version: "2.0.0",
        chainId: numberToHex(expected.chainId),
        from: expected.recipient,
        atomicRequired: true,
        calls: [call],
        capabilities: { paymasterService: { url: proxy.href, context: { token: permit.token } } },
      },
    ],
  });
  const id =
    typeof result === "string"
      ? result
      : (result as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !/^0x[0-9a-fA-F]{1,512}$/.test(id))
    throw new Error(
      "Wallet submission is uncertain. Check your reward before trying again.",
    );
  return id;
}
