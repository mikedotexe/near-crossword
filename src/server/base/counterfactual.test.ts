import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, serializeErc6492Signature } from "viem";
import {
  accountFactoryAbi,
  counterfactualCreation,
  type CounterfactualPolicy,
} from "./counterfactual";

test("counterfactual preparation accepts only bounded canonical account creation at the pinned factory", () => {
  const policy: CounterfactualPolicy = {
    factory: `0x${"11".repeat(20)}`,
    factoryCodeHash: `0x${"22".repeat(32)}`,
    implementationCodeHash: `0x${"33".repeat(32)}`,
  };
  const owners = [`0x${"44".repeat(64)}` as const],
    nonce = 0n;
  const data = encodeFunctionData({
    abi: accountFactoryAbi,
    functionName: "createAccount",
    args: [owners, nonce],
  });
  const wrap = (address = policy.factory, call = data) =>
    serializeErc6492Signature({ address, data: call, signature: "0x1234" });
  assert.deepEqual(counterfactualCreation(wrap(), policy), { owners, nonce });
  assert.throws(() =>
    counterfactualCreation(wrap(`0x${"55".repeat(20)}`), policy),
  );
  assert.throws(() =>
    counterfactualCreation(wrap(policy.factory, `${data}0000`), policy),
  );
  assert.throws(() =>
    counterfactualCreation(
      wrap(
        policy.factory,
        encodeFunctionData({
          abi: accountFactoryAbi,
          functionName: "getAddress",
          args: [owners, nonce],
        }),
      ),
      policy,
    ),
  );
  assert.throws(() => counterfactualCreation("0x1234", policy));
});
