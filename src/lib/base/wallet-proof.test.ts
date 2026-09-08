import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeAbiParameters,
  decodeFunctionData,
  hashTypedData,
  pad,
  parseAbi,
  parseErc6492Signature,
  recoverAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  signSmartWalletMessage,
  smartWalletMessageTypedData,
} from "./wallet-proof";

const accountFactoryAbi = parseAbi([
  "function createAccount(bytes[] owners, uint256 nonce) returns (address)",
]);
const owner = privateKeyToAccount(`0x${"11".repeat(32)}`);
const smartAccount = "0x2222222222222222222222222222222222222222";
const factory = "0xba5ed110efdba3d005bfc882d75358acbbb85842";

test("smart wallet message proof is replay-safe and deployable through the pinned factory", async () => {
  const message = "Verify this reward wallet";
  const signature = await signSmartWalletMessage({
    message,
    chainId: 84532,
    smartAccount,
    owner: owner.address,
    factory,
    signTypedData: (typedData) =>
      owner.signTypedData({
        domain: typedData.domain,
        types: {
          CoinbaseSmartWalletMessage: [
            { name: "hash", type: "bytes32" },
          ],
        },
        primaryType: "CoinbaseSmartWalletMessage",
        message: typedData.message as { hash: Hex },
      }),
  });
  const wrapped = parseErc6492Signature(signature);
  assert.equal(wrapped.address?.toLowerCase(), factory);
  const creation = decodeFunctionData({
    abi: accountFactoryAbi,
    data: wrapped.data!,
  });
  assert.equal(creation.functionName, "createAccount");
  assert.deepEqual(
    creation.args,
    [[pad(owner.address).toLowerCase()], 0n],
  );

  const [smartSignature] = decodeAbiParameters(
    [
      {
        components: [
          { name: "ownerIndex", type: "uint8" },
          { name: "signatureData", type: "bytes" },
        ],
        type: "tuple",
      },
    ],
    wrapped.signature,
  );
  assert.equal(smartSignature.ownerIndex, 0);
  const ownerSignature = smartSignature.signatureData as Hex;
  const typedData = smartWalletMessageTypedData(
    message,
    84532,
    smartAccount,
  );
  assert.equal(
    await recoverAddress({
      hash: hashTypedData({
        domain: typedData.domain,
        types: {
          CoinbaseSmartWalletMessage: [
            { name: "hash", type: "bytes32" },
          ],
        },
        primaryType: "CoinbaseSmartWalletMessage",
        message: typedData.message as { hash: Hex },
      }),
      signature: ownerSignature,
    }),
    owner.address,
  );
});
