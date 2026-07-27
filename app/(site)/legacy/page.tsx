import type { Metadata } from "next";
import { LegacyClaimClient } from "../../../src/legacy/LegacyClaimClient";

export const metadata: Metadata = {
  title: "Legacy crossword access",
  description:
    "Access information for rewards and claims held by the original crossword.puzzle.near contract.",
};

const contractId =
  process.env.NEXT_PUBLIC_LEGACY_CONTRACT_ID ?? "crossword.puzzle.near";
const legacyAppUrl = process.env.NEXT_PUBLIC_LEGACY_APP_URL;
const network =
  process.env.NEXT_PUBLIC_LEGACY_NEAR_NETWORK === "testnet"
    ? "testnet"
    : "mainnet";
const explorer =
  network === "testnet"
    ? `https://testnet.nearblocks.io/address/${contractId}`
    : `https://nearblocks.io/address/${contractId}`;

export default function LegacyPage() {
  return (
    <section className="legacy-page">
      <div className="shell legacy-grid">
        <div className="legacy-intro">
          <span className="legacy-stamp">Original contract</span>
          <p className="eyebrow">Legacy access</p>
          <h1>Old prizes stay exactly where they were.</h1>
          <p>
            Crossword Campaigns v2 uses a new USDC escrow contract. It does not
            migrate, wrap, or silently reinterpret puzzles created through the
            original native-NEAR contract.
          </p>
        </div>

        <div className="legacy-card">
          <div className="legacy-card__status">
            <span aria-hidden="true">◌</span>
            <div>
              <strong>Claim continuity, not migration</strong>
              <p>
                Existing solution keys and answer ordering remain governed by
                the original contract.
              </p>
            </div>
          </div>
          <dl>
            <div>
              <dt>Contract</dt>
              <dd>{contractId}</dd>
            </div>
            <div>
              <dt>Reward asset</dt>
              <dd>Native NEAR</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{network}</dd>
            </div>
          </dl>
          <div className="legacy-card__actions">
            {legacyAppUrl ? (
              <a
                className="button button--blue"
                href={legacyAppUrl}
                rel="noreferrer"
              >
                Open original claim app
              </a>
            ) : (
              <span className="legacy-unavailable">
                The original claim UI URL is not configured on this deployment.
              </span>
            )}
            <a
              className="button button--quiet"
              href={explorer}
              target="_blank"
              rel="noreferrer"
            >
              Inspect contract ↗
            </a>
          </div>
          <div className="legacy-recovery">
            <p className="eyebrow">Browser-held recovery</p>
            <p>
              If this is the same browser used to solve an original puzzle, it
              may still hold the narrowly scoped claim capability.
            </p>
            <LegacyClaimClient />
          </div>
          <p className="legacy-card__warning">
            Never enter a seed phrase into this page. If you are expecting a
            legacy prize and the original interface is unavailable, verify the
            contract first and contact the campaign operator.
          </p>
        </div>
      </div>
    </section>
  );
}
