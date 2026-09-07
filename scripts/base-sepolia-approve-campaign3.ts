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
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { estimateContractL1Fee } from "viem/op-stack";

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
const RECOVERY_BLOCK = 46_521_526n;
const AMOUNT = 1_000_000n;
const EXPECTED_NONCE = 6;
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

async function decryptSponsor() {
  const { stdout: passwordOutput } = await execFile(
    "security",
    ["find-generic-password", "-w", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT],
    { maxBuffer: 4_096 },
  );
  const password = passwordOutput.replace(/[\r\n]+$/, "");
  if (!password) throw new Error("Keychain returned an empty deployer password.");
  const { stdout } = await execFile(
    "cast",
    ["wallet", "decrypt-keystore", KEYSTORE_ACCOUNT, "--keystore-dir", KEYSTORE_DIRECTORY],
    { env: { ...process.env, CAST_UNSAFE_PASSWORD: password }, maxBuffer: 4_096 },
  );
  const matches = stdout.match(/(?:0x)?[0-9a-fA-F]{64}/g) ?? [];
  if (matches.length !== 1) throw new Error("Foundry returned an unexpected keystore decryption result.");
  const key = (matches[0].startsWith("0x") ? matches[0] : `0x${matches[0]}`) as Hex;
  const account = privateKeyToAccount(key);
  requireEqual("decrypted sponsor", getAddress(account.address), SPONSOR);
  return account;
}

async function main() {
  requireEqual("chain ID", await publicClient.getChainId(), CHAIN_ID);
  const finalized = await publicClient.getBlock({ blockTag: "finalized" });
  if (finalized.number < RECOVERY_BLOCK) throw new Error("Campaign 2 recovery is not finalized.");
  const [code, count, reserved, campaign, outstanding, slotUsed, sponsorUsdc, escrowUsdc, allowance, nonce, sponsorEth] =
    await Promise.all([
      publicClient.getCode({ address: ESCROW, blockNumber: finalized.number }),
      publicClient.readContract({ address: ESCROW, abi: learningRewardsAbi, functionName: "campaignCount", blockNumber: finalized.number }),
      publicClient.readContract({ address: ESCROW, abi: learningRewardsAbi, functionName: "totalReserved", blockNumber: finalized.number }),
      publicClient.readContract({ address: ESCROW, abi: learningRewardsAbi, functionName: "getCampaign", args: [2n], blockNumber: finalized.number }),
      publicClient.readContract({ address: ESCROW, abi: learningRewardsAbi, functionName: "outstanding", args: [2n], blockNumber: finalized.number }),
      publicClient.readContract({ address: ESCROW, abi: learningRewardsAbi, functionName: "usedSlots", args: [2n, 0], blockNumber: finalized.number }),
      publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [SPONSOR], blockNumber: finalized.number }),
      publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [ESCROW], blockNumber: finalized.number }),
      publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [SPONSOR, ESCROW], blockNumber: finalized.number }),
      publicClient.getTransactionCount({ address: SPONSOR }),
      publicClient.getBalance({ address: SPONSOR }),
    ]);
  if (!code) throw new Error("Escrow has no runtime code.");
  requireEqual("escrow runtime hash", keccak256(code), EXPECTED_ESCROW_CODE_HASH);
  requireEqual("campaign count", count, 2n);
  requireEqual("total reserved", reserved, 0n);
  requireEqual("campaign 2 outstanding", outstanding, 0n);
  requireEqual("campaign 2 slot", slotUsed, true);
  requireEqual("campaign 2 paid count", campaign.paidCount, 1);
  requireEqual("sponsor USDC", sponsorUsdc, AMOUNT);
  requireEqual("escrow USDC", escrowUsdc, 0n);
  requireEqual("allowance", allowance, 0n);
  requireEqual("sponsor nonce", nonce, EXPECTED_NONCE);

  await publicClient.simulateContract({ account: SPONSOR, address: USDC, abi: erc20Abi, functionName: "approve", args: [ESCROW, AMOUNT] });
  const [estimatedGas, estimatedL1Fee, fees] = await Promise.all([
    publicClient.estimateContractGas({ account: SPONSOR, address: USDC, abi: erc20Abi, functionName: "approve", args: [ESCROW, AMOUNT] }),
    estimateContractL1Fee(publicClient, { account: SPONSOR, address: USDC, abi: erc20Abi, functionName: "approve", args: [ESCROW, AMOUNT] }),
    publicClient.estimateFeesPerGas(),
  ]);
  const gasLimit = (estimatedGas * 125n + 99n) / 100n;
  const maxFeePerGas = fees.maxFeePerGas;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
  if (!maxFeePerGas || !maxPriorityFeePerGas) throw new Error("RPC did not return EIP-1559 fees.");
  const maximumExecutionCost = gasLimit * maxFeePerGas;
  const maximumCost = maximumExecutionCost + estimatedL1Fee * 2n;
  if (maximumCost > MAX_TRANSACTION_COST_WEI || sponsorEth < maximumCost) {
    throw new Error("Approval exceeds the testnet fee boundary.");
  }
  console.log(JSON.stringify({ preflight: {
    mode: SEND ? "send" : "preflight",
    finalizedBlock: finalized.number.toString(),
    owner: SPONSOR,
    spender: ESCROW,
    amountAtomic: AMOUNT.toString(),
    sponsorNonce: nonce,
    estimatedGas: estimatedGas.toString(),
    gasLimit: gasLimit.toString(),
    estimatedL1FeeEth: formatEther(estimatedL1Fee),
    maximumExecutionCostEth: formatEther(maximumExecutionCost),
    maximumCostEth: formatEther(maximumCost),
  } }, null, 2));
  if (!SEND) return;

  const account = await decryptSponsor();
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(process.env.BASE_RPC_URL ?? "https://sepolia.base.org") });
  const transactionHash = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [ESCROW, AMOUNT], gas: gasLimit, maxFeePerGas, maxPriorityFeePerGas });
  console.log(JSON.stringify({ submitted: { transactionHash } }, null, 2));
  const receipt = await canonicalReceipt(transactionHash);
  requireEqual("transaction status", receipt.status, "success");
  const events = parseEventLogs({ abi: erc20Abi, eventName: "Approval", logs: receipt.logs, strict: true });
  if (events.length !== 1) throw new Error(`Expected one Approval event, received ${events.length}.`);
  requireEqual("approval owner", getAddress(events[0].args.owner), SPONSOR);
  requireEqual("approval spender", getAddress(events[0].args.spender), ESCROW);
  requireEqual("approval amount", events[0].args.value, AMOUNT);
  const savedAllowance = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [SPONSOR, ESCROW], blockNumber: receipt.blockNumber });
  requireEqual("saved allowance", savedAllowance, AMOUNT);
  const executionFee = receipt.gasUsed * receipt.effectiveGasPrice;
  const l1Fee = receipt.l1Fee ?? 0n;
  console.log(JSON.stringify({ result: {
    transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    executionFeeEth: formatEther(executionFee),
    l1FeeEth: formatEther(l1Fee),
    totalFeeEth: formatEther(executionFee + l1Fee),
    allowanceAtomic: savedAllowance.toString(),
  } }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Campaign approval failed.");
  process.exitCode = 1;
});
