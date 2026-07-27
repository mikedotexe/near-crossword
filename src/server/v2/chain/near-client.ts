import { connect, keyStores, KeyPair } from "near-api-js";
import type { Near } from "near-api-js";
import type { Account } from "near-api-js";
import { campaignContractId, escrowAsset, v2NearNetwork } from "../config";
import type {
  AllocateExternalFundingInput,
  ChainTransaction,
  StorageRegistrationResult,
  SubmitContractClaimInput,
  V2ChainClient,
} from "./types";
import { getV2Campaign } from "./view";

const GAS_ALLOCATE = 80_000_000_000_000n;
const GAS_CLAIM = 80_000_000_000_000n;
const GAS_STORAGE_DEPOSIT = 40_000_000_000_000n;
const GAS_REFUND = 80_000_000_000_000n;

export interface NearChainConfig {
  networkId: string;
  rpcUrl: string;
  contractId: string;
  usdcContractId: string;
  operatorAccountId: string;
  operatorPrivateKey: string;
  broadcastEnabled: boolean;
}

interface TransactionOutcome {
  status?: unknown;
  transaction?: { hash?: unknown };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the v2 chain worker`);
  return value;
}

export function nearChainConfigFromEnvironment(): NearChainConfig {
  const networkId = v2NearNetwork();
  const rpcUrl =
    process.env.V2_NEAR_RPC_URL ||
    (networkId === "testnet"
      ? "https://rpc.testnet.near.org"
      : "https://rpc.mainnet.near.org");
  return {
    networkId,
    rpcUrl,
    contractId: campaignContractId(),
    usdcContractId: escrowAsset().contractId,
    operatorAccountId: requiredEnvironment("V2_OPERATOR_ACCOUNT_ID"),
    operatorPrivateKey: requiredEnvironment("V2_OPERATOR_PRIVATE_KEY"),
    broadcastEnabled: process.env.V2_CHAIN_BROADCAST_ENABLED === "true",
  };
}

function transactionHash(outcome: unknown): string {
  const result = outcome as TransactionOutcome;
  if (
    result.status &&
    typeof result.status === "object" &&
    "Failure" in result.status
  ) {
    throw new Error("NEAR transaction completed with a failed execution outcome");
  }
  const hash = result.transaction?.hash;
  if (typeof hash !== "string" || !hash) {
    throw new Error("NEAR transaction did not return a transaction hash");
  }
  return hash;
}

function decimalAmount(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value : "";
  if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)) {
    throw new Error(`${label} returned an invalid atomic amount`);
  }
  return normalized;
}

export class NearApiV2ChainClient implements V2ChainClient {
  readonly contractId: string;
  readonly usdcContractId: string;

  private readonly config: NearChainConfig;
  private nearConnection: Promise<Near> | null = null;

  constructor(config: NearChainConfig) {
    this.config = { ...config };
    this.contractId = config.contractId;
    this.usdcContractId = config.usdcContractId;
  }

  static fromEnvironment(): NearApiV2ChainClient {
    return new NearApiV2ChainClient(nearChainConfigFromEnvironment());
  }

  async getCampaign(campaignId: string) {
    return getV2Campaign(campaignId, {
      contractId: this.contractId,
      rpcUrl: this.config.rpcUrl,
    });
  }

  async allocateExternalFunding(
    input: AllocateExternalFundingInput,
  ): Promise<ChainTransaction> {
    const account = await this.operatorAccount();
    const outcome = await account.functionCall({
      contractId: this.contractId,
      methodName: "activate_external_funding",
      args: {
        args: {
          campaign_id: input.campaignId,
          funding_reference: input.fundingReference,
        },
      },
      gas: GAS_ALLOCATE,
      attachedDeposit: 0n,
    });
    return { txHash: transactionHash(outcome) };
  }

  async ensureStorageRegistration(
    accountId: string,
  ): Promise<StorageRegistrationResult> {
    this.assertBroadcastEnabled();
    const account = await this.operatorAccount();
    const existing = await account.viewFunction({
      contractId: this.usdcContractId,
      methodName: "storage_balance_of",
      args: { account_id: accountId },
      blockQuery: { finality: "final" },
    });
    if (existing !== null) {
      return { alreadyRegistered: true, txHash: null };
    }
    const bounds = (await account.viewFunction({
      contractId: this.usdcContractId,
      methodName: "storage_balance_bounds",
      args: {},
      blockQuery: { finality: "final" },
    })) as { min?: unknown };
    const minimum = decimalAmount(bounds?.min, "storage_balance_bounds.min");
    const outcome = await account.functionCall({
      contractId: this.usdcContractId,
      methodName: "storage_deposit",
      args: { account_id: accountId, registration_only: true },
      gas: GAS_STORAGE_DEPOSIT,
      attachedDeposit: BigInt(minimum),
    });
    return {
      alreadyRegistered: false,
      txHash: transactionHash(outcome),
    };
  }

  async submitContractClaim(
    input: SubmitContractClaimInput,
  ): Promise<ChainTransaction> {
    const account = await this.operatorAccount();
    const outcome = await account.functionCall({
      contractId: this.contractId,
      methodName: "claim",
      args: {
        args: {
          campaign_id: input.campaignId,
          receiver_id: input.receiverId,
          payout_digest: input.payoutDigest,
          nonce: input.nonce,
          deadline_ms: input.deadlineMs,
          signature: input.signature,
        },
      },
      gas: GAS_CLAIM,
      attachedDeposit: 0n,
    });
    return { txHash: transactionHash(outcome) };
  }

  async cancelBeforeOpen(campaignId: string): Promise<ChainTransaction> {
    return this.campaignRefundCall("cancel_before_open", campaignId);
  }

  async expireAndRefund(campaignId: string): Promise<ChainTransaction> {
    return this.campaignRefundCall("expire_and_refund", campaignId);
  }

  async retryRefund(campaignId: string): Promise<ChainTransaction> {
    return this.campaignRefundCall("retry_refund", campaignId);
  }

  private assertBroadcastEnabled(): void {
    if (!this.config.broadcastEnabled) {
      throw new Error(
        "V2 chain broadcasting is disabled; set V2_CHAIN_BROADCAST_ENABLED=true explicitly",
      );
    }
  }

  private async operatorAccount(): Promise<Account> {
    this.assertBroadcastEnabled();
    if (!this.nearConnection) {
      this.nearConnection = this.connect();
    }
    const near = await this.nearConnection;
    return near.account(this.config.operatorAccountId);
  }

  private async campaignRefundCall(
    methodName: "cancel_before_open" | "expire_and_refund" | "retry_refund",
    campaignId: string,
  ): Promise<ChainTransaction> {
    const account = await this.operatorAccount();
    const outcome = await account.functionCall({
      contractId: this.contractId,
      methodName,
      args: { campaign_id: campaignId },
      gas: GAS_REFUND,
      attachedDeposit: 0n,
    });
    return { txHash: transactionHash(outcome) };
  }

  private async connect(): Promise<Near> {
    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = KeyPair.fromString(
      this.config.operatorPrivateKey as
        | `ed25519:${string}`
        | `secp256k1:${string}`,
    );
    await keyStore.setKey(
      this.config.networkId,
      this.config.operatorAccountId,
      keyPair,
    );
    return connect({
      networkId: this.config.networkId,
      nodeUrl: this.config.rpcUrl,
      keyStore,
    });
  }
}
