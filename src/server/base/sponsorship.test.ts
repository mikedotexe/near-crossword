import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeFunctionData,
  encodeFunctionResult,
  parseAbi,
  type Hex,
} from "viem";
import { cdpPaymasterUpstream } from "./sponsorship";
import { gasPolicy, gasRequest, gasResult } from "./sponsorship.fixture";
import {
  entryPointV06,
  parseSponsorshipRequest,
  smartAccountAbi,
  sponsorshipConfigurationFromEnvironment,
  validateClaimOperation,
  validatePaymasterResult,
} from "./sponsorship-policy";
import { accountFactoryAbi } from "./counterfactual";
import { RpcBaseChainReader } from "./chain-reader";
import { chainFixture, testCode } from "./chain.fixture";

const recipient = "0x3333333333333333333333333333333333333333";
const expected = { recipient, callData: "0x1234" } as const;
test("strict ERC-7677 parser rejects batches, notifications, unknown methods/fields, noncanonical quantities and missing context", () => {
  const request = gasRequest(gasPolicy(), recipient, expected.callData);
  assert.deepEqual(parseSponsorshipRequest(request), request);
  for (const raw of [
    [request],
    { ...request, id: undefined },
    { ...request, method: "eth_sendRawTransaction" },
    { ...request, extra: true },
    { ...request, params: [...request.params.slice(0, 3), {}] },
    {
      ...request,
      params: [
        { ...request.params[0], nonce: "0x00" },
        ...request.params.slice(1),
      ],
    },
    {
      ...request,
      params: [
        { ...request.params[0], factory: recipient },
        ...request.params.slice(1),
      ],
    },
  ]) {
    assert.throws(() => parseSponsorshipRequest(raw), {
      code: "SPONSORSHIP_DENIED",
    });
  }
});
test("policy accepts a single canonical execute or executeBatch and binds nonce/initCode/call while allowing bounded estimates", () => {
  const policy = gasPolicy(),
    req = gasRequest(policy, recipient, expected.callData);
  const first = validateClaimOperation(req, expected, policy);
  req.params[0].callGasLimit = "0x186a1";
  const adjusted = validateClaimOperation(req, expected, policy);
  assert.equal(first.identity, adjusted.identity);
  assert.notEqual(first.requestHash, adjusted.requestHash);
  req.params[0].callData = encodeFunctionData({
    abi: smartAccountAbi,
    functionName: "executeBatch",
    args: [[{ target: policy.escrow, value: 0n, data: expected.callData }]],
  });
  validateClaimOperation(req, expected, policy);
  req.params[0].initCode = `${policy.factory.factory}${encodeFunctionData({ abi: accountFactoryAbi, functionName: "createAccount", args: [[`0x${"11".repeat(64)}`], 0n] }).slice(2)}`;
  validateClaimOperation(req, expected, policy);
});
test("policy denies changed recipient/network/entrypoint, extra calls, approvals, value, suffixes, factory and excessive gas", () => {
  const p = gasPolicy();
  for (const mutate of [
    (r: ReturnType<typeof gasRequest>) => {
      r.params[0].sender = p.escrow;
    },
    (r: ReturnType<typeof gasRequest>) => {
      r.params[2] = "0x2105";
    },
    (r: ReturnType<typeof gasRequest>) => {
      r.params[1] = p.escrow;
    },
    (r: ReturnType<typeof gasRequest>) => {
      r.params[0].nonce = "0x10000000000000000";
    },
    (r: ReturnType<typeof gasRequest>) => {
      r.params[0].callData += "00";
    },
    (r: ReturnType<typeof gasRequest>) => {
      r.params[0].initCode = "0x1234";
    },
    (r: ReturnType<typeof gasRequest>) => {
      r.params[0].maxFeePerGas = "0xffffffffff";
    },
    (r: ReturnType<typeof gasRequest>) => {
      r.params[0].verificationGasLimit = "0xffffffffff";
    },
    (r: ReturnType<typeof gasRequest>) => {
      r.params[0].maxPriorityFeePerGas = "0xffffffff";
    },
    (r: ReturnType<typeof gasRequest>) => {
      r.method = "pm_getPaymasterData";
      r.params[0].callGasLimit = "0x0";
    },
    ...([p.escrow, recipient] as const).flatMap((target) =>
      [0n, 1n].map((value) => (r: ReturnType<typeof gasRequest>) => {
        r.params[0].callData = encodeFunctionData({
          abi: smartAccountAbi,
          functionName: "execute",
          args: [target, value, "0x095ea7b3"],
        });
      }),
    ),
    (r: ReturnType<typeof gasRequest>) => {
      r.params[0].callData = encodeFunctionData({
        abi: smartAccountAbi,
        functionName: "executeBatch",
        args: [
          [
            { target: p.escrow, value: 0n, data: expected.callData },
            { target: p.escrow, value: 0n, data: expected.callData },
          ],
        ],
      });
    },
  ]) {
    const req = gasRequest(p, recipient, expected.callData);
    mutate(req);
    assert.throws(() => validateClaimOperation(req, expected, p), {
      code: "SPONSORSHIP_DENIED",
    });
  }
  const budget = gasRequest(p, recipient, expected.callData);
  p.maxOperationWei = 1n;
  assert.throws(() => validateClaimOperation(budget, expected, p), {
    code: "SPONSORSHIP_DENIED",
  });
});
test("upstream response must be pinned v0.6 sponsorship, never token charging or unbounded final authorization", () => {
  const p = gasPolicy(),
    expires = Math.floor(Date.now() / 1000) + 600;
  assert.deepEqual(
    validatePaymasterResult(gasResult(p), p, expires, false),
    gasResult(p),
  );
  for (const raw of [
    gasResult(p, 0),
    gasResult(p, expires + 1),
    gasResult(p, expires - 1, recipient),
    gasResult({ ...p, paymaster: recipient }),
    { ...gasResult(p), paymaster: p.paymaster },
    { paymasterAndData: "0x1234" },
  ]) {
    assert.throws(() => validatePaymasterResult(raw, p, expires, false), {
      code: "SPONSORSHIP_UNAVAILABLE",
    });
  }
  assert.throws(() =>
    validatePaymasterResult(
      { ...gasResult(p, 0), isFinal: false },
      p,
      expires,
      true,
    ),
  );
  assert.throws(() =>
    validatePaymasterResult(
      { ...gasResult(p, 0), isFinal: true },
      p,
      expires,
      true,
    ),
  );
});
test("provider transport removes private context, refuses redirects, bounds output and sanitizes failures", async () => {
  const p = gasPolicy(),
    request = gasRequest(p, recipient, expected.callData);
  const upstream = cdpPaymasterUpstream(
    "https://provider.example.test/SECRET",
    async (_url, init) => {
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.params[3], {});
      assert.equal(body.id, 1);
      assert.doesNotMatch(String(init?.body), /abababab/);
      return Response.json({ jsonrpc: "2.0", id: 1, result: gasResult(p) });
    },
  );
  assert.deepEqual(
    await upstream(request, new AbortController().signal),
    gasResult(p),
  );
  for (const response of [
    new Response("SECRET", { status: 500 }),
    Response.json({ jsonrpc: "2.0", id: 1, error: { data: "SECRET" } }),
    new Response("x".repeat(40000)),
    Response.json({ jsonrpc: "2.0", id: 9, result: gasResult(p) }),
  ]) {
    await assert.rejects(
      cdpPaymasterUpstream(
        "https://provider.example.test/SECRET",
        async () => response,
      )(request, new AbortController().signal),
      {
        code: "SPONSORSHIP_UNAVAILABLE",
        message: "Gas sponsorship is unavailable; no automatic retry was sent",
      },
    );
  }
});
test("environment sponsorship remains fail closed and cannot be enabled for mainnet", () => {
  const keys = [
    "BASE_PAYMASTER_PROXY_ENABLED",
    "BASE_SPONSORED_GAS_ENABLED",
    "BASE_PAYMASTER_POLICY_REVIEWED",
    "BASE_CHAIN_ID",
  ];
  const prior = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const key of keys) process.env[key] = "true";
    process.env.BASE_CHAIN_ID = "8453";
    assert.throws(sponsorshipConfigurationFromEnvironment, {
      code: "SPONSORSHIP_UNAVAILABLE",
    });
    process.env.BASE_CHAIN_ID = "84532";
    assert.throws(sponsorshipConfigurationFromEnvironment, {
      code: "SPONSORSHIP_UNAVAILABLE",
    });
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("account RPC verification pins factory/proxy/implementation/paymaster/entrypoint, checks current nonce and never broadcasts", async () => {
  const f = chainFixture(),
    p = { ...gasPolicy(f.deployment.escrow), chainId: 31337 };
  const implementation = "0x7777777777777777777777777777777777777777";
  const req = gasRequest(p, recipient, expected.callData);
  const control = {
    deployed: true,
    badCode: "",
    wrongImpl: false,
    wrongPrediction: false,
    wrongNonce: false,
    wrongEntry: false,
    claimReverts: false,
  };
  const methods: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const rpc = JSON.parse(String(init?.body));
    methods.push(rpc.method);
    const [first, second] = rpc.params || [];
    if (!["eth_getCode", "eth_call"].includes(rpc.method))
      return f.fetcher(url, init);
    assert.equal(second.requireCanonical, true);
    assert.ok(second.blockHash);
    let result: Hex;
    if (rpc.method === "eth_getCode")
      result =
        first === control.badCode
          ? "0x6001"
          : first === recipient && !control.deployed
            ? "0x"
            : testCode;
    else if (first.to.toLowerCase() === p.escrow) {
      assert.equal(first.from.toLowerCase(), recipient);
      assert.equal(BigInt(first.gas), p.maxCallGas);
      if (control.claimReverts)
        return Response.json({
          jsonrpc: "2.0",
          id: rpc.id,
          error: { code: 3, message: "execution reverted" },
        });
      result = "0x";
    } else if (first.to.toLowerCase() === entryPointV06)
      result = encodeFunctionResult({
        abi: parseAbi([
          "function getNonce(address,uint192) view returns (uint256)",
        ]),
        functionName: "getNonce",
        result: control.wrongNonce ? 1n : 0n,
      });
    else {
      const selector = first.data.slice(0, 10);
      if (
        selector ===
        encodeFunctionData({
          abi: smartAccountAbi,
          functionName: "entryPoint",
        }).slice(0, 10)
      )
        result = encodeFunctionResult({
          abi: smartAccountAbi,
          functionName: "entryPoint",
          result: control.wrongEntry ? recipient : entryPointV06,
        });
      else if (
        selector ===
        encodeFunctionData({
          abi: smartAccountAbi,
          functionName: "implementation",
        }).slice(0, 10)
      )
        result = encodeFunctionResult({
          abi: smartAccountAbi,
          functionName: "implementation",
          result:
            control.wrongImpl && first.to.toLowerCase() === recipient
              ? recipient
              : implementation,
        });
      else
        result = encodeFunctionResult({
          abi: accountFactoryAbi,
          functionName: "getAddress",
          result: control.wrongPrediction ? implementation : recipient,
        });
    }
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
  };
  const reader = new RpcBaseChainReader(f.deployment, {
    fetch: fetcher,
    allowLocalChain: true,
  });
  const verify = () =>
    reader.verifySponsorshipAccount(
      req.params[0],
      p,
      f.blocks.get(10n)!.hash,
      new AbortController().signal,
    );
  await verify();
  for (const bad of [
    entryPointV06,
    p.paymaster,
    p.factory.factory,
    implementation,
    recipient,
  ]) {
    control.badCode = bad;
    await assert.rejects(verify());
    control.badCode = "";
  }
  for (const key of [
    "wrongImpl",
    "wrongNonce",
    "wrongEntry",
    "claimReverts",
  ] as const) {
    control[key] = true;
    await assert.rejects(verify());
    control[key] = false;
  }
  control.deployed = false;
  await assert.rejects(verify());
  req.params[0].initCode = `${p.factory.factory}${encodeFunctionData({ abi: accountFactoryAbi, functionName: "createAccount", args: [[`0x${"11".repeat(64)}`], 0n] }).slice(2)}`;
  await verify();
  control.wrongPrediction = true;
  await assert.rejects(verify());
  assert.ok(
    methods.every((m) =>
      [
        "eth_chainId",
        "eth_getBlockByNumber",
        "eth_getCode",
        "eth_call",
      ].includes(m),
    ),
  );
});

test("complete reviewed Sepolia configuration accepts only the fixed private upstream and explicit bounded budgets", () => {
  const p = gasPolicy();
  const env = {
    BASE_PAYMASTER_PROXY_ENABLED: "true",
    BASE_SPONSORED_GAS_ENABLED: "true",
    BASE_PAYMASTER_POLICY_REVIEWED: "true",
    BASE_CHAIN_ID: "84532",
    BASE_ESCROW_ADDRESS: p.escrow,
    BASE_ACCOUNT_FACTORY_ADDRESS: p.factory.factory,
    BASE_ACCOUNT_FACTORY_CODE_HASH: p.factory.factoryCodeHash,
    BASE_ACCOUNT_IMPLEMENTATION_CODE_HASH: p.factory.implementationCodeHash,
    BASE_ACCOUNT_PROXY_CODE_HASH: p.proxyCodeHash,
    BASE_ENTRYPOINT_CODE_HASH: p.entryPointCodeHash,
    BASE_PAYMASTER_ADDRESS: p.paymaster,
    BASE_PAYMASTER_CODE_HASH: p.paymasterCodeHash,
    BASE_GAS_MAX_CALL: String(p.maxCallGas),
    BASE_GAS_MAX_VERIFICATION: String(p.maxVerificationGas),
    BASE_GAS_MAX_PRE_VERIFICATION: String(p.maxPreVerificationGas),
    BASE_GAS_MAX_FEE_WEI: String(p.maxFeePerGas),
    BASE_GAS_MAX_OPERATION_WEI: String(p.maxOperationWei),
    BASE_GAS_TOTAL_BUDGET_WEI: String(p.totalBudgetWei),
    BASE_GAS_MAX_OPERATIONS_PER_ACCOUNT: String(p.maxOperationsPerAccount),
    BASE_PAYMASTER_UPSTREAM_URL:
      "https://api.developer.coinbase.com/rpc/v1/base-sepolia/SYNTHETIC_NOT_A_KEY",
  };
  const prior = Object.fromEntries(
    Object.keys(env).map((k) => [k, process.env[k]]),
  );
  try {
    Object.assign(process.env, env);
    assert.deepEqual(sponsorshipConfigurationFromEnvironment().policy, p);
    for (const [key, value] of [
      [
        "BASE_PAYMASTER_UPSTREAM_URL",
        "https://api.developer.coinbase.com/rpc/v1/base/KEY",
      ],
      [
        "BASE_PAYMASTER_UPSTREAM_URL",
        "https://attacker.example.test/rpc/v1/base-sepolia/KEY",
      ],
      [
        "BASE_PAYMASTER_UPSTREAM_URL",
        `${env.BASE_PAYMASTER_UPSTREAM_URL}?key=anything`,
      ],
      ["BASE_PAYMASTER_UPSTREAM_URL", "http://127.0.0.1/"],
      ["BASE_PAYMASTER_POLICY_REVIEWED", "false"],
      ["BASE_GAS_MAX_OPERATION_WEI", "0"],
      ["BASE_GAS_MAX_OPERATION_WEI", "1000000000000001"],
      ["BASE_GAS_TOTAL_BUDGET_WEI", "1"],
      ["BASE_GAS_MAX_OPERATIONS_PER_ACCOUNT", "11"],
    ]) {
      process.env[key] = value;
      assert.throws(sponsorshipConfigurationFromEnvironment, {
        code: "SPONSORSHIP_UNAVAILABLE",
      });
      Object.assign(process.env, env);
    }
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
