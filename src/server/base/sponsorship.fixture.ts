import {
  encodeFunctionData,
  encodePacked,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import {
  entryPointV06,
  smartAccountAbi,
  type SponsorshipPolicy,
  type SponsorshipRequest,
} from "./sponsorship-policy";
import { testCode } from "./chain.fixture";

// Synthetic local policy and dummy provider data. No key or address here may be funded.
export function gasPolicy(
  escrow: Address = "0x4444444444444444444444444444444444444444",
): SponsorshipPolicy {
  return {
    chainId: 84532,
    escrow,
    factory: {
      factory: "0x1111111111111111111111111111111111111111",
      factoryCodeHash: keccak256(testCode),
      implementationCodeHash: keccak256(testCode),
    },
    proxyCodeHash: keccak256(testCode),
    entryPointCodeHash: keccak256(testCode),
    paymaster: "0x2222222222222222222222222222222222222222",
    paymasterCodeHash: keccak256(testCode),
    maxCallGas: 500000n,
    maxVerificationGas: 1000000n,
    maxPreVerificationGas: 200000n,
    maxFeePerGas: 1000000000n,
    maxOperationWei: 100000000000000n,
    totalBudgetWei: 200000000000000n,
    maxOperationsPerAccount: 2,
  };
}
export function gasRequest(
  policy: SponsorshipPolicy,
  recipient: Address,
  callData: Hex,
  token = "ab".repeat(32),
): SponsorshipRequest {
  return {
    jsonrpc: "2.0",
    id: 7,
    method: "pm_getPaymasterStubData",
    params: [
      {
        sender: recipient.toLowerCase() as Address,
        nonce: "0x0",
        initCode: "0x",
        callData: encodeFunctionData({
          abi: smartAccountAbi,
          functionName: "execute",
          args: [policy.escrow, 0n, callData],
        }).toLowerCase() as Hex,
        callGasLimit: "0x186a0",
        verificationGasLimit: "0x186a0",
        preVerificationGas: "0x5208",
        maxFeePerGas: "0x989680",
        maxPriorityFeePerGas: "0x1",
      },
      entryPointV06,
      `0x${policy.chainId.toString(16)}`,
      { token },
    ],
  };
}
export function gasResult(
  policy: SponsorshipPolicy,
  validUntil = Math.floor(Date.now() / 1000) + 300,
  token: Address = `0x${"00".repeat(20)}`,
) {
  return {
    paymasterAndData: encodePacked(
      [
        "address",
        "uint48",
        "uint48",
        "uint128",
        "bool",
        "bool",
        "bool",
        "address",
        "address",
        "uint256",
        "uint48",
        "bytes",
      ],
      [
        policy.paymaster,
        validUntil,
        0,
        0n,
        true,
        true,
        false,
        token,
        `0x${"00".repeat(20)}`,
        0n,
        0,
        `0x${"11".repeat(65)}`,
      ],
    ).toLowerCase() as Hex,
  };
}
