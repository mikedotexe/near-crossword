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

import { baseClaimTypedData } from "../src/lib/base/claim";
import { learningRewardsAbi } from "../src/lib/base/escrow-abi";

loadEnv({ path: ".env.local" });

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
const CAMPAIGN_ID = 2n;
const CAMPAIGN_BLOCK = 46_520_630n;
const CAMPAIGN_TERMS_HASH =
  "0x3b60ea34ab812431829219dd6ffb9947198cc2068cc9373604cff73bff88594e" as Hex;
const REWARD_ATOMIC = 1_000_000n;
const SLOT = 0;
const CLAIM_DEADLINE = 1_788_816_600n;
const PARTICIPANT_ID = keccak256(
  toBytes("crossword:base-sepolia:campaign-2:terms-mismatch-recovery:v1"),
);
const EXPECTED_NONCE = 5;
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

async function decryptSponsor() {
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
  const { stdout } = await execFile(
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
  const matches = stdout.match(/(?:0x)?[0-9a-fA-F]{64}/g) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      "Foundry returned an unexpected keystore decryption result.",
    );
  }
  const privateKey = (
    matches[0].startsWith("0x") ? matches[0] : `0x${matches[0]}`
  ) as Hex;
  const account = privateKeyToAccount(privateKey);
  requireEqual("decrypted sponsor", getAddress(account.address), SPONSOR);
  return account;
}

async function main() {
  requireEqual("chain ID", await publicClient.getChainId(), CHAIN_ID);
  const finalized = await publicClient.getBlock({ blockTag: "finalized" });
  if (finalized.number < CAMPAIGN_BLOCK) {
    throw new Error("Campaign 2 is not finalized.");
  }
  const [
    code,
    campaign,
    count,
    reserved,
    outstanding,
    slotUsed,
    participantUsed,
    allowance,
    sponsorUsdc,
    escrowUsdc,
    sponsorEth,
    nonce,
  ] = await Promise.all([
    publicClient.getCode({ address: ESCROW, blockNumber: finalized.number }),
    publicClient.readContract({
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "getCampaign",
      args: [CAMPAIGN_ID],
      blockNumber: finalized.number,
    }),
    publicClient.readContract({
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "campaignCount",
      blockNumber: finalized.number,
    }),
    publicClient.readContract({
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "totalReserved",
      blockNumber: finalized.number,
    }),
    publicClient.readContract({
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "outstanding",
      args: [CAMPAIGN_ID],
      blockNumber: finalized.number,
    }),
    publicClient.readContract({
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "usedSlots",
      args: [CAMPAIGN_ID, SLOT],
      blockNumber: finalized.number,
    }),
    publicClient.readContract({
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "claimedParticipants",
      args: [CAMPAIGN_ID, PARTICIPANT_ID],
      blockNumber: finalized.number,
    }),
    publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "allowance",
      args: [SPONSOR, ESCROW],
      blockNumber: finalized.number,
    }),
    publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [SPONSOR],
      blockNumber: finalized.number,
    }),
    publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [ESCROW],
      blockNumber: finalized.number,
    }),
    publicClient.getBalance({ address: SPONSOR }),
    publicClient.getTransactionCount({ address: SPONSOR }),
  ]);
  if (!code) throw new Error("Escrow has no runtime code.");
  requireEqual(
    "escrow runtime hash",
    keccak256(code),
    EXPECTED_ESCROW_CODE_HASH,
  );
  requireEqual("campaign count", count, CAMPAIGN_ID);
  requireEqual("total reserved", reserved, REWARD_ATOMIC);
  requireEqual("campaign outstanding", outstanding, REWARD_ATOMIC);
  requireEqual("slot used", slotUsed, false);
  requireEqual("participant used", participantUsed, false);
  requireEqual("allowance", allowance, 0n);
  requireEqual("sponsor USDC", sponsorUsdc, 0n);
  requireEqual("escrow USDC", escrowUsdc, REWARD_ATOMIC);
  requireEqual("sponsor nonce", nonce, EXPECTED_NONCE);
  requireEqual("campaign sponsor", getAddress(campaign.sponsor), SPONSOR);
  requireEqual(
    "campaign terms hash",
    campaign.terms.termsHash,
    CAMPAIGN_TERMS_HASH,
  );
  requireEqual(
    "campaign signer",
    getAddress(campaign.terms.eligibilitySigner),
    ELIGIBILITY_SIGNER,
  );
  requireEqual("campaign reward", campaign.terms.rewardAtomic, REWARD_ATOMIC);
  requireEqual("campaign max claims", campaign.terms.maxClaims, 1);
  requireEqual("campaign signer epoch", campaign.signerEpoch, 1n);
  requireEqual("campaign paid count", campaign.paidCount, 0);
  requireEqual("campaign refunded", campaign.refundedAtomic, 0n);
  requireEqual("campaign paused", campaign.paused, false);
  requireEqual("campaign closed", campaign.closed, false);

  const now = BigInt(Math.floor(Date.now() / 1_000));
  if (
    now < campaign.terms.startsAt ||
    now > CLAIM_DEADLINE ||
    CLAIM_DEADLINE > campaign.terms.claimDeadline
  ) {
    throw new Error("Recovery claim window is unavailable.");
  }
  const eligibilityCredential = process.env.BASE_ELIGIBILITY_PRIVATE_KEY as
    | Hex
    | undefined;
  if (!eligibilityCredential?.match(/^0x[0-9a-fA-F]{64}$/)) {
    throw new Error("The dedicated eligibility signer is unavailable.");
  }
  const eligibilityAccount = privateKeyToAccount(eligibilityCredential);
  requireEqual(
    "eligibility signer",
    getAddress(eligibilityAccount.address),
    ELIGIBILITY_SIGNER,
  );
  const claim = {
    campaignId: CAMPAIGN_ID,
    slot: SLOT,
    participantId: PARTICIPANT_ID,
    recipient: SPONSOR,
    amount: REWARD_ATOMIC,
    deadline: CLAIM_DEADLINE,
    signerEpoch: 1n,
  };
  const signature = await eligibilityAccount.signTypedData(
    baseClaimTypedData(CHAIN_ID, ESCROW, claim),
  );
  await publicClient.simulateContract({
    account: SPONSOR,
    address: ESCROW,
    abi: learningRewardsAbi,
    functionName: "claim",
    args: [claim, signature],
  });
  const [estimatedGas, estimatedL1Fee, fees] = await Promise.all([
    publicClient.estimateContractGas({
      account: SPONSOR,
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "claim",
      args: [claim, signature],
    }),
    estimateContractL1Fee(publicClient, {
      account: SPONSOR,
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "claim",
      args: [claim, signature],
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
  if (maximumCost > MAX_TRANSACTION_COST_WEI || sponsorEth < maximumCost) {
    throw new Error("Recovery claim exceeds the testnet fee boundary.");
  }

  console.log(
    JSON.stringify(
      {
        preflight: {
          mode: SEND ? "send" : "preflight",
          chainId: CHAIN_ID,
          finalizedBlock: finalized.number.toString(),
          campaignId: CAMPAIGN_ID.toString(),
          slot: SLOT,
          participantId: PARTICIPANT_ID,
          recipient: SPONSOR,
          rewardAtomic: REWARD_ATOMIC.toString(),
          claimDeadline: CLAIM_DEADLINE.toString(),
          signatureHash: keccak256(signature),
          sponsorNonce: nonce,
          estimatedGas: estimatedGas.toString(),
          gasLimit: gasLimit.toString(),
          estimatedL1FeeEth: formatEther(estimatedL1Fee),
          maximumExecutionCostEth: formatEther(maximumExecutionCost),
          maximumCostEth: formatEther(maximumCost),
        },
      },
      null,
      2,
    ),
  );
  if (!SEND) return;

  const sponsorAccount = await decryptSponsor();
  const walletClient = createWalletClient({
    account: sponsorAccount,
    chain: baseSepolia,
    transport: http(process.env.BASE_RPC_URL ?? "https://sepolia.base.org"),
  });
  const transactionHash = await walletClient.writeContract({
    address: ESCROW,
    abi: learningRewardsAbi,
    functionName: "claim",
    args: [claim, signature],
    gas: gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
  console.log(JSON.stringify({ submitted: { transactionHash } }, null, 2));
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
    confirmations: 1,
  });
  requireEqual("transaction status", receipt.status, "success");
  const events = parseEventLogs({
    abi: learningRewardsAbi,
    eventName: "RewardPaid",
    logs: receipt.logs,
    strict: true,
  });
  if (events.length !== 1)
    throw new Error(
      `Expected one RewardPaid event, received ${events.length}.`,
    );
  requireEqual("event campaign", events[0].args.campaignId, CAMPAIGN_ID);
  requireEqual("event slot", events[0].args.slot, SLOT);
  requireEqual(
    "event participant",
    events[0].args.participantId,
    PARTICIPANT_ID,
  );
  requireEqual(
    "event recipient",
    getAddress(events[0].args.recipient),
    SPONSOR,
  );
  requireEqual("event amount", events[0].args.amount, REWARD_ATOMIC);

  const [
    newReserved,
    newOutstanding,
    newSlotUsed,
    newParticipantUsed,
    newSponsorUsdc,
    newEscrowUsdc,
    newCampaign,
  ] = await retryRpcReplica(() =>
    Promise.all([
      publicClient.readContract({
        address: ESCROW,
        abi: learningRewardsAbi,
        functionName: "totalReserved",
        blockNumber: receipt.blockNumber,
      }),
      publicClient.readContract({
        address: ESCROW,
        abi: learningRewardsAbi,
        functionName: "outstanding",
        args: [CAMPAIGN_ID],
        blockNumber: receipt.blockNumber,
      }),
      publicClient.readContract({
        address: ESCROW,
        abi: learningRewardsAbi,
        functionName: "usedSlots",
        args: [CAMPAIGN_ID, SLOT],
        blockNumber: receipt.blockNumber,
      }),
      publicClient.readContract({
        address: ESCROW,
        abi: learningRewardsAbi,
        functionName: "claimedParticipants",
        args: [CAMPAIGN_ID, PARTICIPANT_ID],
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
        args: [CAMPAIGN_ID],
        blockNumber: receipt.blockNumber,
      }),
    ]),
  );
  requireEqual("new reserve", newReserved, 0n);
  requireEqual("new outstanding", newOutstanding, 0n);
  requireEqual("new slot used", newSlotUsed, true);
  requireEqual("new participant used", newParticipantUsed, true);
  requireEqual("new sponsor USDC", newSponsorUsdc, REWARD_ATOMIC);
  requireEqual("new escrow USDC", newEscrowUsdc, 0n);
  requireEqual("new paid count", newCampaign.paidCount, 1);
  const executionFee = receipt.gasUsed * receipt.effectiveGasPrice;
  const l1Fee = receipt.l1Fee ?? 0n;
  console.log(
    JSON.stringify(
      {
        result: {
          transactionHash,
          blockNumber: receipt.blockNumber.toString(),
          blockHash: receipt.blockHash,
          gasUsed: receipt.gasUsed.toString(),
          executionFeeEth: formatEther(executionFee),
          l1FeeEth: formatEther(l1Fee),
          totalFeeEth: formatEther(executionFee + l1Fee),
          sponsorUsdcAtomic: newSponsorUsdc.toString(),
          escrowUsdcAtomic: newEscrowUsdc.toString(),
          totalReservedAtomic: newReserved.toString(),
        },
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Campaign recovery failed.",
  );
  process.exitCode = 1;
});
