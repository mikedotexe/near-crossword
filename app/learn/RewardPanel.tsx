"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, RefreshCw, Wallet } from "lucide-react";
import type { Address } from "viem";
import {
  assertAccount,
  connectAccount,
  createAccountProvider,
  sendSponsoredClaim,
  signWalletChallenge,
  type AccountProvider,
  type AuthorizedReward,
  type WalletConfiguration,
} from "../../src/lib/base/account";
import { usdcAmount, type PublicLesson } from "../../src/lib/base/learning";
import { learningApi, LearningApiError, loginLink } from "./api";

type Recovery = {
  status: string;
  completed: boolean;
  emailVerified: boolean;
  revision: number;
  recipient?: Address;
  amountAtomic?: string;
  consent: { version: number; shareEmail: boolean };
  receipt?: { transactionHash: string };
  chainId: number;
  rewardTerms: {
    chainId: number;
    escrow: string;
    onChainId: string;
    rewardAtomic: string;
    claimDeadline: number;
  };
};

export function RewardPanel({
  id,
  lesson,
  wallet,
  completionVersion = 0,
}: {
  id: string;
  lesson?: PublicLesson;
  wallet: WalletConfiguration;
  completionVersion?: number;
}) {
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [recipient, setRecipient] = useState<Address | null>(null);
  const [authorization, setAuthorization] = useState<AuthorizedReward | null>(
    null,
  );
  const [pending, setPending] = useState<string | null>(null);
  const [consentDraft, setConsentDraft] = useState<boolean | null>(null);
  const provider = useRef<AccountProvider | null>(null);
  const generation = useRef(0);
  const cleanup = useRef<() => void>(() => {});
  const path = `/api/base/participants/${id}`;
  const terms = lesson
    ? { ...lesson.terms, onChainId: lesson.onChainId }
    : recovery?.rewardTerms;
  const refresh = useCallback(async () => {
    const result = await learningApi<Recovery>(`${path}/claim`);
    setAnonymous(false);
    setRecovery(result);
    if (result.status === "PAID") {
      setPending(null);
      setAuthorization(null);
      try {
        sessionStorage.removeItem(`crossword:pending:${id}`);
      } catch {
        /* A verified receipt wins over local storage. */
      }
    }
    return result;
  }, [path, id]);
  useEffect(() => {
    let active = true;
    setRecovery(null);
    setAnonymous(false);
    void refresh().catch((e) => {
      if (active) {
        if (e instanceof LearningApiError && e.status === 401)
          setAnonymous(true);
        else setError((e as Error).message);
      }
    });
    try {
      setPending(sessionStorage.getItem(`crossword:pending:${id}`));
    } catch {
      /* Recovery remains available without browser storage. */
    }
    return () => {
      active = false;
    };
  }, [refresh, completionVersion, id]);
  useEffect(() => () => cleanup.current(), []);

  async function act(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (e) {
      if (e instanceof LearningApiError && e.status === 401) {
        setAnonymous(true);
        setAuthorization(null);
        setRecovery(null);
      }
      setError(
        e instanceof LearningApiError
          ? e.message
          : "The wallet action did not finish. Check your reward state before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    if (!wallet.enabled || !terms) return;
    cleanup.current();
    provider.current ??= await createAccountProvider(terms.chainId);
    const current = provider.current;
    const invalidate = () => {
      generation.current++;
      setRecipient(null);
      setAuthorization(null);
    };
    for (const event of [
      "accountsChanged",
      "chainChanged",
      "disconnect",
    ] as const)
      current.on(event, invalidate);
    cleanup.current = () => {
      for (const event of [
        "accountsChanged",
        "chainChanged",
        "disconnect",
      ] as const)
        current.removeListener(event, invalidate);
    };
    const account = await connectAccount(current, terms.chainId);
    setRecipient(account);
    setAuthorization(null);
    if (
      recovery?.recipient &&
      recovery.recipient.toLowerCase() !== account.toLowerCase()
    )
      setNotice(
        "This reward belongs to a different account. Reconnect that account to recover it.",
      );
  }
  async function authorize() {
    if (!provider.current || !recipient || !terms || !recovery) return;
    const current = provider.current,
      version = generation.current;
    const challenge = await learningApi<{
      challengeId: string;
      message: string;
    }>(`${path}/wallet-challenge`, { revision: recovery.revision, recipient });
    const signature = await signWalletChallenge(
      current,
      recipient,
      terms.chainId,
      challenge.message,
    );
    if (generation.current !== version) throw new Error();
    const result = await learningApi<AuthorizedReward | Recovery>(
      `${path}/claim`,
      { recipient, proof: { challengeId: challenge.challengeId, signature } },
    );
    await assertAccount(current, recipient, terms.chainId);
    if (generation.current !== version) throw new Error();
    if (result.status === "AUTHORIZED" && "typedData" in result)
      setAuthorization(result);
    await refresh();
  }
  async function send() {
    if (!provider.current || !recipient || !authorization || !terms || pending)
      return;
    const latest = await refresh();
    if (latest.status !== "RECOVERABLE") {
      setAuthorization(null);
      return;
    }
    let batch: string;
    try {
      const current = provider.current, version = generation.current;
      const permit = await learningApi<import("../../src/lib/base/account").SponsorshipPermit>(`${path}/sponsorship`, { digest: authorization.digest });
      if (generation.current !== version || provider.current !== current) throw new Error();
      batch = await sendSponsoredClaim(
        current,
        authorization,
        { recipient, ...terms },
        wallet,
        permit,
        () => {
          // After preflight, persist uncertainty before the wallet can send anything.
          sessionStorage.setItem(`crossword:pending:${id}`, "uncertain");
          setPending("uncertain");
        },
      );
    } catch (e) {
      if (typeof e === "object" && e && "code" in e && e.code === 4001) {
        sessionStorage.removeItem(`crossword:pending:${id}`);
        setPending(null);
      }
      throw e;
    }
    sessionStorage.setItem(`crossword:pending:${id}`, batch);
    setPending(batch);
    setAuthorization(null);
    setNotice(
      "Submitted to your wallet. Your reward is confirmed only after its finalized receipt appears.",
    );
  }
  async function check() {
    if (pending && pending !== "uncertain" && provider.current) {
      const result = (await provider.current.request({
        method: "wallet_getCallsStatus",
        params: [pending],
      })) as { status?: number };
      if (typeof result.status === "number" && result.status >= 400) {
        setPending(null);
        sessionStorage.removeItem(`crossword:pending:${id}`);
        setNotice("The wallet batch failed. Your saved reward can be retried.");
      }
    }
    await refresh();
  }
  const eligible =
    recovery?.completed &&
    recovery.emailVerified &&
    ["NOT_ALLOCATED", "RECOVERABLE"].includes(recovery.status);
  const wrongAccount = Boolean(
    recipient &&
      recovery?.recipient &&
      recovery.recipient.toLowerCase() !== recipient.toLowerCase(),
  );
  return (
    <section className="learn-reward" aria-labelledby="reward-title">
      <div className="learn-section-heading">
        <h2 id="reward-title">Your reward</h2>
        <button
          className="learn-icon"
          title="Check reward status"
          aria-label="Check reward status"
          disabled={busy}
          onClick={() => void act(check)}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {anonymous ? (
        <>
          <p>Verify your email to save a completion and claim a reward.</p>
          <Link className="learn-button" href={loginLink(`/learn/${id}`)}>
            Sign in to continue
          </Link>
        </>
      ) : recovery ? (
        <>
          <ol className="learn-steps">
            <li className={recovery.completed ? "done" : ""}>
              <Check size={16} /> Puzzle completed
            </li>
            <li className={recovery.emailVerified ? "done" : ""}>
              <Check size={16} /> Email verified
            </li>
            <li className={recovery.status === "PAID" ? "done" : ""}>
              <Check size={16} /> Reward received
            </li>
          </ol>
          {recovery.status === "PAID" && recovery.receipt ? (
            <div className="learn-success">
              <strong>
                {usdcAmount(recovery.amountAtomic || "0")} USDC received
              </strong>
              <p>
                Paid to{" "}
                <span className="learn-address">{recovery.recipient}</span>
              </p>
              <a
                href={`https://${recovery.chainId === 84532 ? "sepolia." : ""}basescan.org/tx/${recovery.receipt.transactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View finalized receipt <ExternalLink size={15} />
              </a>
            </div>
          ) : (
            <>
              {!["NOT_ALLOCATED", "RECOVERABLE"].includes(recovery.status) && (
                <p className="learn-notice">
                  {(
                    {
                      PAUSED: "Rewards are paused by the sponsor.",
                      CLOSED: "This campaign is closed.",
                      EXHAUSTED: "All reward slots are allocated.",
                      EXPIRED: "The claim deadline has passed.",
                      NOT_STARTED: "This campaign has not started.",
                      COMPLETION_CLOSED: "The completion window has ended.",
                    } as Record<string, string>
                  )[recovery.status] || "Reward availability is being checked."}
                </p>
              )}
              {!recovery.emailVerified && (
                <Link href={loginLink(`/learn/${id}`)}>Verify your email</Link>
              )}
              {!wallet.enabled || !wallet.sponsoredGas ? (
                <p className="learn-notice">
                  Sponsored wallet claims are not enabled on this deployment.
                </p>
              ) : (
                <>
                  <button
                    className="learn-button secondary"
                    disabled={busy || !terms}
                    onClick={() => void act(connect)}
                  >
                    <Wallet size={17} />
                    {recipient
                      ? "Reconnect Base Account"
                      : "Connect or create Base Account"}
                  </button>
                  {recipient && <p className="learn-address">{recipient}</p>}
                  {recipient && (
                    <button
                      className="learn-button"
                      disabled={
                        busy || !eligible || wrongAccount || Boolean(pending)
                      }
                      onClick={() => void act(authorize)}
                    >
                      {authorization
                        ? "Refresh authorization"
                        : "Verify wallet and reserve reward"}
                    </button>
                  )}
                  {authorization && recipient && (
                    <div className="learn-confirm">
                      <strong>
                        {usdcAmount(authorization.typedData.message.amount)}{" "}
                        USDC to your account
                      </strong>
                      <p>
                        Network fee: sponsored. No token approval or spending
                        permission.
                      </p>
                      <button
                        className="learn-button"
                        disabled={busy || Boolean(pending)}
                        onClick={() => void act(send)}
                      >
                        Claim with sponsored gas
                      </button>
                    </div>
                  )}
                </>
              )}
              {pending && (
                <p className="learn-notice">
                  {pending === "uncertain"
                    ? "Wallet submission is uncertain. Inspect the account activity and check this reward; another transaction will not be sent automatically."
                    : "Wallet submission pending final confirmation."}
                </p>
              )}
            </>
          )}
          {recovery.emailVerified && (
            <label className="learn-consent">
              <input
                type="checkbox"
                checked={consentDraft ?? recovery.consent.shareEmail}
                disabled={busy}
                onChange={(e) => {
                  const shareEmail = e.target.checked;
                  setConsentDraft(shareEmail);
                  void act(async () => {
                    try {
                      await learningApi(
                        `${path}/consent`,
                        {
                          expectedVersion: recovery.consent.version,
                          shareEmail,
                        },
                        "PUT",
                      );
                      await refresh();
                    } finally {
                      setConsentDraft(null);
                    }
                  });
                }}
              />
              <span>
                Share my email with this sponsor for campaign follow-up.
                Optional; does not affect my reward.
              </span>
            </label>
          )}
        </>
      ) : (
        !error && <p role="status">Checking your saved reward...</p>
      )}
      {busy && <p role="status">Waiting for confirmation...</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="learn-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
