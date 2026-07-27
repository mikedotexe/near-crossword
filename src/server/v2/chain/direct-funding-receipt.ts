import { providers } from "near-api-js";
import { AppError } from "../errors";
import { enqueueFundingReconciliation } from "./jobs";
import { getV2Campaign } from "./view";
import { v2NearNetwork } from "../config";
import type { Repository } from "../repository";
import type {
  Actor,
  Campaign,
  FundingOrder,
  JsonValue,
} from "../types";
import type { OnChainCampaign } from "./types";
import {
  objectValue,
  stringValue,
} from "../validation";

interface DirectInstructions {
  signerId: string;
  tokenContract: string;
  receiverId: string;
  amount: string;
  msg: string;
  attachedDeposit: string;
}

interface VerifiedDirectFundingReceipt {
  txHash: string;
  blockHash: string | null;
  fundingReference: string;
  contractState: OnChainCampaign["status"]["state"];
}

interface DirectFundingReceiptOptions {
  fetchOutcome?: (txHash: string, signerId: string) => Promise<unknown>;
  readCampaign?: (
    campaignId: string,
    contractId: string,
  ) => Promise<OnChainCampaign | null>;
}

function record(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(
      502,
      "INVALID_CHAIN_RECEIPT",
      `The final NEAR receipt has an invalid ${label}`,
    );
  }
  return value as Record<string, unknown>;
}

function instructions(order: FundingOrder): DirectInstructions {
  const value = record(order.quote.instructions, "funding instructions");
  const instruction = {
    signerId: value.signerId,
    tokenContract: value.tokenContract,
    receiverId: value.receiverId,
    amount: value.amount,
    msg: value.msg,
    attachedDeposit: value.attachedDeposit,
  };
  if (
    value.method !== "ft_transfer_call" ||
    typeof instruction.signerId !== "string" ||
    typeof instruction.tokenContract !== "string" ||
    typeof instruction.receiverId !== "string" ||
    typeof instruction.amount !== "string" ||
    typeof instruction.msg !== "string" ||
    instruction.attachedDeposit !== "1" ||
    instruction.receiverId !== order.depositAddress ||
    instruction.amount !== order.principalAmountAtomic ||
    instruction.amount !== order.inputAmountAtomic ||
    instruction.msg !== order.quote.depositMemo
  ) {
    throw new AppError(
      409,
      "INVALID_DIRECT_FUNDING_ORDER",
      "The stored direct funding order does not contain exact pinned transfer instructions",
    );
  }
  return instruction as DirectInstructions;
}

function rpcUrl(): string {
  if (process.env.V2_NEAR_RPC_URL) return process.env.V2_NEAR_RPC_URL;
  return v2NearNetwork() === "testnet"
    ? "https://rpc.testnet.near.org"
    : "https://rpc.mainnet.near.org";
}

async function defaultFetchOutcome(
  txHash: string,
  signerId: string,
): Promise<unknown> {
  const provider = new providers.JsonRpcProvider({ url: rpcUrl() });
  return provider.txStatusReceipts(txHash, signerId, "FINAL");
}

function canonicalBase64Json(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) {
    throw new AppError(
      502,
      "INVALID_CHAIN_RECEIPT",
      "The final NEAR receipt omitted the function-call arguments",
    );
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new AppError(
      502,
      "INVALID_CHAIN_RECEIPT",
      "The final NEAR receipt contains non-canonical function-call arguments",
    );
  }
  try {
    return record(JSON.parse(bytes.toString("utf8")), "function-call arguments");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      502,
      "INVALID_CHAIN_RECEIPT",
      "The final NEAR receipt contains malformed function-call arguments",
    );
  }
}

function timestamp(value: string | null, label: string): string {
  const milliseconds = value ? new Date(value).getTime() : Number.NaN;
  if (!Number.isSafeInteger(milliseconds)) {
    throw new AppError(
      409,
      "INVALID_DIRECT_FUNDING_ORDER",
      `Campaign ${label} is invalid`,
    );
  }
  return String(milliseconds);
}

function contentHashBase64(value: string | null): string {
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new AppError(
      409,
      "INVALID_DIRECT_FUNDING_ORDER",
      "Campaign content hash is invalid",
    );
  }
  return Buffer.from(value, "hex").toString("base64");
}

function assertCampaignReceipt(
  campaign: Campaign,
  order: FundingOrder,
  onChain: OnChainCampaign | null,
): asserts onChain is OnChainCampaign {
  const fundingReference = order.providerReference;
  if (
    !onChain ||
    campaign.reward.type !== "TOKEN_PRIZE" ||
    !campaign.creatorAccountId ||
    !campaign.refundAccount ||
    !campaign.solutionPublicKey ||
    !fundingReference ||
    onChain.campaignId !== campaign.id ||
    onChain.creatorId !== campaign.creatorAccountId ||
    onChain.controllerId !== campaign.creatorAccountId ||
    onChain.sponsorId !== campaign.creatorAccountId ||
    onChain.refundAccountId !== campaign.refundAccount ||
    onChain.contentHash !== contentHashBase64(campaign.contentHash) ||
    onChain.solutionPublicKey !== campaign.solutionPublicKey ||
    onChain.amount !== order.principalAmountAtomic ||
    onChain.opensAtMs !== timestamp(campaign.openingAt, "opening time") ||
    onChain.expiresAtMs !== timestamp(campaign.expiresAt, "expiry time") ||
    onChain.fundingReference !== fundingReference ||
    onChain.fundingRail !== "direct_usdc"
  ) {
    throw new AppError(
      409,
      "DIRECT_FUNDING_NOT_ACCEPTED",
      "The transaction did not produce the exact immutable campaign in escrow",
    );
  }
}

export async function verifyDirectFundingReceipt(
  order: FundingOrder,
  campaign: Campaign,
  txHash: string,
  options: DirectFundingReceiptOptions = {},
): Promise<VerifiedDirectFundingReceipt> {
  if (
    order.rail !== "DIRECT_NEAR" ||
    order.campaignId !== campaign.id ||
    order.depositAddress !== campaign.contractId
  ) {
    throw new AppError(
      409,
      "INVALID_DIRECT_FUNDING_ORDER",
      "This funding order is not a direct transfer to the campaign contract",
    );
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(txHash)) {
    throw new AppError(
      400,
      "INVALID_TRANSACTION_HASH",
      "txHash must be a NEAR transaction hash",
    );
  }
  const expected = instructions(order);
  let outcome: unknown;
  try {
    outcome = await (options.fetchOutcome ?? defaultFetchOutcome)(
      txHash,
      expected.signerId,
    );
  } catch {
    throw new AppError(
      503,
      "CHAIN_RECEIPT_UNAVAILABLE",
      "The final NEAR transaction receipt is not available yet",
    );
  }
  const result = record(outcome, "transaction outcome");
  const status = record(result.status, "transaction status");
  if (
    result.final_execution_status !== "FINAL" ||
    !Object.prototype.hasOwnProperty.call(status, "SuccessValue") ||
    Object.prototype.hasOwnProperty.call(status, "Failure")
  ) {
    throw new AppError(
      409,
      "DIRECT_FUNDING_NOT_FINAL",
      "The direct funding transaction has not completed successfully",
    );
  }
  const transaction = record(result.transaction, "transaction");
  const actions = Array.isArray(transaction.actions)
    ? transaction.actions
    : [];
  if (
    transaction.hash !== txHash ||
    transaction.signer_id !== expected.signerId ||
    transaction.receiver_id !== expected.tokenContract ||
    actions.length !== 1
  ) {
    throw new AppError(
      409,
      "DIRECT_FUNDING_RECEIPT_MISMATCH",
      "The transaction signer, token contract, or action count does not match the quote",
    );
  }
  const action = record(actions[0], "transaction action");
  const call = record(action.FunctionCall, "function-call action");
  const args = canonicalBase64Json(call.args);
  if (
    call.method_name !== "ft_transfer_call" ||
    call.deposit !== expected.attachedDeposit ||
    args.receiver_id !== expected.receiverId ||
    args.amount !== expected.amount ||
    args.msg !== expected.msg
  ) {
    throw new AppError(
      409,
      "DIRECT_FUNDING_RECEIPT_MISMATCH",
      "The final transfer action does not match the exact quoted campaign funding call",
    );
  }

  let onChain: OnChainCampaign | null;
  try {
    onChain = await (options.readCampaign ?? ((campaignId, contractId) =>
      getV2Campaign(campaignId, { contractId })))(
      campaign.id,
      order.depositAddress,
    );
  } catch {
    throw new AppError(
      503,
      "CONTRACT_VIEW_UNAVAILABLE",
      "The campaign contract cannot confirm this transfer yet",
    );
  }
  assertCampaignReceipt(campaign, order, onChain);
  const transactionOutcome = record(
    result.transaction_outcome,
    "transaction outcome receipt",
  );
  return {
    txHash,
    blockHash:
      typeof transactionOutcome.block_hash === "string"
        ? transactionOutcome.block_hash
        : null,
    fundingReference: onChain.fundingReference,
    contractState: onChain.status.state,
  };
}

function evidenceObject(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export async function recordDirectFundingReceipt(
  repository: Repository,
  actor: Actor,
  fundingOrderId: string,
  raw: unknown,
  options: DirectFundingReceiptOptions = {},
): Promise<FundingOrder> {
  const body = objectValue(raw);
  const txHash = stringValue(body.txHash, "txHash", {
    min: 43,
    max: 44,
  })!;
  let order = await repository.getFundingOrder(fundingOrderId);
  if (!order) {
    throw new AppError(
      404,
      "FUNDING_ORDER_NOT_FOUND",
      "Funding order not found",
    );
  }
  if (order.creatorId !== actor.id) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the creator can attach this funding receipt",
    );
  }
  if (order.depositTxHash) {
    if (order.depositTxHash !== txHash) {
      throw new AppError(
        409,
        "DIRECT_FUNDING_RECEIPT_CONFLICT",
        "A different final transaction is already attached to this funding order",
      );
    }
    return order;
  }
  if (
    ![
      "QUOTED",
      "AWAITING_DEPOSIT",
      "DEPOSIT_DETECTED",
      "PROCESSING",
      "INCOMPLETE",
      "EXPIRED",
      "ALLOCATED",
    ].includes(order.status)
  ) {
    throw new AppError(
      409,
      "FUNDING_ORDER_NOT_RECEIPT_READY",
      "This funding order cannot accept a direct funding receipt",
    );
  }
  const campaign = await repository.getCampaign(order.campaignId);
  if (!campaign || campaign.creatorId !== actor.id) {
    throw new AppError(
      404,
      "CAMPAIGN_NOT_FOUND",
      "Campaign not found",
    );
  }
  const receipt = await verifyDirectFundingReceipt(
    order,
    campaign,
    txHash,
    options,
  );
  const target = order.status === "ALLOCATED" ? "ALLOCATED" : "DEPOSIT_DETECTED";
  const updated = await repository.transitionFundingOrder(
    order.id,
    [order.status],
    target,
    order.version,
    {
      depositTxHash: receipt.txHash,
      fundingReference: receipt.fundingReference,
      evidence: {
        ...evidenceObject(order.evidence),
        directFundingReceipt: {
          blockHash: receipt.blockHash,
          contractState: receipt.contractState,
          verifiedAt: new Date().toISOString(),
        },
      },
    },
  );
  if (!updated) {
    order = (await repository.getFundingOrder(order.id))!;
    if (order?.depositTxHash !== txHash) {
      throw new AppError(
        409,
        "FUNDING_STATE_CONFLICT",
        "The funding order changed while its receipt was verified",
      );
    }
    return order;
  }
  const events = await repository.listEvents("FUNDING_ORDER", updated.id);
  if (
    !events.some(
      (event) =>
        event.eventType === "DIRECT_FUNDING_RECEIPT_VERIFIED" &&
        event.idempotencyKey === `direct-receipt:${updated.id}:${txHash}`,
    )
  ) {
    await repository.appendEvent({
      aggregateType: "FUNDING_ORDER",
      aggregateId: updated.id,
      eventType: "DIRECT_FUNDING_RECEIPT_VERIFIED",
      actorId: actor.id,
      fromState: order.status,
      toState: updated.status,
      idempotencyKey: `direct-receipt:${updated.id}:${txHash}`,
      evidence: {
        txHash,
        blockHash: receipt.blockHash,
        fundingReference: receipt.fundingReference,
        contractState: receipt.contractState,
      },
    });
  }
  await enqueueFundingReconciliation(
    repository,
    updated,
    new Date().toISOString(),
    { reactivateDead: true },
  );
  return updated;
}
