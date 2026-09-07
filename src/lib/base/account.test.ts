import assert from "node:assert/strict";
import { test } from "node:test";
import type { SendUserOperationOptions } from "@coinbase/cdp-core";
import { decodeFunctionData, hashTypedData } from "viem";
import { baseClaimTypedData } from "./claim";
import {
  claimCall,
  sendSponsoredClaim,
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
  const requests: SendUserOperationOptions[] = [];
  const send = async (options: SendUserOperationOptions) => {
    requests.push(options);
    return { userOperationHash: `0x${"ab".repeat(32)}` as const };
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
  const permit = {
    token: "ab".repeat(32),
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    digest: reward.digest,
  };
  return { reward, expected, requests, send, config, permit };
}

test("CDP sponsored claim sends one committed zero-value escrow call through the reviewed proxy", async () => {
  const f = fixture();
  assert.equal(
    await sendSponsoredClaim(f.send, f.reward, f.expected, f.config, f.permit),
    `0x${"ab".repeat(32)}`,
  );
  assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  assert.equal(request.evmSmartAccount, recipient);
  assert.equal(request.network, "base-sepolia");
  assert.equal(request.calls.length, 1);
  assert.equal(request.calls[0].to, escrow);
  assert.equal(request.calls[0].value, 0n);
  assert.equal(
    decodeFunctionData({
      abi: learningRewardsAbi,
      data: request.calls[0].data!,
    }).functionName,
    "claim",
  );
  assert.equal(request.paymasterUrl, f.config.proxyUrl);
  assert.deepEqual(request.paymasterContext, { token: f.permit.token });
  assert.equal(request.useCdpPaymaster, undefined);
});

test("wrong network, commitment, gate or raw provider endpoint cannot send", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.expected.chainId = 1;
    },
    (f: ReturnType<typeof fixture>) => {
      f.reward.typedData.message.amount = "200000";
    },
    (f: ReturnType<typeof fixture>) => {
      f.config.sponsoredGas = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.config.proxyUrl =
        "https://api.developer.coinbase.com/rpc/v1/base/KEY";
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(
      sendSponsoredClaim(f.send, f.reward, f.expected, f.config, f.permit),
    );
    assert.equal(f.requests.length, 0);
  }
  const changed = fixture();
  changed.reward.typedData.domain.name = "Other contract";
  assert.throws(() => claimCall(changed.reward, changed.expected));
});

test("preflight failure does not mark a submission uncertain; persistence failure prevents sending", async () => {
  const invalid = fixture();
  let started = false;
  invalid.reward.typedData.message.amount = "200000";
  await assert.rejects(
    sendSponsoredClaim(
      invalid.send,
      invalid.reward,
      invalid.expected,
      invalid.config,
      invalid.permit,
      () => {
        started = true;
      },
    ),
  );
  assert.equal(started, false);

  const storage = fixture();
  await assert.rejects(
    sendSponsoredClaim(
      storage.send,
      storage.reward,
      storage.expected,
      storage.config,
      storage.permit,
      () => {
        throw new Error("Storage unavailable");
      },
    ),
  );
  assert.equal(storage.requests.length, 0);
});

test("an expired, absent or different-claim sponsorship permit cannot reach CDP", async () => {
  for (const change of ["expired", "wrong", "missing"] as const) {
    const f = fixture();
    if (change === "expired") f.permit.expiresAt = 0;
    if (change === "wrong") f.permit.digest = `0x${"00".repeat(32)}`;
    if (change === "missing") f.permit.token = "";
    await assert.rejects(
      sendSponsoredClaim(f.send, f.reward, f.expected, f.config, f.permit),
    );
    assert.equal(f.requests.length, 0);
  }
});

test("an uncertain CDP result remains recoverable instead of being treated as submitted", async () => {
  const f = fixture();
  await assert.rejects(
    sendSponsoredClaim(
      async (options) => {
        f.requests.push(options);
        return { userOperationHash: "0x1" };
      },
      f.reward,
      f.expected,
      f.config,
      f.permit,
    ),
    /uncertain/,
  );
  assert.equal(f.requests.length, 1);
});
