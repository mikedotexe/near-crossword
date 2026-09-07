import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { config as loadEnv } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseEventLogs,
  toBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { estimateContractL1Fee } from "viem/op-stack";

import { learningRewardsAbi } from "../src/lib/base/escrow-abi";

loadEnv({ path: ".env.local" });

// Exact, one-shot harness for replacement campaign 3 and approved review revision 2.
const execFile = promisify(execFileCallback);
const SEND = process.argv.includes("--send");

const CHAIN_ID = 84_532;
const ESCROW = getAddress("0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304");
const EXPECTED_ESCROW_CODE_HASH =
  "0xebc5371a9a09231045c01981600b619436374e6226048855a6116d1d0c2dce00" as Hex;
const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const SPONSOR = getAddress("0x3Bb5330334D301Cd1976cA025F0eFDEBeeeE7faA");
const ELIGIBILITY_SIGNER = getAddress(
  "0xD7F85d32390329cce4e7375d121c912fd3119bF5",
);
const REWARD_ATOMIC = 1_000_000n;
const MAX_CLAIMS = 1;
const EXPECTED_CAMPAIGN_COUNT = 2n;
const EXPECTED_NONCE = 7;
const STARTS_AT = 1_788_818_400n;
const ENDS_AT = 1_789_423_200n;
const CLAIM_DEADLINE = 1_790_028_000n;
const EXPECTED_TERMS_HASH =
  "0x8ceb4b64f564424caf61e0957dc2bd090ce7cf315178f498468f1ed482d97ad8" as Hex;
const MAX_TRANSACTION_COST_WEI = 10_000_000_000_000n;
const KEYSTORE_DIRECTORY =
  "/Users/mikepurvis/.local/share/crossword/base-sepolia-deployer";
const KEYSTORE_ACCOUNT = "9fd9af63-cd7b-4ce7-a4a2-e35d88965823";
const KEYCHAIN_SERVICE = "xyz.crossword.base-sepolia.deployer";
const KEYCHAIN_ACCOUNT = "base-sepolia-deployer";

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.BASE_RPC_URL ?? "https://sepolia.base.org"),
});

function requireEqual<T>(label: string, actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${String(expected)}, received ${String(actual)}`,
    );
  }
}

function timestamp(seconds: bigint) {
  return new Date(Number(seconds) * 1_000).toISOString();
}

async function retryRpcReplica<T>(operation: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw lastError;
}

async function canonicalReceipt(hash: Hex) {
  return retryRpcReplica(async () => {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    const block = await publicClient.getBlock({
      blockNumber: receipt.blockNumber,
    });
    if (receipt.blockHash !== block.hash) {
      throw new Error("Transaction receipt has not reached a canonical RPC replica.");
    }
    return receipt;
  });
}

async function main() {
  const chainId = await publicClient.getChainId();
  requireEqual("chain ID", chainId, CHAIN_ID);

  const [
    latestBlock,
    finalizedBlock,
    escrowCode,
    token,
    campaignCount,
    totalReserved,
    allowance,
    sponsorUsdc,
    escrowUsdc,
    sponsorEth,
    nonce,
  ] = await Promise.all([
    publicClient.getBlock({ blockTag: "latest" }),
    publicClient.getBlock({ blockTag: "finalized" }),
    publicClient.getCode({ address: ESCROW }),
    publicClient.readContract({
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "token",
    }),
    publicClient.readContract({
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "campaignCount",
    }),
    publicClient.readContract({
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "totalReserved",
    }),
    publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "allowance",
      args: [SPONSOR, ESCROW],
    }),
    publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [SPONSOR],
    }),
    publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [ESCROW],
    }),
    publicClient.getBalance({ address: SPONSOR }),
    publicClient.getTransactionCount({ address: SPONSOR }),
  ]);

  if (!escrowCode) throw new Error("Escrow has no runtime code.");
  requireEqual(
    "escrow runtime code hash",
    keccak256(escrowCode),
    EXPECTED_ESCROW_CODE_HASH,
  );
  requireEqual("escrow token", getAddress(token), USDC);
  requireEqual("campaign count", campaignCount, EXPECTED_CAMPAIGN_COUNT);
  requireEqual("total reserved", totalReserved, 0n);
  requireEqual("USDC allowance", allowance, REWARD_ATOMIC);
  requireEqual("sponsor USDC", sponsorUsdc, REWARD_ATOMIC);
  requireEqual("escrow USDC", escrowUsdc, 0n);
  requireEqual("sponsor nonce", nonce, EXPECTED_NONCE);

  if (latestBlock.timestamp >= STARTS_AT) {
    throw new Error("Approved campaign 3 start time is no longer in the future.");
  }
  const publicTerms = JSON.stringify({
    version: "base-learning-terms:v1",
    campaignId: "247c4bff-fb70-4a50-b78e-9d6ed194ab4d",
    revision: 2,
    contentHash:
      "0xe9bcd7414d0e1ec148a2b78789044997180c99149d58c6b27d8e92f77e7a35bb",
    chainId: CHAIN_ID,
    escrow: ESCROW.toLowerCase(),
    token: USDC.toLowerCase(),
    sponsor: SPONSOR.toLowerCase(),
    initialSigner: ELIGIBILITY_SIGNER.toLowerCase(),
    rewardAtomic: REWARD_ATOMIC.toString(),
    maxClaims: MAX_CLAIMS,
    startsAt: Number(STARTS_AT),
    endsAt: Number(ENDS_AT),
    claimDeadline: Number(CLAIM_DEADLINE),
    eligibilityPolicy: "verified-email-wallet-completion:v1",
    privacyPolicy: "private-email-optional-sponsor-contact:v1",
    signerPolicy: "sponsor-pause-rotation-no-deadline-extension:v1",
  });
  const termsHash = keccak256(toBytes(publicTerms));
  requireEqual("canonical review terms hash", termsHash, EXPECTED_TERMS_HASH);
  const terms = {
    rewardAtomic: REWARD_ATOMIC,
    maxClaims: MAX_CLAIMS,
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    claimDeadline: CLAIM_DEADLINE,
    termsHash,
    eligibilitySigner: ELIGIBILITY_SIGNER,
  };

  await publicClient.simulateContract({
    account: SPONSOR,
    address: ESCROW,
    abi: learningRewardsAbi,
    functionName: "createCampaign",
    args: [terms],
  });

  const [estimatedGas, estimatedL1Fee, fees] = await Promise.all([
    publicClient.estimateContractGas({
      account: SPONSOR,
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "createCampaign",
      args: [terms],
    }),
    estimateContractL1Fee(publicClient, {
      account: SPONSOR,
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "createCampaign",
      args: [terms],
    }),
    publicClient.estimateFeesPerGas(),
  ]);
  const gasLimit = (estimatedGas * 125n + 99n) / 100n;
  const maxFeePerGas = fees.maxFeePerGas;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
  if (!maxFeePerGas || !maxPriorityFeePerGas)
    throw new Error("RPC did not return EIP-1559 fees.");
  const maximumExecutionCost = gasLimit * maxFeePerGas;
  const maximumCost = maximumExecutionCost + estimatedL1Fee * 2n;
  if (maximumCost > MAX_TRANSACTION_COST_WEI) {
    throw new Error(
      `Maximum transaction cost ${maximumCost} exceeds the testnet safety limit.`,
    );
  }
  if (sponsorEth < maximumCost)
    throw new Error(
      "Sponsor test ETH cannot cover the maximum transaction cost.",
    );

  const preflight = {
    mode: SEND ? "send" : "preflight",
    chainId,
    latestBlock: latestBlock.number.toString(),
    finalizedBlock: finalizedBlock.number.toString(),
    sponsor: SPONSOR,
    escrow: ESCROW,
    token: USDC,
    expectedCampaignId: (campaignCount + 1n).toString(),
    rewardAtomic: REWARD_ATOMIC.toString(),
    maxClaims: MAX_CLAIMS,
    startsAt: { unix: STARTS_AT.toString(), iso: timestamp(STARTS_AT) },
    endsAt: { unix: ENDS_AT.toString(), iso: timestamp(ENDS_AT) },
    claimDeadline: {
      unix: CLAIM_DEADLINE.toString(),
      iso: timestamp(CLAIM_DEADLINE),
    },
    termsHash,
    publicTerms,
    eligibilitySigner: ELIGIBILITY_SIGNER,
    allowanceAtomic: allowance.toString(),
    sponsorUsdcAtomic: sponsorUsdc.toString(),
    sponsorEth: formatEther(sponsorEth),
    nonce,
    estimatedGas: estimatedGas.toString(),
    gasLimit: gasLimit.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    estimatedL1FeeEth: formatEther(estimatedL1Fee),
    maximumExecutionCostEth: formatEther(maximumExecutionCost),
    maximumCostEth: formatEther(maximumCost),
  };

  console.log(JSON.stringify({ preflight }, null, 2));
  if (!SEND) return;

  const { stdout: passwordOutput } = await execFile(
    "security",
    [
      "find-generic-password",
      "-w",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
    ],
    { maxBuffer: 4_096 },
  );
  const password = passwordOutput.replace(/[\r\n]+$/, "");
  if (!password)
    throw new Error("Keychain returned an empty deployer password.");
  const { stdout: decryptOutput } = await execFile(
    "cast",
    [
      "wallet",
      "decrypt-keystore",
      KEYSTORE_ACCOUNT,
      "--keystore-dir",
      KEYSTORE_DIRECTORY,
    ],
    {
      env: { ...process.env, CAST_UNSAFE_PASSWORD: password },
      maxBuffer: 4_096,
    },
  );
  const privateKeyMatches =
    decryptOutput.match(/(?:0x)?[0-9a-fA-F]{64}/g) ?? [];
  if (privateKeyMatches.length !== 1) {
    throw new Error(
      "Foundry returned an unexpected keystore decryption result.",
    );
  }
  const privateKey = (
    privateKeyMatches[0].startsWith("0x")
      ? privateKeyMatches[0]
      : `0x${privateKeyMatches[0]}`
  ) as Hex;
  const sponsorAccount = privateKeyToAccount(privateKey);
  requireEqual(
    "decrypted sponsor",
    getAddress(sponsorAccount.address),
    SPONSOR,
  );

  const walletClient = createWalletClient({
    account: sponsorAccount,
    chain: baseSepolia,
    transport: http(process.env.BASE_RPC_URL ?? "https://sepolia.base.org"),
  });
  const transactionHash = await walletClient.writeContract({
    address: ESCROW,
    abi: learningRewardsAbi,
    functionName: "createCampaign",
    args: [terms],
    gas: gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
  console.log(JSON.stringify({ submitted: { transactionHash } }, null, 2));
  const receipt = await canonicalReceipt(transactionHash);
  requireEqual("transaction status", receipt.status, "success");

  const events = parseEventLogs({
    abi: learningRewardsAbi,
    eventName: "CampaignFunded",
    logs: receipt.logs,
    strict: true,
  });
  if (events.length !== 1)
    throw new Error(
      `Expected one CampaignFunded event, received ${events.length}.`,
    );
  const campaignId = events[0].args.campaignId;
  requireEqual("campaign ID", campaignId, campaignCount + 1n);

  const [
    newCampaignCount,
    newTotalReserved,
    newAllowance,
    newSponsorUsdc,
    newEscrowUsdc,
    campaign,
  ] = await retryRpcReplica(() =>
    Promise.all([
      publicClient.readContract({
        address: ESCROW,
        abi: learningRewardsAbi,
        functionName: "campaignCount",
        blockNumber: receipt.blockNumber,
      }),
      publicClient.readContract({
        address: ESCROW,
        abi: learningRewardsAbi,
        functionName: "totalReserved",
        blockNumber: receipt.blockNumber,
      }),
      publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "allowance",
        args: [SPONSOR, ESCROW],
        blockNumber: receipt.blockNumber,
      }),
      publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [SPONSOR],
        blockNumber: receipt.blockNumber,
      }),
      publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [ESCROW],
        blockNumber: receipt.blockNumber,
      }),
      publicClient.readContract({
        address: ESCROW,
        abi: learningRewardsAbi,
        functionName: "getCampaign",
        args: [campaignId],
        blockNumber: receipt.blockNumber,
      }),
    ]),
  );
  requireEqual("new campaign count", newCampaignCount, campaignId);
  requireEqual("new total reserved", newTotalReserved, REWARD_ATOMIC);
  requireEqual("new allowance", newAllowance, 0n);
  requireEqual("new sponsor USDC", newSponsorUsdc, 0n);
  requireEqual("new escrow USDC", newEscrowUsdc, REWARD_ATOMIC);
  requireEqual("stored sponsor", getAddress(campaign.sponsor), SPONSOR);
  requireEqual("stored terms hash", campaign.terms.termsHash, termsHash);
  const executionFee = receipt.gasUsed * receipt.effectiveGasPrice;
  const l1Fee = receipt.l1Fee ?? 0n;

  console.log(
    JSON.stringify(
      {
        result: {
          transactionHash,
          status: receipt.status,
          blockNumber: receipt.blockNumber.toString(),
          blockHash: receipt.blockHash,
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice.toString(),
          executionFeeEth: formatEther(executionFee),
          l1FeeEth: formatEther(l1Fee),
          totalFeeEth: formatEther(executionFee + l1Fee),
          campaignId: campaignId.toString(),
          totalReservedAtomic: newTotalReserved.toString(),
          escrowUsdcAtomic: newEscrowUsdc.toString(),
          allowanceAtomic: newAllowance.toString(),
        },
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Campaign operation failed.",
  );
  process.exitCode = 1;
});
