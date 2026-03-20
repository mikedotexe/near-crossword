import React from "react";
import TopNav from "./TopNav";
import CampaignBanner from "../marketing/CampaignBanner";
import ContextStrip from "../marketing/ContextStrip";
import Loader from "../../loader";
import { useAppFlow } from "../../lib/appFlow";

const AppShell = ({
  children,
  showCampaign = false,
  contextMessage,
  contextCtaHref,
  contextCtaLabel,
  warningMessage = "",
}) => {
  const { hasActivePuzzle, showLoader } = useAppFlow();

  return (
    <div className="app-shell">
      <TopNav hasActivePuzzle={hasActivePuzzle} />
      {showCampaign ? <CampaignBanner /> : null}
      {!showCampaign ? (
        <ContextStrip
          message={contextMessage}
          ctaHref={contextCtaHref}
          ctaLabel={contextCtaLabel}
        />
      ) : null}
      {warningMessage ? (
        <div className="app-container">
          <section className="warning-strip" role="status">
            <p>{warningMessage}</p>
          </section>
        </div>
      ) : null}
      <main className="app-main app-container">{children}</main>
      {showLoader ? <Loader /> : null}
      <footer className="site-footer">
        <p>
          Built on{" "}
          <a href="https://near.org" target="_blank" rel="noreferrer">
            NEAR Protocol
          </a>
          {" · Payments by "}
          <a href="https://tempo.xyz" target="_blank" rel="noreferrer">
            Tempo
          </a>
          {process.env.NEXT_PUBLIC_MPP_TESTNET !== "false" ? (
            <span style={{ marginLeft: "6px", fontSize: "0.7rem", padding: "2px 6px", borderRadius: "4px", background: "rgba(99,102,241,0.15)", color: "var(--primary)" }}>
              Moderato testnet
            </span>
          ) : null}
          {" · "}
          <a
            href="https://github.com/mikedotexe/near-crossword"
            target="_blank"
            rel="noreferrer"
          >
            Source
          </a>
        </p>
      </footer>
    </div>
  );
};

export default AppShell;
