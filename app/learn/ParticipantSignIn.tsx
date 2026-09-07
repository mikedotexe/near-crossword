"use client";

import Link from "next/link";
import { KeyRound, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { loginLink } from "./api";
import { useParticipantAccount } from "./ParticipantAccount";

export function ParticipantSignIn({ returnTo }: { returnTo: string }) {
  const account = useParticipantAccount();
  const [email, setEmail] = useState("");
  const [flowId, setFlowId] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!account.enabled) {
    return (
      <Link className="learn-button" href={loginLink(returnTo)}>
        Sign in to continue
      </Link>
    );
  }
  if (account.state === "initializing" || account.state === "syncing") {
    return <p role="status">Securing your reward account...</p>;
  }
  if (account.state === "ready") {
    return <p role="status">Reward account ready.</p>;
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Coinbase sign-in could not be completed",
      );
    } finally {
      setBusy(false);
    }
  }
  function requestCode(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      setFlowId(await account.requestEmailCode(email));
      setOtp("");
    });
  }
  function verifyCode(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await account.verifyEmailCode(flowId, otp);
    });
  }

  if (account.state === "error") {
    return (
      <div className="learn-auth">
        <p className="learn-error" role="alert">
          {account.error || "Coinbase sign-in could not be completed"}
        </p>
        <button
          className="learn-button secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await account.signOut();
              setFlowId("");
              setOtp("");
            })
          }
        >
          Start sign-in again
        </button>
      </div>
    );
  }

  return (
    <div className="learn-auth">
      {!flowId ? (
        <form onSubmit={requestCode}>
          <label htmlFor="participant-email">Email</label>
          <div className="learn-auth-row">
            <Mail size={17} aria-hidden="true" />
            <input
              id="participant-email"
              type="email"
              autoComplete="email"
              required
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <button className="learn-button" disabled={busy}>
            {busy ? "Sending..." : "Email me a code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode}>
          <label htmlFor="participant-code">Verification code</label>
          <div className="learn-auth-row">
            <KeyRound size={17} aria-hidden="true" />
            <input
              id="participant-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              minLength={6}
              maxLength={12}
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
            />
          </div>
          <p className="learn-muted">Code sent to {email.trim().toLowerCase()}</p>
          <button className="learn-button" disabled={busy}>
            {busy ? "Verifying..." : "Verify and continue"}
          </button>
          <button
            className="learn-auth-reset"
            type="button"
            disabled={busy}
            onClick={() => {
              setFlowId("");
              setOtp("");
              setError("");
            }}
          >
            Use another email
          </button>
        </form>
      )}
      {error && (
        <p className="learn-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
