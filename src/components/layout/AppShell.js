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
