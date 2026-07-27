import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Campaign, FundingQuote, JsonValue } from "../types";
import {
  augmentExternalFundingQuoteInstructions,
  buildExternalFundingAuthorizationInstruction,
  DEFAULT_EXTERNAL_AUTHORIZATION_STORAGE_DEPOSIT_YOCTO,
  EXTERNAL_AUTHORIZATION_FUNCTION_CALL_GAS,
  EXTERNAL_AUTHORIZATION_STORAGE_NOTICE,
  EXTERNAL_FUNDING_AUTHORIZATION_INSTRUCTION_KEY,
} from "./external-authorization";

const CONTENT_HASH = "ab".repeat(32);
const SOLUTION_PUBLIC_KEY = Buffer.alloc(32, 7).toString("base64");

function campaign(): Campaign {
  return {
    id: "campaign-123",
    slug: "campaign-123",
    creatorId: "creator-user",
    creatorAccountId: "creator.testnet",
    title: "A funded puzzle",
    description: null,
    sponsorName: "Creator",
    sponsorUrl: null,
    visibility: "PUBLIC",
    status: "DRAFT",
    puzzle: {
      width: 2,
      height: 2,
      clues: [
        {
          number: 1,
          clue: "Test",
          row: 0,
          column: 0,
          direction: "across",
          length: 2,
        },
      ],
    },
    contentHash: CONTENT_HASH,
    solutionPublicKey: SOLUTION_PUBLIC_KEY,
    reward: {
      type: "TOKEN_PRIZE",
      assetId: "nep141:usdc.testnet",
      amountAtomic: "25000000",
      decimals: 6,
      symbol: "USDC",
    },
    contractId: "campaigns-v2.testnet",
    openingAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-08T00:00:00.000Z",
    refundAccount: "creator.testnet",
    fundingReference: null,
    chainCampaignId: null,
    aiGenerationReceipt: null,
    version: 1,
    createdAt: "2029-12-01T00:00:00.000Z",
    updatedAt: "2029-12-01T00:00:00.000Z",
  };
}

function quote(): FundingQuote {
  return {
    rail: "ONE_CLICK",
    origin: {
      assetId: "nep141:origin-token.testnet",
      amountAtomic: "25100000",
    },
    principal: {
      assetId: "nep141:usdc.testnet",
      amountAtomic: "25000000",
    },
    estimatedDelivery: {
      assetId: "nep141:usdc.testnet",
      amountAtomic: "25000000",
    },
    routingFee: {
      assetId: "nep141:origin-token.testnet",
      amountAtomic: "100000",
    },
    platformFee: {
      assetId: "nep141:origin-token.testnet",
      amountAtomic: "0",
    },
    depositAddress: "0xprovider-deposit",
    depositMemo: null,
    deadline: "2029-12-01T00:10:00.000Z",
    providerQuoteId: "one-click-quote-123",
    providerStatus: "PENDING_DEPOSIT",
    rawDigest: "cd".repeat(32),
    instructions: {
      provider: "1click",
      depositAddress: "0xprovider-deposit",
    },
  };
}

function instructionFrom(value: JsonValue): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  const authorization = value[
    EXTERNAL_FUNDING_AUTHORIZATION_INSTRUCTION_KEY
  ];
  assert.ok(
    authorization &&
      typeof authorization === "object" &&
      !Array.isArray(authorization),
  );
  return authorization as Record<string, unknown>;
}

describe("external funding creator authorization", () => {
  it("augments an Intents quote with the exact creator-owned contract call", () => {
    const sourceCampaign = campaign();
    const sourceQuote = quote();
    const sourceInstructions = sourceQuote.instructions;
    const augmented = augmentExternalFundingQuoteInstructions(
      sourceCampaign,
      sourceQuote,
    );
    const authorization = buildExternalFundingAuthorizationInstruction(
      sourceCampaign,
      sourceQuote,
    );

    assert.notEqual(augmented, sourceQuote);
    assert.equal(sourceQuote.instructions, sourceInstructions);
    assert.deepEqual(
      instructionFrom(augmented.instructions),
      authorization as unknown as Record<string, unknown>,
    );
    assert.equal(
      (augmented.instructions as Record<string, JsonValue>).provider,
      "1click",
    );
    assert.deepEqual(authorization, {
      version: "crossword-external-funding-authorization:v1",
      authorizedCreatorAccountId: "creator.testnet",
      fundingReference: "one-click-quote-123",
      storageDepositNotice: EXTERNAL_AUTHORIZATION_STORAGE_NOTICE,
      walletCall: {
        signerId: "creator.testnet",
        receiverId: "campaigns-v2.testnet",
        actions: [
          {
            type: "FunctionCall",
            methodName: "authorize_external_funding",
            args: {
              args: {
                campaign: {
                  campaign_id: "campaign-123",
                  creator_id: "creator.testnet",
                  controller_id: "creator.testnet",
                  content_hash: Buffer.from(CONTENT_HASH, "hex").toString(
                    "base64",
                  ),
                  solution_public_key: SOLUTION_PUBLIC_KEY,
                  opens_at_ms: Date.parse("2030-01-01T00:00:00.000Z"),
                  expires_at_ms: Date.parse("2030-01-08T00:00:00.000Z"),
                  refund_account_id: "creator.testnet",
                },
                amount: "25000000",
                funding_reference: "one-click-quote-123",
                funding_rail: "intents",
                sponsor_id: "creator.testnet",
                funding_deadline_ms: Date.parse(
                  "2029-12-01T00:25:00.000Z",
                ),
              },
            },
            gas: EXTERNAL_AUTHORIZATION_FUNCTION_CALL_GAS,
            deposit:
              DEFAULT_EXTERNAL_AUTHORIZATION_STORAGE_DEPOSIT_YOCTO,
          },
        ],
      },
    });
    assert.match(
      authorization.storageDepositNotice,
      /returns the released storage deposit/i,
    );
  });

  it("uses the deposit address only when the provider has no quote id", () => {
    const providerQuote = quote();
    providerQuote.providerQuoteId = null;

    const authorization = buildExternalFundingAuthorizationInstruction(
      campaign(),
      providerQuote,
    );

    assert.equal(authorization.fundingReference, "0xprovider-deposit");
    assert.equal(
      authorization.walletCall.actions[0].args.args.funding_reference,
      "0xprovider-deposit",
    );
  });

  it("accepts an explicitly larger bounded storage allowance", () => {
    const authorization = buildExternalFundingAuthorizationInstruction(
      campaign(),
      quote(),
      { attachedStorageDepositYocto: "80000000000000000000000" },
    );

    assert.equal(
      authorization.walletCall.actions[0].deposit,
      "80000000000000000000000",
    );
    assert.throws(
      () =>
        buildExternalFundingAuthorizationInstruction(campaign(), quote(), {
          attachedStorageDepositYocto: "1000000000000000000000",
        }),
      /0\.05 NEAR safety allowance/,
    );
    assert.throws(
      () =>
        buildExternalFundingAuthorizationInstruction(campaign(), quote(), {
          attachedStorageDepositYocto: "1000000000000000000000001",
        }),
      /between the 0\.05 NEAR safety allowance and 1 NEAR/,
    );

    const noGrace = buildExternalFundingAuthorizationInstruction(
      campaign(),
      quote(),
      { allocationGraceMs: 0 },
    );
    assert.equal(
      noGrace.walletCall.actions[0].args.args.funding_deadline_ms,
      Date.parse("2029-12-01T00:10:00.000Z"),
    );
    assert.throws(
      () =>
        buildExternalFundingAuthorizationInstruction(campaign(), quote(), {
          allocationGraceMs: 60 * 60 * 1_000 + 1,
        }),
      /between zero and one hour/,
    );
  });

  it("requires every immutable contract field and matching recovery ownership", () => {
    const cases: Array<[string, (value: Campaign) => void, RegExp]> = [
      [
        "creator account",
        (value) => {
          value.creatorAccountId = null;
        },
        /creatorAccountId is required/,
      ],
      [
        "refund account",
        (value) => {
          value.refundAccount = null;
        },
        /refundAccount is required/,
      ],
      [
        "contract",
        (value) => {
          value.contractId = null;
        },
        /contractId is required/,
      ],
      [
        "content hash",
        (value) => {
          value.contentHash = null;
        },
        /contentHash must be a 32-byte/,
      ],
      [
        "solution public key",
        (value) => {
          value.solutionPublicKey = null;
        },
        /solutionPublicKey is required/,
      ],
      [
        "opening",
        (value) => {
          value.openingAt = null;
        },
        /openingAt is required/,
      ],
      [
        "expiry",
        (value) => {
          value.expiresAt = null;
        },
        /expiresAt is required/,
      ],
    ];

    for (const [label, mutate, expected] of cases) {
      const value = campaign();
      mutate(value);
      assert.throws(
        () => buildExternalFundingAuthorizationInstruction(value, quote()),
        expected,
        label,
      );
    }

    const mismatched = campaign();
    mismatched.refundAccount = "someone-else.testnet";
    assert.throws(
      () =>
        buildExternalFundingAuthorizationInstruction(mismatched, quote()),
      /creatorAccountId must equal campaign\.refundAccount/,
    );
  });

  it("fails closed for non-external rails, mismatched principal, and absent references", () => {
    const direct = quote();
    direct.rail = "DIRECT_NEAR";
    assert.throws(
      () => buildExternalFundingAuthorizationInstruction(campaign(), direct),
      /only valid for an external 1Click quote/,
    );

    const mismatched = quote();
    mismatched.principal.amountAtomic = "24000000";
    assert.throws(
      () =>
        buildExternalFundingAuthorizationInstruction(campaign(), mismatched),
      /principal does not match/,
    );

    const missingReference = quote();
    missingReference.providerQuoteId = null;
    missingReference.depositAddress = "";
    assert.throws(
      () =>
        buildExternalFundingAuthorizationInstruction(
          campaign(),
          missingReference,
        ),
      /depositAddress is required/,
    );

    const deadlineAfterCampaign = quote();
    deadlineAfterCampaign.deadline = "2030-01-09T00:00:00.000Z";
    assert.throws(
      () =>
        buildExternalFundingAuthorizationInstruction(
          campaign(),
          deadlineAfterCampaign,
        ),
      /deadline cannot exceed campaign expiry/,
    );
  });
});
