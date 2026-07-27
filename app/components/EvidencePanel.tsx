import type { Campaign } from "../lib/types";

function shorten(value: string) {
  return value.length > 30 ? `${value.slice(0, 15)}…${value.slice(-8)}` : value;
}

export function EvidencePanel({ campaign }: { campaign: Campaign }) {
  const unpublished = ["draft", "awaiting_funding"].includes(campaign.state);
  const verification = campaign.verification;
  const verified = verification.status === "verified";
  const funded = verified && verification.fundedAndLocked;
  const contractState = verification.contractState;
  const heading =
    campaign.isDemo || verification.status === "preview"
      ? "Preview evidence"
      : unpublished
        ? "Funding not settled"
        : !verified || !verification.contractMatchesLedger
          ? "Verification unavailable"
          : campaign.state === "claimed"
            ? "Prize paid"
            : contractState === "claimed" && campaign.state === "claiming"
              ? "Prize routing"
            : campaign.state === "refunded" || contractState === "refunded"
              ? "Prize refunded"
              : campaign.state === "refunding" || contractState === "refunding"
                ? "Refund in progress"
                : campaign.state === "claiming" || contractState === "claiming"
                  ? "Claim in progress"
                : funded
                  ? "Funded and locked"
                  : "Escrow state changed";

  return (
    <section className="evidence-panel" aria-labelledby="evidence-title">
      <div className="evidence-panel__heading">
        <div className="lock-seal" aria-hidden="true">
          <span />
        </div>
        <div>
          <p className="eyebrow">Verifiable prize</p>
          <h2 id="evidence-title">{heading}</h2>
        </div>
      </div>
      {campaign.isDemo || verification.status === "preview" ? (
        <p>
          This preview shows the evidence layout only. It is not a funded
          campaign or an escrow receipt.
        </p>
      ) : campaign.state === "claimed" ? (
        <p>
          The one-time claim and its terminal delivery or recovery receipt are
          final in the workflow ledger.
        </p>
      ) : contractState === "claimed" && campaign.state === "claiming" ? (
        <p>
          The one-time claim left escrow and is still routing. Delivery is not
          reported until the downstream receipt or winner-controlled recovery
          is final.
        </p>
      ) : campaign.state === "refunded" || contractState === "refunded" ? (
        <p>
          The campaign’s immutable recovery path completed. The explorer
          evidence below identifies the terminal contract state.
        </p>
      ) : campaign.state === "claiming" || contractState === "claiming" ? (
        <p>
          A valid first claim is being finalized. No second solver can redirect
          the signed payout.
        </p>
      ) : funded ? (
        <p>
          The prize and puzzle fingerprint were fixed before play began. A
          valid first solution can claim once; an expired campaign returns
          funds to its sponsor-controlled recovery account.
        </p>
      ) : unpublished ? (
        <p>
          This private draft is not playable or published. It becomes a live
          campaign only after the complete USDC principal settles into v2
          escrow and the contract records the reservation.
        </p>
      ) : verified && verification.contractMatchesLedger ? (
        <p>
          The escrow contract and workflow ledger agree on this campaign’s
          terminal state. Follow the explorer evidence below for the public
          receipt.
        </p>
      ) : (
        <p>
          The app could not match a final contract view to the workflow ledger.
          No funded-prize claim is shown until that read-only verification
          succeeds.
        </p>
      )}

      {campaign.isDemo ? (
        <div className="demo-note">
          Preview data — these rows illustrate the evidence a live campaign
          publishes and are not a real escrow receipt.
        </div>
      ) : null}

      <dl className="evidence-list">
        {campaign.evidence.map((item) => (
          <div key={`${item.label}-${item.value}`}>
            <dt>{item.label}</dt>
            <dd>
              {item.href ? (
                <a href={item.href} target="_blank" rel="noreferrer">
                  {shorten(item.value)}
                  <span aria-hidden="true"> ↗</span>
                </a>
              ) : (
                shorten(item.value)
              )}
            </dd>
          </div>
        ))}
        {!campaign.evidence.some((item) => item.label === "Escrow contract") ? (
          <div>
            <dt>Contract</dt>
            <dd>{campaign.contractId}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
