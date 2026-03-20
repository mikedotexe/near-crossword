import React, { useEffect, useState } from "react";
import ApiManager from "../../ApiManager";
import CrosswordForm from "../CrosswordForm";
import { trackEvent } from "../../lib/analytics";

const CreatePage = () => {
  const [walletConnected, setWalletConnected] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [useMpp, setUseMpp] = useState(false);

  useEffect(() => {
    let mounted = true;

    ApiManager.instance()
      .then(async (apiInstance) => {
        await apiInstance.ready();
        if (mounted) {
          setWalletConnected(apiInstance.isSignedIn());
        }
      })
      .catch((error) => {
        console.error("Wallet setup failed:", error);
        if (mounted) {
          setWalletError(error.message || "Wallet setup failed.");
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const onConnectWallet = async () => {
    trackEvent("create_connect_wallet_click");
    setWalletError("");
    setConnectingWallet(true);

    try {
      const apiInstance = await ApiManager.instance();
      await apiInstance.ready();

      if (apiInstance.isSignedIn()) {
        setWalletConnected(true);
        trackEvent("wallet_connect_success");
        return;
      }

      const connected = await apiInstance.signIn();
      const isConnected = Boolean(connected && apiInstance.isSignedIn());
      setWalletConnected(isConnected);

      if (isConnected) {
        trackEvent("wallet_connect_success");
      } else {
        trackEvent("wallet_connect_cancel_or_fail", {
          reason: "wallet_connect_cancelled",
        });
      }
    } catch (error) {
      console.error("Wallet sign-in failed:", error);
      setWalletError(error.message || "Wallet sign-in failed.");
      trackEvent("wallet_connect_cancel_or_fail", {
        reason: "wallet_connect_error",
      });
    } finally {
      setConnectingWallet(false);
    }
  };

  // If wallet is connected or using USDC payment, show the form
  if (walletConnected || useMpp) {
    return (
      <section className="card form-card">
        <div className="section-header">
          <p className="eyebrow">Creator Mode</p>
          <h2>Create a new puzzle</h2>
          <ol className="step-list compact-list">
            <li>Write your clues and answers</li>
            <li>Set a reward amount</li>
            <li>Choose how to pay &amp; publish</li>
          </ol>
        </div>
        <CrosswordForm allowMpp={true} />
      </section>
    );
  }

  return (
    <section className="card create-gate">
      <p className="eyebrow">Get Started</p>
      <h2>Create a crossword puzzle</h2>
      <p>
        Choose how you&apos;d like to fund your puzzle&apos;s reward.
      </p>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <button
          className="button button-primary"
          onClick={() => {
            setUseMpp(true);
            trackEvent("create_use_mpp_click");
          }}
        >
          Pay with dollars
        </button>
        <button
          className="button button-secondary"
          onClick={onConnectWallet}
          disabled={connectingWallet}
        >
          {connectingWallet ? "Connecting wallet..." : "Pay with NEAR wallet"}
        </button>
      </div>
      <p style={{ marginTop: "0.5rem", fontSize: "0.82rem", color: "var(--muted)" }}>
        Dollar payments use Tempo&apos;s Machine Payments Protocol (HTTP 402)
        &mdash; no wallet, no sign-up, no checkout page.
      </p>
      {walletError ? <p className="error-msg">{walletError}</p> : null}
    </section>
  );
};

export default CreatePage;
