import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, hashTypedData } from "viem";
import { baseClaimTypedData } from "./claim";
import {
  claimCall,
  sendSponsoredClaim,
  signWalletChallenge,
  type AccountProvider,
  type AuthorizedReward,
} from "./account";
import { learningRewardsAbi } from "./escrow-abi";

const recipient = "0x3333333333333333333333333333333333333333" as const;
const escrow = "0x4444444444444444444444444444444444444444" as const;
function fixture() {
  const claimDeadline = Math.floor(Date.now() / 1000) + 3600;
  const data = baseClaimTypedData(84532, escrow, {
    campaignId: 1n,
    slot: 0,
    participantId: `0x${"55".repeat(32)}`,
    recipient,
    amount: 100000n,
    deadline: BigInt(claimDeadline),
    signerEpoch: 1n,
  });
  const reward: AuthorizedReward = {
    status: "AUTHORIZED",
    digest: hashTypedData(data),
    signature: "0x1234",
    typedData: {
      domain: data.domain,
      message: {
        ...data.message,
        campaignId: "1",
        amount: "100000",
        deadline: String(claimDeadline),
        signerEpoch: "1",
      },
    },
  };
  const calls: Array<{ method: string; params?: readonly unknown[] | object }> =
    [];
  const controls = {
    network: "0x14a34",
    recipient: recipient as string,
    capable: true,
    changeOnSign: false,
  };
  const provider: AccountProvider = {
    on() {},
    removeListener() {},
    async request(args) {
      calls.push(args);
      if (args.method === "eth_accounts") return [controls.recipient];
      if (args.method === "eth_chainId") return controls.network;
      if (args.method === "wallet_getCapabilities")
        return {
          "0x14a34": { paymasterService: { supported: controls.capable } },
        };
      if (args.method === "wallet_sendCalls") return { id: "0xabc" };
      if (args.method === "personal_sign") {
        if (controls.changeOnSign) controls.recipient = escrow;
        return "0x1234";
      }
      throw new Error("Unexpected wallet request");
    },
  };
  const expected = {
    recipient,
    escrow,
    chainId: 84532,
    onChainId: "1",
    rewardAtomic: "100000",
    claimDeadline,
  };
  const config = {
    enabled: true,
    sponsoredGas: true,
    proxyUrl: "https://sponsorship.example.test/claim",
  };
  return { reward, expected, provider, controls, calls, config };
}
test("sponsored claim sends exactly one committed zero-value escrow call with mandatory paymaster", async () => {
  const f = fixture();
  assert.equal(
    await sendSponsoredClaim(f.provider, f.reward, f.expected, f.config),
    "0xabc",
  );
  const request = f.calls.find((c) => c.method === "wallet_sendCalls")!;
  const payload = (
    request.params as Array<{
      calls: Array<{ data: `0x${string}`; value: string; to: string }>;
      capabilities: unknown;
    }>
  )[0];
  assert.equal(payload.calls.length, 1);
  assert.equal(payload.calls[0].to, escrow);
  assert.equal(payload.calls[0].value, "0x0");
  assert.equal(
    decodeFunctionData({ abi: learningRewardsAbi, data: payload.calls[0].data })
      .functionName,
    "claim",
  );
  assert.deepEqual(payload.capabilities, {
    paymasterService: { url: f.config.proxyUrl },
  });
});
test("wrong account, chain, gas support, commitment or raw provider endpoint cannot send a transaction", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.controls.recipient = escrow;
    },
    (f: ReturnType<typeof fixture>) => {
      f.controls.network = "0x2105";
    },
    (f: ReturnType<typeof fixture>) => {
      f.controls.capable = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.reward.typedData.message.amount = "200000";
    },
    (f: ReturnType<typeof fixture>) => {
      f.config.sponsoredGas = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.config.proxyUrl = "https://api.developer.coinbase.com/rpc/v1/base/KEY";
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(
      sendSponsoredClaim(f.provider, f.reward, f.expected, f.config),
    );
    assert.ok(!f.calls.some((c) => c.method === "wallet_sendCalls"));
  }
});
test("wallet verification detects account change during signing and does not expose the proof", async () => {
  const f = fixture();
  f.controls.changeOnSign = true;
  await assert.rejects(
    signWalletChallenge(
      f.provider,
      recipient,
      84532,
      "Synthetic test challenge",
    ),
    /changed/,
  );
  const changed = fixture();
  changed.reward.typedData.domain.name = "Other contract";
  assert.throws(() => claimCall(changed.reward, changed.expected));
});

test("preflight failure does not mark a submission uncertain; persistence failure prevents sending", async () => {
  const f = fixture(); let started = false; f.controls.capable = false;
  await assert.rejects(sendSponsoredClaim(f.provider, f.reward, f.expected, f.config, () => { started = true; }));
  assert.equal(started, false);
  f.controls.capable = true;
  await assert.rejects(sendSponsoredClaim(f.provider, f.reward, f.expected, f.config, () => { throw new Error("Storage unavailable"); }));
  assert.ok(!f.calls.some((call) => call.method === "wallet_sendCalls"));
});
