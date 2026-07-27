"use client";

import { useState } from "react";
import { confirmFundingAuthorization } from "../lib/api";
import type {
  AuthorizedFundingDeposit,
  CampaignFundingOrder,
  ExternalFundingAuthorizationInstruction,
} from "../lib/types";

const INSTRUCTION_KEY = "creatorAuthorization";
const INSTRUCTION_VERSION = "crossword-external-funding-authorization:v1";
const METHOD_NAME = "authorize_external_funding";
const FUNCTION_CALL_GAS = "100000000000000";
const MIN_STORAGE_DEPOSIT = 50_000_000_000_000_000_000_000n;
const MAX_STORAGE_DEPOSIT = 1_000_000_000_000_000_000_000_000n;
const ATOMIC = /^(?:0|[1-9][0-9]*)$/;
const NEAR_ACCOUNT =
  /^(?=.{2,64}$)(?:[a-z0-9]+[-_])*[a-z0-9]+(?:\.(?:[a-z0-9]+[-_])*[a-z0-9]+)*$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(
  value: Record<string, unknown> | null,
  field: string,
): string | null {
  const candidate = value?.[field];
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null;
}

/**
 * Treat quote instructions as untrusted input. Only the single pinned v2
 * authorization call is returned; arbitrary methods and extra actions fail
 * closed before a wallet is opened.
 */
export function readExternalFundingAuthorizationInstruction(
  instructions: Record<string, unknown>,
): ExternalFundingAuthorizationInstruction | null {
  const authorization = record(instructions[INSTRUCTION_KEY]);
  const walletCall = record(authorization?.walletCall);
  const actions = walletCall?.actions;
  if (
    authorization?.version !== INSTRUCTION_VERSION ||
    !Array.isArray(actions) ||
    actions.length !== 1
  ) {
    return null;
  }

  const action = record(actions[0]);
  const outerArgs = record(action?.args);
  const contractArgs = record(outerArgs?.args);
  const campaign = record(contractArgs?.campaign);
  const authorizedCreator = requiredString(
    authorization,
    "authorizedCreatorAccountId",
  );
  const fundingReference = requiredString(authorization, "fundingReference");
  const signerId = requiredString(walletCall, "signerId");
  const receiverId = requiredString(walletCall, "receiverId");
  const deposit = requiredString(action, "deposit");
  const fundingDeadlineMs = contractArgs?.funding_deadline_ms;
  const campaignExpiresAtMs = campaign?.expires_at_ms;
  const storageDepositNotice = requiredString(
    authorization,
    "storageDepositNotice",
  );
  const expectedPublicContract = process.env.NEXT_PUBLIC_V2_CONTRACT_ID;

  if (
    !authorizedCreator ||
    !NEAR_ACCOUNT.test(authorizedCreator) ||
    signerId !== authorizedCreator ||
    !receiverId ||
    !NEAR_ACCOUNT.test(receiverId) ||
    ((!expectedPublicContract && process.env.NODE_ENV === "production") ||
      (expectedPublicContract && receiverId !== expectedPublicContract)) ||
    action?.type !== "FunctionCall" ||
    action?.methodName !== METHOD_NAME ||
    action?.gas !== FUNCTION_CALL_GAS ||
    !deposit ||
    !ATOMIC.test(deposit) ||
    BigInt(deposit) < MIN_STORAGE_DEPOSIT ||
    BigInt(deposit) > MAX_STORAGE_DEPOSIT ||
    !storageDepositNotice ||
    !fundingReference ||
    contractArgs?.funding_reference !== fundingReference ||
    contractArgs?.funding_rail !== "intents" ||
    contractArgs?.sponsor_id !== authorizedCreator ||
    !Number.isSafeInteger(fundingDeadlineMs) ||
    !Number.isSafeInteger(campaignExpiresAtMs) ||
    (fundingDeadlineMs as number) > (campaignExpiresAtMs as number) ||
    campaign?.creator_id !== authorizedCreator ||
    campaign?.controller_id !== authorizedCreator ||
    campaign?.refund_account_id !== authorizedCreator
  ) {
    return null;
  }

  return authorization as unknown as ExternalFundingAuthorizationInstruction;
}

function transactionHash(outcome: unknown): string | null {
  const value = record(outcome);
  const transaction = record(value?.transaction);
  const transactionOutcome = record(value?.transaction_outcome);
  return (
    requiredString(transaction, "hash") ??
    requiredString(value, "transactionHash") ??
    requiredString(transactionOutcome, "id")
  );
}

export function ExternalFundingAuthorizationAction({
  fundingOrder,
  onVerified,
}: {
  fundingOrder: CampaignFundingOrder;
  onVerified: (deposit: AuthorizedFundingDeposit) => void;
}) {
  const [status, setStatus] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState<"wallet" | "verification" | null>(null);
  const [verified, setVerified] = useState(false);
  const configuredNetwork = process.env.NEXT_PUBLIC_NEAR_NETWORK;
  const network =
    configuredNetwork === "mainnet" || configuredNetwork === "testnet"
      ? configuredNetwork
      : null;
  const authorization = readExternalFundingAuthorizationInstruction(
    fundingOrder.quote.instructions,
  );

  async function verifyAuthorization() {
    setBusy("verification");
    setStatus(
      "Checking the v2 contract at finality. Deposit details remain hidden until this succeeds…",
    );
    try {
      const confirmation = await confirmFundingAuthorization(fundingOrder.id);
      setVerified(true);
      onVerified(confirmation.deposit);
      setStatus(
        "Creator authorization verified at finality. The exact provider deposit is now available below.",
      );
    } catch (error) {
      setStatus(
        `${
          error instanceof Error
            ? error.message
            : "The creator authorization is not finalized yet."
        } Deposit details remain hidden; retry verification in a moment.`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function authorize() {
    if (!authorization) {
      setStatus("The creator authorization instruction is incomplete.");
      return;
    }
    const fundingDeadlineMs =
      authorization.walletCall.actions[0].args.args.funding_deadline_ms;
    if (Date.now() > fundingDeadlineMs) {
      setStatus(
        "This creator authorization has expired. Request a fresh funding quote; no wallet action was sent.",
      );
      return;
    }
    if (!network) {
      setStatus(
        "The NEAR wallet network is not pinned for this deployment. No authorization was sent.",
      );
      return;
    }
    setBusy("wallet");
    setTxHash(null);
    setStatus("Opening the creator’s NEAR wallet…");

    try {
      const wallet = await import("@fastnear/wallet");
      const restored = await wallet.restore({ network });
      const connection = restored ?? (await wallet.connect({ network }));
      if (!connection?.accountId) {
        setStatus("Wallet connection was cancelled. No authorization was sent.");
        return;
      }
      if (
        connection.accountId !== authorization.authorizedCreatorAccountId ||
        connection.accountId !== authorization.walletCall.signerId
      ) {
        setStatus(
          `Connect ${authorization.authorizedCreatorAccountId} to authorize this campaign. No transaction was sent.`,
        );
        return;
      }

      const outcome = await wallet.sendTransaction({
        network,
        signerId: authorization.walletCall.signerId,
        receiverId: authorization.walletCall.receiverId,
        actions: [authorization.walletCall.actions[0]],
      });
      const hash = transactionHash(outcome);
      if (!hash) {
        throw new Error(
          "The wallet returned without a transaction receipt. Check the wallet before retrying.",
        );
      }
      setTxHash(hash);
      setStatus(
        "Creator authorization submitted. Checking independent contract finality before revealing any deposit details…",
      );
      await verifyAuthorization();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "The wallet did not submit the creator authorization.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!authorization) {
    return (
      <div className="direct-funding-action">
        <p className="form-message" role="alert">
          This quote does not contain a valid, pinned creator-authorization
          call. No wallet action or provider deposit is available; request a
          fresh quote.
        </p>
      </div>
    );
  }
  const explorerUrl = txHash && network
    ? `https://${
        network === "testnet" ? "testnet." : ""
      }nearblocks.io/txns/${encodeURIComponent(txHash)}`
    : null;

  return (
    <div className="direct-funding-action">
      <p className="form-note">{authorization.storageDepositNotice}</p>
      <button
        className="button button--ink"
        disabled={busy !== null || Boolean(txHash) || verified || !network}
        onClick={authorize}
        type="button"
      >
        {busy === "wallet"
          ? "Waiting for creator wallet…"
          : txHash
            ? "Creator authorization submitted"
            : "Authorize campaign escrow terms"}
      </button>
      {!verified ? (
        <button
          className="button button--quiet"
          disabled={busy !== null}
          onClick={verifyAuthorization}
          type="button"
        >
          {busy === "verification"
            ? "Checking contract finality…"
            : "Check finalized authorization"}
        </button>
      ) : null}
      {status ? (
        <p className="form-message" role="status">
          {status}
          {txHash && explorerUrl ? (
            <>
              {" "}
              Receipt: <code>{txHash}</code>.{" "}
              <a href={explorerUrl} rel="noreferrer" target="_blank">
                View on NEARBlocks
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
