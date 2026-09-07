import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  parseAbi,
  parseErc6492Signature,
  type Address,
  type Hex,
} from "viem";
import { AppError } from "../v2/errors";

export const accountFactoryAbi = parseAbi([
  "function createAccount(bytes[] owners, uint256 nonce) returns (address)",
  "function getAddress(bytes[] owners, uint256 nonce) view returns (address)",
  "function implementation() view returns (address)",
]);
export type CounterfactualPolicy = {
  factory: Address;
  factoryCodeHash: Hex;
  implementationCodeHash: Hex;
};

export function counterfactualPolicyFromEnvironment():
  | CounterfactualPolicy
  | undefined {
  if (process.env.BASE_COUNTERFACTUAL_ENABLED !== "true") return undefined;
  try {
    const factory = getAddress(process.env.BASE_ACCOUNT_FACTORY_ADDRESS || "");
    const factoryCodeHash = process.env.BASE_ACCOUNT_FACTORY_CODE_HASH;
    const implementationCodeHash =
      process.env.BASE_ACCOUNT_IMPLEMENTATION_CODE_HASH;
    if (
      BigInt(factory) === 0n ||
      !/^0x[0-9a-f]{64}$/.test(factoryCodeHash || "") ||
      !/^0x[0-9a-f]{64}$/.test(implementationCodeHash || "")
    )
      throw new Error();
    return {
      factory,
      factoryCodeHash: factoryCodeHash as Hex,
      implementationCodeHash: implementationCodeHash as Hex,
    };
  } catch {
    throw new AppError(
      503,
      "BASE_WALLET_UNAVAILABLE",
      "Reviewed account factory and implementation pins are required",
    );
  }
}

export function counterfactualCreation(
  signature: Hex,
  policy: CounterfactualPolicy,
) {
  const wrapper = parseErc6492Signature(signature);
  if (
    !wrapper.address ||
    !wrapper.data ||
    wrapper.address.toLowerCase() !== policy.factory.toLowerCase()
  )
    throw new Error("Factory not approved");
  const creation = decodeFunctionData({
    abi: accountFactoryAbi,
    data: wrapper.data,
  });
  if (creation.functionName !== "createAccount")
    throw new Error("Factory call not approved");
  const [owners, nonce] = creation.args;
  if (
    !owners.length ||
    owners.length > 4 ||
    owners.some((owner) => owner.length !== 66 && owner.length !== 130) ||
    encodeFunctionData({
      abi: accountFactoryAbi,
      functionName: "createAccount",
      args: [owners, nonce],
    }).toLowerCase() !== wrapper.data.toLowerCase()
  ) {
    throw new Error("Invalid account creation");
  }
  return { owners, nonce };
}
