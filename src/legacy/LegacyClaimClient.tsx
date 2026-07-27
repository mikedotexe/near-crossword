"use client";

import { FormEvent, useState } from "react";
import * as near from "@fastnear/api";
import {
  getTransactionFailure,
  getTransactionHash,
} from "@/src/lib/txResult";

const LEGACY_CONTRACT =
  process.env.NEXT_PUBLIC_LEGACY_CONTRACT_ID || "crossword.puzzle.near";
const LEGACY_NETWORK =
  process.env.NEXT_PUBLIC_LEGACY_NEAR_NETWORK === "testnet"
    ? "testnet"
    : "mainnet";
const LEGACY_RPC = `https://rpc.${LEGACY_NETWORK}.fastnear.com`;

interface LegacyPlayerKey {
  publicKey: string;
  secretKey: string;
  seedPhrase?: string;
}

type RecoveryState =
  | { kind: "idle" }
  | { kind: "missing" }
  | {
      kind: "ready";
      key: LegacyPlayerKey;
      puzzleKey: string;
    }
  | { kind: "submitting" }
  | { kind: "success"; transactionHash?: string }
  | { kind: "error"; message: string };

function configureLegacySigner(key: LegacyPlayerKey) {
  near.config({
    networkId: LEGACY_NETWORK,
    nodeUrl: LEGACY_RPC,
  });
  const legacyState = near.state as {
    update(input: {
      accountId: string;
      privateKey: string;
      accessKeyContractId: string;
    }): void;
  };
  legacyState.update({
    accountId: LEGACY_CONTRACT,
    privateKey: key.secretKey,
    accessKeyContractId: LEGACY_CONTRACT,
  });
}

export function LegacyClaimClient() {
  const [state, setState] = useState<RecoveryState>({ kind: "idle" });
  const [receiver, setReceiver] = useState("");
  const [memo, setMemo] = useState("");
  const [createAccount, setCreateAccount] = useState(false);
  const [confirmedBackup, setConfirmedBackup] = useState(false);

  function inspectThisBrowser() {
    try {
      const encodedKey = window.localStorage.getItem("playerKeyPair");
      const puzzleKey = window.localStorage.getItem("playerSolvedPuzzle");
      if (!encodedKey || !puzzleKey) {
        setState({ kind: "missing" });
        return;
      }

      const key = JSON.parse(encodedKey) as LegacyPlayerKey;
      if (!key.publicKey || !key.secretKey) {
        setState({ kind: "missing" });
        return;
      }
      setState({ kind: "ready", key, puzzleKey });
    } catch {
      setState({
        kind: "error",
        message: "The legacy recovery data in this browser could not be read.",
      });
    }
  }

  async function submitClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind !== "ready") return;
    if (!receiver.trim()) {
      setState({ kind: "error", message: "Enter a destination account." });
      return;
    }
    if (createAccount && !confirmedBackup) {
      setState({
        kind: "error",
        message: "Back up the displayed seed phrase before creating an account.",
      });
      return;
    }

    const ready = state;
    setState({ kind: "submitting" });

    try {
      configureLegacySigner(ready.key);
      const args = createAccount
        ? {
            crossword_pk: ready.puzzleKey,
            new_acc_id: receiver.trim().toLowerCase(),
            new_pk: ready.key.publicKey,
            memo,
          }
        : {
            crossword_pk: ready.puzzleKey,
            receiver_acc_id: receiver.trim().toLowerCase(),
            memo,
          };

      const transaction = await near.sendTx({
        receiverId: LEGACY_CONTRACT,
        actions: [
          near.actions.functionCall({
            methodName: createAccount
              ? "claim_reward_new_account"
              : "claim_reward",
            args,
            gas: "300000000000000",
            deposit: "0",
          }),
        ],
        waitUntil: "FINAL",
      });

      const failure = getTransactionFailure(transaction);
      if (failure) {
        throw new Error("The legacy contract rejected this claim.");
      }

      window.localStorage.removeItem("playerSolvedPuzzle");
      window.localStorage.removeItem("guesses");
      setState({
        kind: "success",
        transactionHash: getTransactionHash(transaction) || undefined,
      });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The legacy claim could not be submitted.",
      });
    }
  }

  if (state.kind === "idle") {
    return (
      <button className="button button--ink" type="button" onClick={inspectThisBrowser}>
        Check this browser for a legacy claim
      </button>
    );
  }

  if (state.kind === "missing") {
    return (
      <div className="notice">
        No pending legacy claim was found in this browser. Legacy recovery data
        was stored only on the device that solved the original puzzle.
      </div>
    );
  }

  if (state.kind === "submitting") {
    return <div className="notice">Submitting the legacy claim to finality…</div>;
  }

  if (state.kind === "success") {
    return (
      <div className="notice notice--success">
        Legacy claim finalized.
        {state.transactionHash ? (
          <>
            {" "}
            <a
              href={`https://nearblocks.io/txns/${state.transactionHash}`}
              rel="noreferrer"
              target="_blank"
            >
              View transaction
            </a>
          </>
        ) : null}
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="notice notice--error">
        {state.message}{" "}
        <button className="text-button" type="button" onClick={inspectThisBrowser}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <form className="legacy-claim-form" onSubmit={submitClaim}>
      <div className="notice">
        A pending claim capability was found. Its secret remains in this browser
        and is used only to sign the legacy contract call.
      </div>

      <label className="field">
        <span>Destination NEAR account</span>
        <input
          autoComplete="off"
          onChange={(event) => setReceiver(event.target.value)}
          placeholder="winner.near"
          required
          value={receiver}
        />
      </label>

      <label className="field">
        <span>Public winning note</span>
        <input
          maxLength={160}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="Solved!"
          value={memo}
        />
      </label>

      <label className="check-row">
        <input
          checked={createAccount}
          onChange={(event) => setCreateAccount(event.target.checked)}
          type="checkbox"
        />
        Create this NEAR account as part of the claim
      </label>

      {createAccount ? (
        <div className="seed-backup">
          <strong>Back up this recovery phrase first</strong>
          <code>{state.key.seedPhrase || "Recovery phrase unavailable"}</code>
          <label className="check-row">
            <input
              checked={confirmedBackup}
              disabled={!state.key.seedPhrase}
              onChange={(event) => setConfirmedBackup(event.target.checked)}
              type="checkbox"
            />
            I saved the recovery phrase
          </label>
        </div>
      ) : null}

      <button className="button button--ink" type="submit">
        Claim from the legacy contract
      </button>
    </form>
  );
}
