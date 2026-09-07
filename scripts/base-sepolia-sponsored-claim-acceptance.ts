import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";

import { config as loadEnv } from "dotenv";
import {
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  hashTypedData,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  sliceHex,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createBundlerClient,
  createPaymasterClient,
  toCoinbaseSmartAccount,
} from "viem/account-abstraction";
import { baseSepolia } from "viem/chains";

import { baseClaimTypedData } from "../src/lib/base/claim";
import { learningRewardsAbi } from "../src/lib/base/escrow-abi";

loadEnv({ path: ".env.local" });

const HOST = "127.0.0.1";
const PORT = 3125;
const CHAIN_ID = 84_532;
const CHAIN_ID_HEX = "0x14a34";
const ENTRYPOINT_V06 = getAddress("0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789");
const BASE_ACCOUNT_FACTORY = getAddress("0xba5ed110efdba3d005bfc882d75358acbbb85842");
const CDP_V06_PAYMASTER = getAddress("0x709a4bae3db73a8e717aefca13e88512f738b27f");
const ESCROW = getAddress("0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304");
const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const EXPECTED_ELIGIBILITY_SIGNER = getAddress("0xD7F85d32390329cce4e7375d121c912fd3119bF5");
const CAMPAIGN_ID = 1n;
const CAMPAIGN_BLOCK = 46_444_150n;
const SLOT = 0;
const REWARD_ATOMIC = 1_000_000n;
const CLAIM_DEADLINE = 1_788_766_310n;
const SIGNER_EPOCH = 1n;
const MAX_REQUEST_BYTES = 64 * 1024;
const HEADLESS_LOCAL = process.argv.includes("--headless-local");
const SEND_HEADLESS_CLAIM = process.argv.includes("--send");

if (SEND_HEADLESS_CLAIM && !HEADLESS_LOCAL) {
  throw new Error("--send requires --headless-local.");
}

const upstreamUrl = process.env.BASE_PAYMASTER_UPSTREAM_URL;
const eligibilityCredential = process.env.BASE_ELIGIBILITY_PRIVATE_KEY as Hex | undefined;

if (!upstreamUrl) {
  throw new Error("BASE_PAYMASTER_UPSTREAM_URL is missing from .env.local.");
}

if (!eligibilityCredential?.startsWith("0x")) {
  throw new Error("BASE_ELIGIBILITY_PRIVATE_KEY is missing from .env.local.");
}

const cdpPaymasterUrl = upstreamUrl;
const eligibilitySigner = privateKeyToAccount(eligibilityCredential);

if (getAddress(eligibilitySigner.address) !== EXPECTED_ELIGIBILITY_SIGNER) {
  throw new Error("Eligibility signer does not match the campaign signer.");
}

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.BASE_RPC_URL ?? "https://sepolia.base.org"),
});

const smartAccountAbi = parseAbi([
  "function execute(address target,uint256 value,bytes data)",
  "function executeBatch((address target,uint256 value,bytes data)[] calls)",
]);

const accountFactoryAbi = parseAbi([
  "function createAccount(bytes[] owners,uint256 nonce) returns (address)",
  "function getAddress(bytes[] owners,uint256 nonce) view returns (address)",
]);

const rewardPaidEvent = parseAbiItem(
  "event RewardPaid(uint256 indexed campaignId,uint32 indexed slot,bytes32 indexed participantId,address recipient,uint256 amount)",
);

type Authorization = {
  call: {
    to: Address;
    value: "0x0";
    data: Hex;
  };
  claim: {
    campaignId: bigint;
    slot: number;
    participantId: Hex;
    recipient: Address;
    amount: bigint;
    deadline: bigint;
    signerEpoch: bigint;
  };
  digest: Hex;
  recipient: Address;
  signatureHash: string;
};

type Evidence = {
  generatedAt: string;
  localUrl: string;
  publicProxyOrigin?: string;
  campaign: {
    chainId: number;
    escrow: Address;
    campaignId: string;
    slot: number;
    rewardAtomic: string;
    deploymentBlock: string;
  };
  checks: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
};

type UserOperation = {
  sender: Hex;
  nonce: Hex;
  initCode: Hex;
  callData: Hex;
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
  paymasterAndData?: Hex;
  signature?: Hex;
};

type PaymasterRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params: unknown[];
};

let publicProxyOrigin: string | null = null;
let lastAuthorization: Authorization | null = null;
let activePermit:
  | {
      tokenHash: string;
      expiresAt: number;
      recipient: Address;
      validatedMethods: Set<string>;
    }
  | null = null;
let lastPaymasterAddress: Address | null = null;
let lastPaymasterCodeHash: Hex | null = null;
let serverClosed = false;

const evidencePath = `/tmp/crossword-base-sponsored-claim-acceptance-${Date.now()}.json`;
const evidence: Evidence = {
  generatedAt: new Date().toISOString(),
  localUrl: `http://${HOST}:${PORT}/`,
  campaign: {
    chainId: CHAIN_ID,
    escrow: ESCROW,
    campaignId: CAMPAIGN_ID.toString(),
    slot: SLOT,
    rewardAtomic: REWARD_ATOMIC.toString(),
    deploymentBlock: CAMPAIGN_BLOCK.toString(),
  },
  checks: {},
  events: [],
};

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function record(kind: string, data: Record<string, unknown>) {
  evidence.events.push({
    at: new Date().toISOString(),
    kind,
    ...data,
  });
  void writeEvidence();
}

async function writeEvidence() {
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-origin": "*",
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
  });
  response.end(body);
}

function isLocalRequest(request: IncomingMessage) {
  const host = request.headers.host?.split(":")[0]?.toLowerCase();
  return host === HOST || host === "localhost";
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.byteLength;
    if (length > MAX_REQUEST_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as unknown) : null;
}

function jsonRpcError(id: PaymasterRequest["id"], code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
    },
  };
}

function expectHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`${label} is not hex.`);
  }
  return value as Hex;
}

function expectQuantity(value: unknown, label: string): Hex {
  const hex = expectHex(value, label);
  if (hex !== "0x0" && /^0x0[0-9a-fA-F]/.test(hex)) {
    throw new Error(`${label} is not a normalized quantity.`);
  }
  return hex;
}

function normalizeAddress(value: unknown, label: string): Address {
  if (typeof value !== "string") {
    throw new Error(`${label} is not an address.`);
  }
  return getAddress(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function parsePaymasterRequest(value: unknown): PaymasterRequest {
  const body = asRecord(value, "JSON-RPC request");
  const params = body.params;

  if (body.jsonrpc !== "2.0") {
    throw new Error("Unsupported JSON-RPC version.");
  }

  if (typeof body.method !== "string") {
    throw new Error("Missing JSON-RPC method.");
  }

  if (!Array.isArray(params) || params.length < 3) {
    throw new Error("Missing paymaster params.");
  }

  return {
    jsonrpc: "2.0",
    id: typeof body.id === "string" || typeof body.id === "number" || body.id === null ? body.id : null,
    method: body.method,
    params,
  };
}

function parseUserOperation(value: unknown): UserOperation {
  const op = asRecord(value, "UserOperation");
  return {
    sender: expectHex(op.sender, "sender"),
    nonce: expectQuantity(op.nonce, "nonce"),
    initCode: expectHex(op.initCode, "initCode"),
    callData: expectHex(op.callData, "callData"),
    callGasLimit: expectQuantity(op.callGasLimit, "callGasLimit"),
    verificationGasLimit: expectQuantity(op.verificationGasLimit, "verificationGasLimit"),
    preVerificationGas: expectQuantity(op.preVerificationGas, "preVerificationGas"),
    maxFeePerGas: expectQuantity(op.maxFeePerGas, "maxFeePerGas"),
    maxPriorityFeePerGas: expectQuantity(op.maxPriorityFeePerGas, "maxPriorityFeePerGas"),
    paymasterAndData: typeof op.paymasterAndData === "string" ? expectHex(op.paymasterAndData, "paymasterAndData") : undefined,
    signature: typeof op.signature === "string" ? expectHex(op.signature, "signature") : undefined,
  };
}

async function getUsdcBalance(address: Address) {
  return publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

async function getCampaignState() {
  const [campaign, claimed, outstanding, token, finalizedBlock, latestBlock] = await Promise.all([
    publicClient.readContract({
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "getCampaign",
      args: [CAMPAIGN_ID],
    }),
    publicClient.readContract({
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "usedSlots",
      args: [CAMPAIGN_ID, SLOT],
    }),
    publicClient.readContract({
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "outstanding",
      args: [CAMPAIGN_ID],
    }),
    publicClient.readContract({
      address: ESCROW,
      abi: learningRewardsAbi,
      functionName: "token",
    }),
    publicClient.getBlock({ blockTag: "finalized" }),
    publicClient.getBlockNumber(),
  ]);

  return {
    campaign,
    claimed,
    outstanding,
    token,
    finalizedBlock,
    latestBlock,
  };
}

async function verifyCampaignReady() {
  const state = await getCampaignState();
  const campaign = state.campaign as unknown as {
    terms: {
      rewardAtomic: bigint;
      maxClaims: number;
      claimDeadline: bigint;
      eligibilitySigner: Address;
    };
    signerEpoch: bigint;
  };

  const checks = {
    latestBlock: state.latestBlock.toString(),
    finalizedBlock: state.finalizedBlock.number.toString(),
    campaignFinalized: state.finalizedBlock.number >= CAMPAIGN_BLOCK,
    claimed: state.claimed,
    outstandingAtomic: state.outstanding.toString(),
    rewardToken: getAddress(state.token),
    rewardAtomic: campaign.terms.rewardAtomic.toString(),
    maxClaims: campaign.terms.maxClaims,
    signerEpoch: campaign.signerEpoch.toString(),
    eligibilitySigner: getAddress(campaign.terms.eligibilitySigner),
    claimDeadline: campaign.terms.claimDeadline.toString(),
  };

  evidence.checks.campaignReady = checks;
  await writeEvidence();

  if (!checks.campaignFinalized) {
    throw new Error("Campaign block is not finalized yet.");
  }
  if (checks.claimed) {
    throw new Error("The one-slot campaign has already been claimed.");
  }
  if (checks.outstandingAtomic !== REWARD_ATOMIC.toString()) {
    throw new Error("Unexpected campaign outstanding balance.");
  }
  if (checks.rewardToken !== USDC || checks.rewardAtomic !== REWARD_ATOMIC.toString()) {
    throw new Error("Unexpected reward token or amount.");
  }
  if (checks.eligibilitySigner !== EXPECTED_ELIGIBILITY_SIGNER) {
    throw new Error("Unexpected eligibility signer.");
  }
  if (checks.signerEpoch !== SIGNER_EPOCH.toString()) {
    throw new Error("Unexpected signer epoch.");
  }
}

async function authorizeRecipient(recipientInput: unknown) {
  if (!publicProxyOrigin) {
    throw new Error("Public paymaster tunnel is not ready yet.");
  }

  const recipient = normalizeAddress(recipientInput, "recipient");

  if (lastAuthorization && lastAuthorization.recipient !== recipient) {
    throw new Error("This one-slot acceptance harness is already bound to a recipient.");
  }

  if (activePermit?.validatedMethods.has("pm_getPaymasterData")) {
    throw new Error("A final paymaster operation has already been observed for this claim.");
  }

  const [ethBalance, usdcBalance, code, campaignState] = await Promise.all([
    publicClient.getBalance({ address: recipient }),
    getUsdcBalance(recipient),
    publicClient.getCode({ address: recipient }),
    getCampaignState(),
  ]);

  const accountFreshness = {
    recipient,
    ethWei: ethBalance.toString(),
    usdcAtomic: usdcBalance.toString(),
    deployedCode: Boolean(code && code !== "0x"),
  };

  evidence.checks.accountFreshness = accountFreshness;

  if (campaignState.claimed) {
    throw new Error("The claim slot is already used.");
  }

  if (ethBalance !== 0n || usdcBalance !== 0n || (code && code !== "0x")) {
    throw new Error("Connect a fresh Base Account with no ETH, no USDC, and no deployed code.");
  }

  const participantId = lastAuthorization?.claim.participantId ?? (`0x${randomBytes(32).toString("hex")}` as Hex);
  const claim = {
    campaignId: CAMPAIGN_ID,
    slot: SLOT,
    participantId,
    recipient,
    amount: REWARD_ATOMIC,
    deadline: CLAIM_DEADLINE,
    signerEpoch: SIGNER_EPOCH,
  };
  const typedData = baseClaimTypedData(CHAIN_ID, ESCROW, claim);
  const signature = await eligibilitySigner.signTypedData(typedData);
  const digest = hashTypedData(typedData);
  const verified = await verifyTypedData({
    ...typedData,
    address: EXPECTED_ELIGIBILITY_SIGNER,
    signature,
  });

  if (!verified) {
    throw new Error("Local claim authorization verification failed.");
  }

  const data = encodeFunctionData({
    abi: learningRewardsAbi,
    functionName: "claim",
    args: [claim, signature],
  });

  lastAuthorization = {
    call: {
      to: ESCROW,
      value: "0x0",
      data,
    },
    claim,
    digest,
    recipient,
    signatureHash: hashValue(signature),
  };

  const token = `0x${randomBytes(32).toString("hex")}`;
  activePermit = {
    tokenHash: hashValue(token),
    expiresAt: Math.min(Math.floor(Date.now() / 1000) + 10 * 60, Number(CLAIM_DEADLINE)),
    recipient,
    validatedMethods: new Set(),
  };

  record("authorized_claim", {
    recipient,
    digest,
    participantHash: hashValue(participantId),
    signatureHash: lastAuthorization.signatureHash,
    accountFreshness,
  });

  return {
    chainId: CHAIN_ID,
    chainIdHex: CHAIN_ID_HEX,
    recipient,
    campaignId: CAMPAIGN_ID.toString(),
    slot: SLOT,
    rewardAtomic: REWARD_ATOMIC.toString(),
    rewardUsdc: formatUnits(REWARD_ATOMIC, 6),
    digest,
    permitExpiresAt: activePermit.expiresAt,
    paymasterUrl: `${publicProxyOrigin}/paymaster/${paymasterPath}/${token.slice(2)}`,
    call: lastAuthorization.call,
  };
}

function decodeClaimCall(callData: Hex) {
  const decoded = decodeFunctionData({
    abi: smartAccountAbi,
    data: callData,
  });

  if (decoded.functionName === "execute") {
    const [target, value, data] = decoded.args;
    return [{ target: getAddress(target), value, data: data as Hex }];
  }

  if (decoded.functionName === "executeBatch") {
    return decoded.args[0].map((call) => ({
      target: getAddress(call.target),
      value: call.value,
      data: call.data as Hex,
    }));
  }

  throw new Error("Unsupported smart-account call.");
}

async function validateInitCode(sender: Address, initCode: Hex) {
  if (initCode === "0x") {
    const code = await publicClient.getCode({ address: sender });
    if (!code || code === "0x") {
      throw new Error("Missing initCode for undeployed sender.");
    }
    return {
      deployed: Boolean(code && code !== "0x"),
      factory: null,
      predictedMatchesSender: null,
    };
  }

  const factory = getAddress(sliceHex(initCode, 0, 20));
  const factoryData = sliceHex(initCode, 20);

  if (factory !== BASE_ACCOUNT_FACTORY) {
    throw new Error("Unexpected account factory.");
  }

  const decoded = decodeFunctionData({
    abi: accountFactoryAbi,
    data: factoryData,
  });

  if (decoded.functionName !== "createAccount") {
    throw new Error("Unexpected account factory function.");
  }

  const [owners, nonce] = decoded.args;
  const predicted = await publicClient.readContract({
    address: BASE_ACCOUNT_FACTORY,
    abi: accountFactoryAbi,
    functionName: "getAddress",
    args: [owners, nonce],
  });

  if (getAddress(predicted) !== sender) {
    throw new Error("Counterfactual sender does not match factory prediction.");
  }

  return {
    deployed: false,
    factory,
    predictedMatchesSender: true,
    ownerCount: owners.length,
  };
}

async function validateSponsorshipRequest(request: PaymasterRequest, pathPermitToken: string | null) {
  if (request.method !== "pm_getPaymasterStubData" && request.method !== "pm_getPaymasterData") {
    throw new Error("Unsupported paymaster method.");
  }

  if (!lastAuthorization || !activePermit) {
    throw new Error("No active claim authorization.");
  }

  const op = parseUserOperation(request.params[0]);
  const entryPoint = normalizeAddress(request.params[1], "entryPoint");
  const chainId = expectQuantity(request.params[2], "chainId");
  const context = asRecord(request.params[3] ?? {}, "context");
  const sender = normalizeAddress(op.sender, "sender");

  if (entryPoint !== ENTRYPOINT_V06) {
    throw new Error("Unexpected EntryPoint.");
  }

  if (Number(BigInt(chainId)) !== CHAIN_ID) {
    throw new Error("Unexpected chain id.");
  }

  if (sender !== lastAuthorization.recipient || sender !== activePermit.recipient) {
    throw new Error("Unexpected sender.");
  }

  const contextPermitToken = typeof context.token === "string" ? context.token : null;
  const permitToken = contextPermitToken ?? pathPermitToken;
  if (!permitToken || hashValue(permitToken) !== activePermit.tokenHash) {
    throw new Error("Missing or invalid paymaster context.");
  }

  if (Math.floor(Date.now() / 1000) > activePermit.expiresAt) {
    throw new Error("Paymaster context expired.");
  }

  if (activePermit.validatedMethods.has(request.method)) {
    throw new Error("Duplicate paymaster method for this claim permit.");
  }

  if (BigInt(op.callGasLimit) > 750_000n) {
    throw new Error("callGasLimit is too high.");
  }

  if (BigInt(op.verificationGasLimit) > 1_200_000n) {
    throw new Error("verificationGasLimit is too high.");
  }

  if (BigInt(op.preVerificationGas) > 250_000n) {
    throw new Error("preVerificationGas is too high.");
  }

  const calls = decodeClaimCall(op.callData);
  if (calls.length !== 1) {
    throw new Error("Expected exactly one smart-account call.");
  }

  const call = calls[0];
  if (call.target !== ESCROW || call.value !== 0n || call.data.toLowerCase() !== lastAuthorization.call.data.toLowerCase()) {
    throw new Error("Smart-account call does not match the authorized claim.");
  }

  const initCodeCheck = await validateInitCode(sender, op.initCode);

  await publicClient.call({
    account: sender,
    to: ESCROW,
    data: lastAuthorization.call.data,
    gas: 1_000_000n,
  });

  activePermit.validatedMethods.add(request.method);

  record("paymaster_request_validated", {
    method: request.method,
    sender,
    entryPoint,
    initCode: initCodeCheck,
    callGasLimit: BigInt(op.callGasLimit).toString(),
    verificationGasLimit: BigInt(op.verificationGasLimit).toString(),
    preVerificationGas: BigInt(op.preVerificationGas).toString(),
  });

  return { op, entryPoint, chainId };
}

async function validatePaymasterResult(result: unknown, method: PaymasterRequest["method"]) {
  const recordResult = asRecord(result, "paymaster result");

  if (typeof recordResult.paymasterAndData !== "string") {
    throw new Error("CDP response did not include paymasterAndData.");
  }

  const paymasterAndData = expectHex(recordResult.paymasterAndData, "paymasterAndData");
  if (paymasterAndData.length !== 2 + 194 * 2) {
    throw new Error("Unexpected paymasterAndData length.");
  }

  const paymaster = getAddress(sliceHex(paymasterAndData, 0, 20));
  const validUntil = Number(BigInt(sliceHex(paymasterAndData, 20, 26)));
  const validAfter = Number(BigInt(sliceHex(paymasterAndData, 26, 32)));
  const precheckBalance = BigInt(sliceHex(paymasterAndData, 49, 50)) !== 0n;
  const prepaymentRequired = BigInt(sliceHex(paymasterAndData, 50, 51)) !== 0n;
  const paymentToken = getAddress(sliceHex(paymasterAndData, 51, 71));
  const paymentReceiver = getAddress(sliceHex(paymasterAndData, 71, 91));
  const exchangeRate = BigInt(sliceHex(paymasterAndData, 91, 123));

  if (!activePermit) {
    throw new Error("No active paymaster context.");
  }

  if (paymaster !== CDP_V06_PAYMASTER) {
    throw new Error("Unexpected CDP EntryPoint 0.6 paymaster.");
  }

  if (method === "pm_getPaymasterData" && (
    paymentToken !== getAddress("0x0000000000000000000000000000000000000000") ||
    paymentReceiver !== getAddress("0x0000000000000000000000000000000000000000") ||
    exchangeRate !== 0n
  )) {
    throw new Error("Paymaster response requests ERC-20 gas payment.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (validAfter > now + 60 || validUntil < now || validUntil > activePermit.expiresAt) {
    throw new Error("Paymaster validity window is outside the local permit window.");
  }

  const code = await publicClient.getCode({ address: paymaster });
  if (!code || code === "0x") {
    throw new Error("Paymaster address has no code.");
  }

  lastPaymasterAddress = paymaster;
  lastPaymasterCodeHash = keccak256(code);

  record("paymaster_result_validated", {
    method,
    paymaster,
    paymasterCodeHash: lastPaymasterCodeHash,
    validAfter,
    validUntil,
    precheckBalance,
    prepaymentRequired,
    erc20GasPayment: paymentToken !== getAddress("0x0000000000000000000000000000000000000000"),
    returnedKeys: Object.keys(recordResult).sort(),
  });
}

async function handlePaymaster(request: IncomingMessage, response: ServerResponse, pathPermitToken: string | null) {
  let rpc: PaymasterRequest | null = null;

  try {
    const body = await readJson(request);
    rpc = parsePaymasterRequest(body);
    await validateSponsorshipRequest(rpc, pathPermitToken);

    const upstreamResponse = await fetch(cdpPaymasterUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpc.id ?? 1,
        method: rpc.method,
        params: [rpc.params[0], rpc.params[1], rpc.params[2], {}],
      }),
    });

    const upstreamPayload = (await upstreamResponse.json()) as unknown;
    const upstreamRecord = asRecord(upstreamPayload, "CDP response");

    if (!upstreamResponse.ok || upstreamRecord.error) {
      record("paymaster_upstream_rejected", {
        method: rpc.method,
        status: upstreamResponse.status,
        errorCode: asRecord(upstreamRecord.error ?? {}, "error").code ?? null,
      });
      return sendJson(response, 502, jsonRpcError(rpc.id, -32000, "Sponsorship service rejected the request."));
    }

    await validatePaymasterResult(upstreamRecord.result, rpc.method);

    return sendJson(response, 200, upstreamPayload);
  } catch (error) {
    record("paymaster_request_denied", {
      method: rpc?.method ?? null,
      reason: error instanceof Error ? error.message : "Unknown error.",
    });
    return sendJson(response, 403, jsonRpcError(rpc?.id, -32602, "Sponsorship request denied."));
  }
}

async function scanRewardPaid() {
  if (!lastAuthorization) {
    throw new Error("No recipient has been authorized yet.");
  }

  const logs = await publicClient.getLogs({
    address: ESCROW,
    event: rewardPaidEvent,
    args: {
      campaignId: CAMPAIGN_ID,
      slot: SLOT,
      participantId: lastAuthorization.claim.participantId,
    },
    fromBlock: CAMPAIGN_BLOCK,
    toBlock: "latest",
  });

  const matchingLog = logs.find(
    (log) => log.args.recipient && getAddress(log.args.recipient) === lastAuthorization?.recipient,
  );

  const [ethBalance, usdcBalance, campaignState, latestBlock, finalizedBlock] = await Promise.all([
    publicClient.getBalance({ address: lastAuthorization.recipient }),
    getUsdcBalance(lastAuthorization.recipient),
    getCampaignState(),
    publicClient.getBlockNumber(),
    publicClient.getBlock({ blockTag: "finalized" }),
  ]);

  const result: Record<string, unknown> = {
    recipient: lastAuthorization.recipient,
    recipientEthWei: ethBalance.toString(),
    recipientEth: formatEther(ethBalance),
    recipientUsdcAtomic: usdcBalance.toString(),
    recipientUsdc: formatUnits(usdcBalance, 6),
    slotClaimed: campaignState.claimed,
    outstandingAtomic: campaignState.outstanding.toString(),
    latestBlock: latestBlock.toString(),
    finalizedBlock: finalizedBlock.number.toString(),
    paymaster: lastPaymasterAddress,
    paymasterCodeHash: lastPaymasterCodeHash,
  };

  if (matchingLog) {
    const receipt = await publicClient.getTransactionReceipt({ hash: matchingLog.transactionHash });
    Object.assign(result, {
      transactionHash: matchingLog.transactionHash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      finalized: finalizedBlock.number >= receipt.blockNumber,
      rewardAmountAtomic: matchingLog.args.amount?.toString(),
    });
  }

  evidence.checks.latestScan = result;
  await writeEvidence();
  return result;
}

function publicStatus() {
  return {
    ready: Boolean(publicProxyOrigin),
    localUrl: evidence.localUrl,
    evidencePath,
    campaign: evidence.campaign,
    authorizedRecipient: lastAuthorization?.recipient ?? null,
    paymaster: lastPaymasterAddress,
    paymasterCodeHash: lastPaymasterCodeHash,
    eventCount: evidence.events.length,
  };
}

function makePage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Crossword Base Sepolia Acceptance</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #1c211f;
        --muted: #66706b;
        --line: #d9dfda;
        --accent: #235c50;
        --panel: #f7f8f4;
        --danger: #a43b32;
      }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #fbfaf5;
        color: var(--ink);
      }
      main {
        width: min(760px, calc(100vw - 32px));
        margin: 48px auto;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
        letter-spacing: 0;
      }
      p {
        margin: 0 0 24px;
        color: var(--muted);
        line-height: 1.45;
      }
      .panel {
        border: 1px solid var(--line);
        background: var(--panel);
        border-radius: 8px;
        padding: 18px;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 16px 0;
      }
      button {
        min-height: 42px;
        border: 0;
        border-radius: 8px;
        background: var(--accent);
        color: white;
        font: inherit;
        font-weight: 700;
        padding: 0 16px;
        cursor: pointer;
      }
      button.secondary {
        background: white;
        border: 1px solid var(--line);
        color: var(--ink);
      }
      button:disabled {
        cursor: wait;
        opacity: 0.62;
      }
      dl {
        display: grid;
        grid-template-columns: minmax(120px, 180px) 1fr;
        gap: 8px 14px;
        margin: 0;
        font-size: 14px;
      }
      dt {
        color: var(--muted);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      pre {
        min-height: 180px;
        margin: 16px 0 0;
        padding: 14px;
        overflow: auto;
        border-radius: 8px;
        border: 1px solid var(--line);
        background: #101413;
        color: #e9efe7;
        font-size: 13px;
        line-height: 1.45;
      }
      .error {
        color: var(--danger);
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Base Sepolia Claim Test</h1>
      <p>This page uses one fresh Base sub-account to claim the one funded Sepolia reward through the CDP paymaster.</p>
      <section class="panel">
        <dl>
          <dt>Campaign</dt><dd>1</dd>
          <dt>Reward</dt><dd>1 test USDC</dd>
          <dt>Network</dt><dd>Base Sepolia</dd>
          <dt>Recipient</dt><dd id="recipient">Not connected</dd>
          <dt>Status</dt><dd id="status">Waiting</dd>
        </dl>
        <div class="row">
          <button id="connect">Connect</button>
          <button id="claim" disabled>Claim</button>
          <button id="check" class="secondary" disabled>Check</button>
        </div>
        <pre id="log"></pre>
      </section>
    </main>
    <script src="/base-account.min.js"></script>
    <script>
      const chainIdHex = "${CHAIN_ID_HEX}";
      const logEl = document.querySelector("#log");
      const statusEl = document.querySelector("#status");
      const recipientEl = document.querySelector("#recipient");
      const connectButton = document.querySelector("#connect");
      const claimButton = document.querySelector("#claim");
      const checkButton = document.querySelector("#check");
      let sdk;
      let provider;
      let account;
      let universalAccount;
      let subAccount;
      let authorization;
      let batchId;
      let currentStep = "idle";

      const setStatus = (value, error = false) => {
        statusEl.textContent = value;
        statusEl.className = error ? "error" : "";
      };

      const append = (value) => {
        const line = typeof value === "string" ? value : JSON.stringify(value, null, 2);
        logEl.textContent = [line, logEl.textContent].filter(Boolean).join("\\n\\n");
      };

      const sanitizeError = (error) => ({
        step: currentStep,
        message: error?.message || String(error),
        code: error?.code ?? null,
        dataShape: error?.data && typeof error.data === "object" ? Object.keys(error.data) : typeof error?.data
      });

      const summarizeCapabilities = (capabilities) => {
        const chainKeys = capabilities && typeof capabilities === "object" ? Object.keys(capabilities) : [];
        const baseSepoliaCapabilities = capabilities?.[chainIdHex] || capabilities?.["${CHAIN_ID}"];
        return {
          chainKeys,
          baseSepoliaKeys: baseSepoliaCapabilities ? Object.keys(baseSepoliaCapabilities) : [],
          baseSepoliaPaymaster: Boolean(baseSepoliaCapabilities?.paymasterService?.supported)
        };
      };

      const sanitizeSubAccount = (value) => {
        if (!value || typeof value !== "object") return null;
        return {
          address: value.address,
          chainId: value.chainId ?? null,
          factory: value.factory ?? null,
          hasFactoryData: typeof value.factoryData === "string" && value.factoryData !== "0x"
        };
      };

      const sanitizeCallsStatus = (status) => {
        if (!status || typeof status !== "object") return status;
        const receipts = Array.isArray(status.receipts)
          ? status.receipts.map((receipt) => ({
              transactionHash: receipt.transactionHash,
              blockNumber: receipt.blockNumber,
              status: receipt.status
            }))
          : [];
        return {
          id: status.id,
          status: status.status,
          chainId: status.chainId,
          receipts
        };
      };

      async function post(path, body) {
        const response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || payload.message || "Request failed");
        }
        return payload;
      }

      async function recordStep(step, details = {}) {
        currentStep = step;
        append({ step, ...details });
        await post("/record", { type: "clientStep", step, details }).catch(() => {});
      }

      connectButton.addEventListener("click", async () => {
        try {
          setStatus("Connecting");
          connectButton.disabled = true;
          const factory = window.createBaseAccountSDK || window.base?.createBaseAccountSDK;
          if (!factory) throw new Error("Base Account SDK did not load.");
          await recordStep("sdk_factory_loaded");
          sdk = factory({
            appName: "Crossword Sepolia Acceptance",
            appChainIds: [${CHAIN_ID}],
            preference: { telemetry: false },
            subAccounts: {
              creation: "on-connect",
              defaultAccount: "sub",
              funding: "manual"
            }
          });
          provider = sdk.getProvider();
          await recordStep("sdk_created", { subAccountMode: "on-connect/default-sub/manual-funding" });
          await recordStep("chain_switch_before_connect_start", { chainId: chainIdHex });
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
          await recordStep("chain_switch_before_connect_done");
          await recordStep("eth_requestAccounts_start");
          const accounts = await provider.request({ method: "eth_requestAccounts" });
          await recordStep("eth_requestAccounts_done", { accounts });
          subAccount = null;
          if (!subAccount?.address) {
            await recordStep("subAccount_create_start");
            subAccount = await sdk.subAccount.create({ type: "create" });
            await recordStep("subAccount_create_done", { subAccount: sanitizeSubAccount(subAccount) });
          }
          if (!subAccount?.address) {
            throw new Error("Base Account did not return a sub-account.");
          }
          account = subAccount.address;
          universalAccount = accounts.find((candidate) => candidate?.toLowerCase?.() !== account.toLowerCase()) || accounts[0] || null;
          recipientEl.textContent = account;
          await recordStep("recipient_selected", {
            recipient: account,
            universalAccount,
            subAccount: sanitizeSubAccount(subAccount)
          });
          const chainBefore = await provider.request({ method: "eth_chainId" });
          try {
            await recordStep("chain_switch_after_connect_start", { chainId: chainIdHex });
            await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
            await recordStep("chain_switch_after_connect_done");
          } catch (error) {
            append("Chain switch returned: " + (error?.message || "unknown"));
          }
          await recordStep("capabilities_start", { recipient: account });
          const chainAfter = await provider.request({ method: "eth_chainId" });
          const caps = await provider.request({ method: "wallet_getCapabilities", params: [account] });
          const capabilitySummary = summarizeCapabilities(caps);
          await recordStep("capabilities_done", { chainBefore, chainAfter, capabilities: capabilitySummary });
          append({
            chainBefore,
            chainAfter,
            accounts,
            universalAccount,
            subAccount: sanitizeSubAccount(subAccount),
            capabilities: capabilitySummary
          });
          if (chainAfter !== chainIdHex) {
            throw new Error("Base Account is not on Base Sepolia yet.");
          }
          if (!capabilitySummary.baseSepoliaPaymaster) {
            throw new Error("Base Account did not report Base Sepolia paymaster support.");
          }
          await recordStep("authorize_start", { recipient: account });
          authorization = await post("/authorize", { recipient: account });
          await recordStep("authorize_done", {
            recipient: authorization.recipient,
            rewardUsdc: authorization.rewardUsdc,
            digest: authorization.digest
          });
          append({ authorized: { recipient: authorization.recipient, rewardUsdc: authorization.rewardUsdc, digest: authorization.digest } });
          claimButton.disabled = false;
          checkButton.disabled = false;
          setStatus("Ready");
        } catch (error) {
          const safeError = sanitizeError(error);
          await post("/record", { type: "connectError", error: safeError }).catch(() => {});
          append({ connectError: safeError });
          setStatus(safeError.message || "Connect failed", true);
          connectButton.disabled = false;
        }
      });

      claimButton.addEventListener("click", async () => {
        try {
          setStatus("Submitting");
          claimButton.disabled = true;
          await recordStep("claim_submit_start", { recipient: account });
          const result = await provider.request({
            method: "wallet_sendCalls",
            params: [{
              version: "1.0",
              chainId: chainIdHex,
              from: account,
              atomicRequired: true,
              calls: [authorization.call],
              capabilities: {
                paymasterService: {
                  url: authorization.paymasterUrl
                }
              }
            }]
          });
          batchId = typeof result === "string" ? result : result?.id;
          await post("/record", { type: "batch", id: batchId });
          await recordStep("claim_submit_done", { batchId });
          append({ batchId });
          checkButton.disabled = false;
          setStatus("Submitted");
        } catch (error) {
          const safeError = sanitizeError(error);
          await post("/record", { type: "claimError", error: safeError }).catch(() => {});
          append({ claimError: safeError });
          setStatus(safeError.message || "Claim failed", true);
          claimButton.disabled = false;
          checkButton.disabled = false;
        }
      });

      checkButton.addEventListener("click", async () => {
        try {
          setStatus("Checking");
          if (batchId) {
            try {
              const callStatus = await provider.request({ method: "wallet_getCallsStatus", params: [batchId] });
              const sanitized = sanitizeCallsStatus(callStatus);
              append(sanitized);
              await post("/record", { type: "callsStatus", status: sanitized });
            } catch (error) {
              append("Call status unavailable: " + (error?.message || "unknown"));
            }
          }
          const scan = await post("/scan", {});
          append(scan);
          setStatus(scan.transactionHash ? (scan.finalized ? "Finalized" : "Included") : "Pending");
        } catch (error) {
          const safeError = sanitizeError(error);
          append({ checkError: safeError });
          await post("/record", { type: "checkError", error: safeError }).catch(() => {});
          setStatus(safeError.message || "Check failed", true);
        }
      });
    </script>
  </body>
</html>`;
}

async function handleLocalPost(pathname: string, request: IncomingMessage, response: ServerResponse) {
  if (!isLocalRequest(request)) {
    return sendJson(response, 404, { error: "Not found." });
  }

  try {
    const body = await readJson(request);

    if (pathname === "/authorize") {
      const recipient = asRecord(body, "body").recipient;
      const authorization = await authorizeRecipient(recipient);
      return sendJson(response, 200, authorization);
    }

    if (pathname === "/record") {
      const bodyRecord = asRecord(body, "body");
      if (bodyRecord.type === "batch" && typeof bodyRecord.id === "string") {
        record("wallet_batch_submitted", { batchId: bodyRecord.id });
      } else if (bodyRecord.type === "callsStatus") {
        record("wallet_calls_status", { status: bodyRecord.status ?? null });
      } else if (bodyRecord.type === "clientStep" && typeof bodyRecord.step === "string") {
        const details = bodyRecord.details && typeof bodyRecord.details === "object" && !Array.isArray(bodyRecord.details)
          ? bodyRecord.details
          : {};
        record("wallet_client_step", {
          step: bodyRecord.step,
          details,
        });
      } else if (bodyRecord.type === "connectError" || bodyRecord.type === "claimError" || bodyRecord.type === "checkError") {
        const error = asRecord(bodyRecord.error ?? {}, "error");
        const kind = bodyRecord.type === "connectError"
          ? "wallet_connect_error"
          : bodyRecord.type === "claimError"
            ? "wallet_claim_error"
            : "wallet_check_error";
        record(kind, {
          error: {
            step: typeof error.step === "string" ? error.step : null,
            message: typeof error.message === "string" ? error.message : "unknown",
            code: typeof error.code === "number" || typeof error.code === "string" ? error.code : null,
            dataShape: error.dataShape,
          },
        });
      }
      return sendJson(response, 200, { ok: true });
    }

    if (pathname === "/scan") {
      const result = await scanRewardPaid();
      return sendJson(response, 200, result);
    }

    return sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    return sendJson(response, 400, {
      error: error instanceof Error ? error.message : "Request failed.",
    });
  }
}

const paymasterPath = randomBytes(16).toString("hex");

function pathPermitToken(pathname: string) {
  const prefix = `/paymaster/${paymasterPath}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const token = pathname.slice(prefix.length);
  if (!/^[0-9a-fA-F]{64}$/.test(token)) {
    return null;
  }
  return `0x${token}`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  const permitFromPath = pathPermitToken(url.pathname);

  if (request.method === "OPTIONS" && permitFromPath) {
    response.writeHead(204, {
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    response.end();
    return;
  }

  if (request.method === "POST" && permitFromPath) {
    return handlePaymaster(request, response, permitFromPath);
  }

  if (request.method === "GET" && url.pathname === "/status" && isLocalRequest(request)) {
    return sendJson(response, 200, publicStatus());
  }

  if (request.method === "HEAD" && url.pathname === "/" && isLocalRequest(request)) {
    response.writeHead(204, {
      "cache-control": "no-store",
    });
    response.end();
    return;
  }

  if (request.method === "POST" && ["/authorize", "/record", "/scan"].includes(url.pathname)) {
    return handleLocalPost(url.pathname, request, response);
  }

  if (request.method === "GET" && url.pathname === "/" && isLocalRequest(request)) {
    return sendText(response, 200, makePage(), "text/html; charset=utf-8");
  }

  if (request.method === "GET" && url.pathname === "/base-account.min.js" && isLocalRequest(request)) {
    const script = await readFile("node_modules/@base-org/account/dist/base-account.min.js", "utf8");
    return sendText(response, 200, script, "application/javascript; charset=utf-8");
  }

  return sendJson(response, 404, { error: "Not found." });
});

async function startTunnel() {
  const child = spawn("/opt/homebrew/bin/cloudflared", ["tunnel", "--url", `http://${HOST}:${PORT}`, "--no-autoupdate"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.on("exit", (code, signal) => {
    if (!serverClosed) {
      record("cloudflared_exited", { code, signal });
    }
  });

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for cloudflared tunnel URL.")), 60_000);

    const inspect = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const match = text.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };

    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    const cleanup = () => {
      serverClosed = true;
      child.kill("SIGTERM");
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1_000).unref();
    };
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  });
}

async function closeServer() {
  if (!server.listening) {
    return;
  }

  serverClosed = true;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function runHeadlessLocalAccount() {
  publicProxyOrigin = `http://${HOST}:${PORT}`;
  evidence.publicProxyOrigin = "local-only";

  const ownerCredential = generatePrivateKey();
  const owner = privateKeyToAccount(ownerCredential);
  const account = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [owner],
    version: "1.1",
  });

  record("local_smart_account_created", {
    recipient: account.address,
    ownerAddress: owner.address,
    factory: BASE_ACCOUNT_FACTORY,
    entryPoint: ENTRYPOINT_V06,
    ownerCredentialPersisted: false,
  });

  const authorization = await authorizeRecipient(account.address);
  const paymasterClient = createPaymasterClient({
    transport: http(authorization.paymasterUrl),
  });
  const bundlerClient = createBundlerClient({
    account,
    chain: baseSepolia,
    client: publicClient,
    transport: http(cdpPaymasterUrl),
    paymaster: paymasterClient,
  });
  const calls = [{
    to: ESCROW,
    value: 0n,
    data: authorization.call.data,
  }] as const;

  if (!SEND_HEADLESS_CLAIM) {
    const prepared = await bundlerClient.prepareUserOperation({ calls });
    const preparedPaymaster = prepared.paymasterAndData
      ? getAddress(sliceHex(prepared.paymasterAndData, 0, 20))
      : null;

    record("local_user_operation_prepared", {
      recipient: account.address,
      nonce: prepared.nonce.toString(),
      hasInitCode: Boolean(prepared.initCode && prepared.initCode !== "0x"),
      callGasLimit: prepared.callGasLimit.toString(),
      verificationGasLimit: prepared.verificationGasLimit.toString(),
      preVerificationGas: prepared.preVerificationGas.toString(),
      paymaster: preparedPaymaster,
      sent: false,
    });
    evidence.checks.headlessLocal = {
      mode: "prepare-only",
      recipient: account.address,
      ownerCredentialPersisted: false,
      paymaster: preparedPaymaster,
      campaignConsumed: false,
    };
    await writeEvidence();
    console.log(`Prepared a sponsored Coinbase Smart Account claim for ${account.address}.`);
    console.log(`Evidence file: ${evidencePath}`);
    return;
  }

  const userOperationHash = await bundlerClient.sendUserOperation({ calls });
  record("local_user_operation_submitted", {
    recipient: account.address,
    userOperationHash,
  });

  const userOperationReceipt = await bundlerClient.waitForUserOperationReceipt({
    hash: userOperationHash,
    timeout: 180_000,
  });
  record("local_user_operation_included", {
    recipient: account.address,
    userOperationHash,
    transactionHash: userOperationReceipt.receipt.transactionHash,
    blockNumber: userOperationReceipt.receipt.blockNumber.toString(),
    success: userOperationReceipt.success,
  });

  const scan = await scanRewardPaid();
  evidence.checks.headlessLocal = {
    mode: "send",
    recipient: account.address,
    ownerCredentialPersisted: false,
    userOperationHash,
    transactionHash: userOperationReceipt.receipt.transactionHash,
    success: userOperationReceipt.success,
    claimObserved: Boolean(scan.transactionHash),
    recipientUsdcAtomic: scan.recipientUsdcAtomic,
    slotClaimed: scan.slotClaimed,
    outstandingAtomic: scan.outstandingAtomic,
  };
  await writeEvidence();
  console.log(`Sponsored claim included for ${account.address}.`);
  console.log(`Transaction: ${userOperationReceipt.receipt.transactionHash}`);
  console.log(`Evidence file: ${evidencePath}`);
}

async function main() {
  await verifyCampaignReady();

  server.listen(PORT, HOST);
  await once(server, "listening");

  if (HEADLESS_LOCAL) {
    try {
      await runHeadlessLocalAccount();
    } finally {
      await closeServer();
    }
    return;
  }

  publicProxyOrigin = await startTunnel();
  evidence.publicProxyOrigin = publicProxyOrigin;
  await writeEvidence();

  console.log(`Base Sepolia acceptance page: http://${HOST}:${PORT}/`);
  console.log(`Evidence file: ${evidencePath}`);
  console.log("Keep this process running until the claim is included.");
}

main().catch(async (error) => {
  evidence.checks.failure = {
    errorType: error instanceof Error ? error.name : typeof error,
  };
  await writeEvidence().catch(() => undefined);
  console.error("Base Sepolia acceptance failed. See the sanitized evidence file for the recorded boundary.");
  console.error(`Evidence file: ${evidencePath}`);
  process.exitCode = 1;
});
