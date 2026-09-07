import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  hashMessage,
  pad,
  parseAbi,
  serializeErc6492Signature,
  sliceHex,
  type Address,
  type Hex,
} from "viem";
import type { EIP712TypedData } from "@coinbase/cdp-core";

const accountFactoryAbi = parseAbi([
  "function createAccount(bytes[] owners, uint256 nonce) returns (address)",
]);

const signatureWrapper = {
  components: [
    { name: "ownerIndex", type: "uint8" },
    { name: "signatureData", type: "bytes" },
  ],
  name: "SignatureWrapper",
  type: "tuple",
} as const;

export function smartWalletMessageTypedData(
  message: string,
  chainId: number,
  smartAccount: Address,
): EIP712TypedData {
  return {
    domain: {
      name: "Coinbase Smart Wallet",
      version: "1",
      chainId,
      verifyingContract: smartAccount,
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      CoinbaseSmartWalletMessage: [{ name: "hash", type: "bytes32" }],
    },
    primaryType: "CoinbaseSmartWalletMessage",
    message: { hash: hashMessage(message) },
  };
}

function smartAccountSignature(ownerSignature: Hex) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(ownerSignature)) {
    throw new Error("Coinbase returned an unsupported owner signature");
  }
  const r = sliceHex(ownerSignature, 0, 32);
  const s = sliceHex(ownerSignature, 32, 64);
  const v = Number(`0x${ownerSignature.slice(130, 132)}`);
  const signatureData = encodePacked(
    ["bytes32", "bytes32", "uint8"],
    [r, s, v],
  );
  return encodeAbiParameters(
    [signatureWrapper],
    [{ ownerIndex: 0, signatureData }],
  );
}

export async function signSmartWalletMessage({
  message,
  chainId,
  smartAccount,
  owner,
  factory,
  signTypedData,
}: {
  message: string;
  chainId: number;
  smartAccount: Address;
  owner: Address;
  factory: Address;
  signTypedData(typedData: ReturnType<typeof smartWalletMessageTypedData>): Promise<Hex>;
}) {
  const ownerSignature = await signTypedData(
    smartWalletMessageTypedData(message, chainId, smartAccount),
  );
  const creation = encodeFunctionData({
    abi: accountFactoryAbi,
    functionName: "createAccount",
    args: [[pad(getAddress(owner))], 0n],
  });
  return serializeErc6492Signature({
    address: getAddress(factory),
    data: creation,
    signature: smartAccountSignature(ownerSignature),
  });
}
