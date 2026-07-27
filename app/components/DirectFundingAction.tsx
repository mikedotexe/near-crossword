"use client";

import { useState } from "react";
import { recordDirectFundingTransaction } from "../lib/api";
import type { CampaignFundingOrder } from "../lib/types";

interface DirectInstructions {
  signerId: string;
  tokenContract: string;
  receiverId: string;
  amount: string;
  msg: string;
  attachedDeposit: string;
}

function directInstructions(
  order: CampaignFundingOrder,
): DirectInstructions | null {
  const value = order.quote.instructions;
  const expectedContract = process.env.NEXT_PUBLIC_V2_CONTRACT_ID;
  const expectedTokenContract =
    process.env.NEXT_PUBLIC_V2_USDC_CONTRACT_ID;
  if (
    ((!expectedContract || !expectedTokenContract) &&
      process.env.NODE_ENV === "production") ||
    value.method !== "ft_transfer_call" ||
    typeof value.tokenContract !== "string" ||
    typeof value.signerId !== "string" ||
    typeof value.receiverId !== "string" ||
    typeof value.amount !== "string" ||
    typeof value.msg !== "string" ||
    value.amount !== order.principalAmountAtomic ||
    (order.inputAmountAtomic !== null &&
      value.amount !== order.inputAmountAtomic) ||
    value.receiverId !== order.depositAddress ||
    (expectedContract && value.receiverId !== expectedContract) ||
    (expectedTokenContract &&
      value.tokenContract !== expectedTokenContract) ||
    value.msg !== order.quote.depositMemo ||
    value.attachedDeposit !== "1"
  ) {
    return null;
  }
  return {
    signerId: value.signerId,
    tokenContract: value.tokenContract,
    receiverId: value.receiverId,
    amount: value.amount,
    msg: value.msg,
    attachedDeposit: "1",
  };
}

function transactionHash(outcome: unknown): string | null {
  if (!outcome || typeof outcome !== "object") return null;
  const value = outcome as Record<string, unknown>;
  if (
    value.transaction &&
    typeof value.transaction === "object" &&
    typeof (value.transaction as Record<string, unknown>).hash === "string"
  ) {
    return String((value.transaction as Record<string, unknown>).hash);
  }
  return typeof value.transactionHash === "string"
    ? value.transactionHash
    : null;
}

export function DirectFundingAction({
  fundingOrder,
}: {
  fundingOrder: CampaignFundingOrder;
}) {
  const [status, setStatus] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const configuredNetwork = process.env.NEXT_PUBLIC_NEAR_NETWORK;
  const network =
    configuredNetwork === "mainnet" || configuredNetwork === "testnet"
      ? configuredNetwork
      : null;

  if (fundingOrder.rail !== "DIRECT_NEAR") return null;
  const instructions = directInstructions(fundingOrder);

  async function verifyReceipt(hash: string) {
    setStatus(
      "Transfer finalized. Verifying the exact token call and escrow state…",
    );
    await recordDirectFundingTransaction(fundingOrder.id, hash);
    setVerified(true);
    setStatus(
      "Funding receipt verified. Publication waits for final contract and ledger reconciliation.",
    );
  }

  async function fund() {
    if (!instructions) {
      setStatus("The direct funding instructions are incomplete.");
      return;
    }
    if (!network) {
      setStatus(
        "The NEAR wallet network is not pinned for this deployment. No transfer was sent.",
      );
      return;
    }
    setBusy(true);
    setTxHash(null);
    setStatus("Opening a NEAR wallet for the exact USDC transfer…");
    try {
      const wallet = await import("@fastnear/wallet");
      const restored = await wallet.restore({ network });
      const connection = restored ?? (await wallet.connect({ network }));
      if (!connection?.accountId) {
        setStatus("Wallet connection was cancelled. No transfer was sent.");
        return;
      }
      if (connection.accountId !== instructions.signerId) {
        setStatus(
          `Connect ${instructions.signerId}; this campaign cannot be funded from a different NEAR account.`,
        );
        return;
      }
      const outcome = await wallet.sendTransaction({
        network,
        signerId: connection.accountId,
        receiverId: instructions.tokenContract,
        actions: [
          {
            type: "FunctionCall",
            methodName: "ft_transfer_call",
            args: {
              receiver_id: instructions.receiverId,
              amount: instructions.amount,
              msg: instructions.msg,
            },
            gas: "100000000000000",
            deposit: instructions.attachedDeposit,
          },
        ],
      });
      const hash = transactionHash(outcome);
      if (!hash) {
        throw new Error(
          "The wallet returned without a transaction receipt. Check the wallet before retrying.",
        );
      }
      setTxHash(hash);
      await verifyReceipt(hash);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "The wallet did not submit the transfer.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="direct-funding-action">
      <button
        className="button button--ink"
        disabled={busy || !instructions || !network || Boolean(txHash)}
        onClick={fund}
        type="button"
      >
        {busy
          ? "Waiting for wallet…"
          : txHash
            ? "Funding transaction submitted"
            : "Fund exact prize with NEAR wallet"}
      </button>
      {txHash && !verified ? (
        <button
          className="button button--quiet"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await verifyReceipt(txHash);
            } catch (error) {
              setStatus(
                error instanceof Error
                  ? error.message
                  : "The final funding receipt is not available yet.",
              );
            } finally {
              setBusy(false);
            }
          }}
          type="button"
        >
          {busy ? "Checking finality…" : "Retry receipt verification"}
        </button>
      ) : null}
      {status ? (
        <p className="form-message" role="status">
          {status}
          {txHash && network ? (
            <>
              {" "}
              <a
                href={`https://${
                  network === "testnet" ? "testnet." : ""
                }nearblocks.io/txns/${encodeURIComponent(txHash)}`}
                rel="noreferrer"
                target="_blank"
              >
                View transaction
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
