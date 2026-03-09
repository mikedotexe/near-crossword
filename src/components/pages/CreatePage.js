import React, { useEffect, useState } from "react";
import ApiManager from "../../ApiManager";
import CrosswordForm from "../CrosswordForm";
import { trackEvent } from "../../lib/analytics";

const CreatePage = () => {
  const [walletConnected, setWalletConnected] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [walletError, setWalletError] = useState("");

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

  if (walletConnected) {
    return (
      <section className="card form-card">
        <div className="section-header">
          <p className="eyebrow">Creator Mode</p>
          <h2>Create a new puzzle</h2>
          <ol className="step-list compact-list">
            <li>Write your clues and answers</li>
            <li>Set a reward amount</li>
            <li>Publish</li>
          </ol>
        </div>
        <CrosswordForm />
      </section>
    );
  }

  return (
    <section className="card create-gate">
      <p className="eyebrow">Get Started</p>
      <h2>Connect your wallet to create puzzles</h2>
      <p>
        You&apos;ll need a NEAR wallet to publish puzzles and attach rewards.
      </p>
      <button
        className="button button-primary"
        onClick={onConnectWallet}
        disabled={connectingWallet}
      >
        {connectingWallet ? "Connecting wallet..." : "Connect Wallet to Start"}
      </button>
      {walletError ? <p className="error-msg">{walletError}</p> : null}
    </section>
  );
};

export default CreatePage;
