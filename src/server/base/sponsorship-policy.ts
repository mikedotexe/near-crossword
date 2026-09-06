import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  parseAbi,
  sliceHex,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import { AppError } from "../v2/errors";
import { accountFactoryAbi, type CounterfactualPolicy } from "./counterfactual";
import { sha256 } from "./review";

export const entryPointV06 =
  "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789" as const;
export const smartAccountAbi = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
  "function implementation() view returns (address)",
  "function entryPoint() view returns (address)",
]);
const bytes = z
  .string()
  .max(16386)
  .regex(/^0x(?:[0-9a-fA-F]{2})*$/)
  .transform((v) => v.toLowerCase() as Hex);
const quantity = z
  .string()
  .regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/)
  .transform((v) => v.toLowerCase() as Hex);
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v.toLowerCase() as Address);
const operationSchema = z
  .object({
    sender: address,
    nonce: quantity,
    initCode: bytes,
    callData: bytes,
    callGasLimit: quantity,
    verificationGasLimit: quantity,
    preVerificationGas: quantity,
    maxFeePerGas: quantity,
    maxPriorityFeePerGas: quantity,
  })
  .strict();
export const sponsorshipRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.number().int().safe(), z.string().min(1).max(64)]),
    method: z.enum(["pm_getPaymasterStubData", "pm_getPaymasterData"]),
    params: z.tuple([
      operationSchema,
      address,
      quantity,
      z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    ]),
  })
  .strict();
export type SponsorshipRequest = z.infer<typeof sponsorshipRequestSchema>;
export type SponsorshipOperation = z.infer<typeof operationSchema>;
export type SponsorshipPolicy = {
  chainId: number;
  escrow: Address;
  factory: CounterfactualPolicy;
  proxyCodeHash: Hex;
  entryPointCodeHash: Hex;
  paymaster: Address;
  paymasterCodeHash: Hex;
  maxCallGas: bigint;
  maxVerificationGas: bigint;
  maxPreVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxOperationWei: bigint;
  totalBudgetWei: bigint;
  maxOperationsPerAccount: number;
};
export function sponsorshipDenied(): never {
  throw new AppError(
    403,
    "SPONSORSHIP_DENIED",
    "This operation is not eligible for gas sponsorship",
  );
}
export function sponsorshipUnavailable(): never {
  throw new AppError(
    503,
    "SPONSORSHIP_UNAVAILABLE",
    "Gas sponsorship is unavailable; no automatic retry was sent",
  );
}
export function sponsorshipPolicyHash(policy: SponsorshipPolicy) {
  return sha256(
    JSON.stringify(policy, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );
}
export function parseSponsorshipRequest(raw: unknown): SponsorshipRequest {
  const parsed = sponsorshipRequestSchema.safeParse(raw);
  if (!parsed.success) sponsorshipDenied();
  return parsed.data;
}

export function validateClaimOperation(
  request: SponsorshipRequest,
  expected: { recipient: Address; callData: Hex },
  policy: SponsorshipPolicy,
) {
  const [op, entryPoint, chainId] = request.params;
  if (
    entryPoint !== entryPointV06 ||
    BigInt(chainId) !== BigInt(policy.chainId) ||
    op.sender !== expected.recipient.toLowerCase() ||
    BigInt(op.nonce) >> 64n !== 0n
  )
    sponsorshipDenied();
  try {
    const decoded = decodeFunctionData({
      abi: smartAccountAbi,
      data: op.callData,
    });
    let call: { target: Address; value: bigint; data: Hex };
    if (decoded.functionName === "execute") {
      const [target, value, data] = decoded.args;
      call = { target, value, data };
      if (
        encodeFunctionData({
          abi: smartAccountAbi,
          functionName: "execute",
          args: decoded.args,
        }).toLowerCase() !== op.callData
      )
        sponsorshipDenied();
    } else if (
      decoded.functionName === "executeBatch" &&
      decoded.args[0].length === 1
    ) {
      call = decoded.args[0][0];
      if (
        encodeFunctionData({
          abi: smartAccountAbi,
          functionName: "executeBatch",
          args: decoded.args,
        }).toLowerCase() !== op.callData
      )
        sponsorshipDenied();
    } else sponsorshipDenied();
    if (
      call.target.toLowerCase() !== policy.escrow.toLowerCase() ||
      call.value !== 0n ||
      call.data.toLowerCase() !== expected.callData.toLowerCase()
    )
      sponsorshipDenied();
    if (op.initCode !== "0x") {
      if (sliceHex(op.initCode, 0, 20) !== policy.factory.factory.toLowerCase())
        sponsorshipDenied();
      const data = sliceHex(op.initCode, 20);
      const creation = decodeFunctionData({ abi: accountFactoryAbi, data });
      if (
        creation.functionName !== "createAccount" ||
        creation.args[0].length < 1 ||
        creation.args[0].length > 4 ||
        creation.args[0].some(
          (owner) =>
            ![66, 130].includes(owner.length) ||
            (owner.length === 66 &&
              (BigInt(owner) === 0n || BigInt(owner) >= 1n << 160n)),
        ) ||
        encodeFunctionData({
          abi: accountFactoryAbi,
          functionName: "createAccount",
          args: creation.args,
        }).toLowerCase() !== data
      )
        sponsorshipDenied();
    }
  } catch {
    sponsorshipDenied();
  }
  const gas = [
    BigInt(op.callGasLimit),
    BigInt(op.verificationGasLimit),
    BigInt(op.preVerificationGas),
  ];
  const caps = [
    policy.maxCallGas,
    policy.maxVerificationGas,
    policy.maxPreVerificationGas,
  ];
  const fee = BigInt(op.maxFeePerGas);
  if (
    gas.some((g, i) => g > caps[i]) ||
    fee > policy.maxFeePerGas ||
    BigInt(op.maxPriorityFeePerGas) > fee ||
    (request.method === "pm_getPaymasterData" &&
      (gas.some((g) => g === 0n) || fee === 0n)) ||
    (gas[0] + gas[1] * 3n + gas[2]) * fee > policy.maxOperationWei
  )
    sponsorshipDenied();
  // Gas estimates can evolve, but every authorization for an allocation uses one nonce and exact call.
  return {
    identity: sha256(
      JSON.stringify([
        entryPoint,
        chainId,
        op.sender,
        op.nonce,
        op.initCode,
        op.callData,
      ]),
    ),
    requestHash: sha256(
      JSON.stringify([request.method, op, entryPoint, chainId]),
    ),
  };
}

export function validatePaymasterResult(
  raw: unknown,
  policy: SponsorshipPolicy,
  expiresAt: number,
  stub: boolean,
) {
  const result = z
    .object({
      paymasterAndData: bytes,
      isFinal: z.boolean().optional(),
      sponsor: z
        .object({
          name: z.string().max(100),
          icon: z.string().max(20000).optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .safeParse(raw);
  if (!result.success) sponsorshipUnavailable();
  const data = result.data.paymasterAndData;
  // Coinbase VerifyingPaymaster v1.0.0 / EntryPoint 0.6 packed layout.
  // Bytes 49-50 are inert flags when the token at bytes 51-70 is zero. Current
  // CDP sponsorship sets precheckBalance even though no token payment is used.
  if (
    data.length !== 2 + 194 * 2 ||
    sliceHex(data, 0, 20) !== policy.paymaster.toLowerCase() ||
    BigInt(sliceHex(data, 51, 123)) !== 0n
  )
    sponsorshipUnavailable();
  const validUntil = Number(BigInt(sliceHex(data, 20, 26))),
    validAfter = Number(BigInt(sliceHex(data, 26, 32)));
  const now = Math.floor(Date.now() / 1000);
  // A provider's "stub" label is not evidence that its bytes cannot authorize spending.
  if (validUntil <= now + 10 || validUntil > expiresAt || validAfter > now)
    sponsorshipUnavailable();
  // Sponsor-controlled markup/icons and arbitrary provider fields never reach the wallet.
  return {
    paymasterAndData: data,
    ...(stub ? { isFinal: result.data.isFinal === true } : {}),
  };
}

export function sponsorshipConfigurationFromEnvironment() {
  if (
    process.env.BASE_SPONSORED_GAS_ENABLED !== "true" ||
    process.env.BASE_PAYMASTER_PROXY_ENABLED !== "true"
  )
    sponsorshipUnavailable();
  try {
    // Sepolia-only initial acceptance. Mainnet is a separate reviewed activation, not an env typo.
    if (
      process.env.BASE_CHAIN_ID !== "84532" ||
      process.env.BASE_PAYMASTER_POLICY_REVIEWED !== "true"
    )
      throw new Error();
    const addr = (name: string) => {
      const a = getAddress(process.env[name] || "").toLowerCase() as Address;
      if (BigInt(a) === 0n) throw new Error();
      return a;
    };
    const hash = (name: string) => {
      const h = process.env[name] || "";
      if (!/^0x[0-9a-f]{64}$/.test(h)) throw new Error();
      return h as Hex;
    };
    const integer = (name: string, max: bigint) => {
      const v = process.env[name] || "";
      if (!/^[1-9][0-9]*$/.test(v) || BigInt(v) > max) throw new Error();
      return BigInt(v);
    };
    const policy: SponsorshipPolicy = {
      chainId: 84532,
      escrow: addr("BASE_ESCROW_ADDRESS"),
      factory: {
        factory: addr("BASE_ACCOUNT_FACTORY_ADDRESS"),
        factoryCodeHash: hash("BASE_ACCOUNT_FACTORY_CODE_HASH"),
        implementationCodeHash: hash("BASE_ACCOUNT_IMPLEMENTATION_CODE_HASH"),
      },
      proxyCodeHash: hash("BASE_ACCOUNT_PROXY_CODE_HASH"),
      entryPointCodeHash: hash("BASE_ENTRYPOINT_CODE_HASH"),
      paymaster: addr("BASE_PAYMASTER_ADDRESS"),
      paymasterCodeHash: hash("BASE_PAYMASTER_CODE_HASH"),
      maxCallGas: integer("BASE_GAS_MAX_CALL", 1000000n),
      maxVerificationGas: integer("BASE_GAS_MAX_VERIFICATION", 2000000n),
      maxPreVerificationGas: integer("BASE_GAS_MAX_PRE_VERIFICATION", 1000000n),
      maxFeePerGas: integer("BASE_GAS_MAX_FEE_WEI", 10000000000n),
      maxOperationWei: integer("BASE_GAS_MAX_OPERATION_WEI", 1000000000000000n),
      totalBudgetWei: integer("BASE_GAS_TOTAL_BUDGET_WEI", 10000000000000000n),
      maxOperationsPerAccount: Number(
        integer("BASE_GAS_MAX_OPERATIONS_PER_ACCOUNT", 10n),
      ),
    };
    if (policy.maxOperationWei > policy.totalBudgetWei) throw new Error();
    const url = new URL(process.env.BASE_PAYMASTER_UPSTREAM_URL || "");
    if (
      url.protocol !== "https:" ||
      url.hostname !== "api.developer.coinbase.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/rpc\/v1\/base-sepolia\/[A-Za-z0-9_-]+$/.test(url.pathname)
    )
      throw new Error();
    return { policy, upstreamUrl: url.href };
  } catch {
    sponsorshipUnavailable();
  }
}
