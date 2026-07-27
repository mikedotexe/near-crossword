"use client";

import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";

type Provider = {
  id: string;
  name: string;
  type: string;
};

export function LoginPanel() {
  const [providers, setProviders] = useState<Record<string, Provider> | null>(
    null,
  );
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("Checking available sign-in methods…");

  useEffect(() => {
    let active = true;
    fetch("/api/auth/providers", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return (await response.json()) as Record<string, Provider>;
      })
      .then((result) => {
        if (!active) return;
        setProviders(result);
        setStatus(
          Object.keys(result).length
            ? ""
            : "Creator sign-in has not been configured on this deployment.",
        );
      })
      .catch(() => {
        if (!active) return;
        setProviders({});
        setStatus(
          "Creator sign-in has not been configured on this deployment.",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  const emailProvider = providers
    ? Object.values(providers).find(
        (provider) => provider.type === "email" || provider.id === "email",
      )
    : undefined;
  const googleProvider = providers?.google;

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!emailProvider || !email.trim()) return;
    setStatus("Sending a secure sign-in link…");
    await signIn(emailProvider.id, {
      email: email.trim(),
      callbackUrl: "/dashboard",
    });
  };

  return (
    <div className="login-panel">
      <div className="login-panel__intro">
        <p className="eyebrow">Creator access</p>
        <h1>Your campaigns, in one calm place.</h1>
        <p>
          Sign in to save private drafts, request funding quotes, and reconcile
          prize or refund receipts. Solvers never need an account.
        </p>
        <ul>
          <li>Passwords are never stored here.</li>
          <li>A wallet is optional until direct NEAR funding.</li>
          <li>Campaign evidence remains publicly verifiable.</li>
        </ul>
      </div>

      <div className="login-panel__form">
        <h2>Sign in to continue</h2>
        {emailProvider ? (
          <form onSubmit={submitEmail}>
            <label className="field">
              <span>Email address</span>
              <input
                type="email"
                value={email}
                autoComplete="email"
                required
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <button className="button button--blue button--wide" type="submit">
              Email me a sign-in link
            </button>
          </form>
        ) : null}

        {emailProvider && googleProvider ? (
          <div className="login-divider">
            <span>or</span>
          </div>
        ) : null}

        {googleProvider ? (
          <button
            className="button button--paper button--wide"
            type="button"
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          >
            Continue with Google
          </button>
        ) : null}

        {status ? (
          <p className="auth-status" role="status">
            {status}
          </p>
        ) : null}
        <p className="login-panel__terms">
          Signing in does not fund or publish anything. Every paid action gets
          its own confirmation.
        </p>
      </div>
    </div>
  );
}
