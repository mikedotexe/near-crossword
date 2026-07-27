"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getCampaignLifecycleStatus,
  refreshFundingOrder,
  requestFundingQuote,
} from "../lib/api";
import type {
  AuthorizedFundingDeposit,
  CampaignFundingOrder,
  CampaignLifecycleStatus,
} from "../lib/types";
import { DirectFundingAction } from "./DirectFundingAction";
import { ExternalFundingAuthorizationAction } from "./ExternalFundingAuthorizationAction";

const terminalFundingStates = new Set([
  "ALLOCATED",
  "REFUNDED",
  "FAILED",
]);

function FundingTerms({
  order,
  deposit,
}: {
  order: CampaignFundingOrder;
  deposit: AuthorizedFundingDeposit | null;
}) {
  const external = order.rail === "ONE_CLICK";
  const amount = external
    ? deposit?.inputAmountAtomic ?? order.inputAmountAtomic
    : order.inputAmountAtomic;
  const destination = external
    ? deposit?.depositAddress ?? order.depositAddress
    : order.depositAddress;
  const memo = external
    ? deposit?.depositMemo ?? order.quote.depositMemo
    : order.quote.depositMemo;
  const deadline = external ? deposit?.deadline ?? order.expiresAt : order.expiresAt;
  const asset = external ? deposit?.originAssetId ?? order.originAssetId : order.originAssetId;

  if (!amount || !destination || new Date(deadline).getTime() <= Date.now()) {
    return (
      <p className="form-message" role="alert">
        This quote no longer exposes a complete, live amount and destination.
        Do not send funds from it.
      </p>
    );
  }

  return (
    <>
      <p className="eyebrow">
        {external
          ? "Step 2 of 2 · Authorized funding deposit"
          : "Exact direct funding call"}
      </p>
      <h3>Send only these finalized terms.</h3>
      <dl>
        <div>
          <dt>Prize principal</dt>
          <dd>{order.principalAmountAtomic} atomic USDC</dd>
        </div>
        <div>
          <dt>Asset to send</dt>
          <dd>{asset}</dd>
        </div>
        <div>
          <dt>Exact amount</dt>
          <dd>{amount} atomic units</dd>
        </div>
        <div>
          <dt>Deposit destination</dt>
          <dd>{destination}</dd>
        </div>
        {memo ? (
          <div>
            <dt>Required memo</dt>
            <dd>{memo}</dd>
          </div>
        ) : null}
        <div>
          <dt>Quote expires</dt>
          <dd>{new Date(deadline).toLocaleString()}</dd>
        </div>
      </dl>
      <p>
        Keep this page open while sending, or return later. Publication waits
        for a final receipt and a matching on-chain escrow balance.
      </p>
      {!external ? <DirectFundingAction fundingOrder={order} /> : null}
    </>
  );
}

export function FundingContinuation({
  campaignId,
}: {
  campaignId: string;
}) {
  const [lifecycle, setLifecycle] =
    useState<CampaignLifecycleStatus | null>(null);
  const [authorizedDeposit, setAuthorizedDeposit] =
    useState<AuthorizedFundingDeposit | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "Recovering the latest durable funding state…",
  );

  const load = useCallback(async () => {
    const next = await getCampaignLifecycleStatus(campaignId);
    setLifecycle(next);
    setAuthorizedDeposit(null);
    setMessage(
      next.fundingOrder
        ? next.chainUnavailable
          ? "Funding state recovered from the workflow ledger. Final chain evidence is temporarily unavailable; no transfer was requested."
          : "Funding state recovered from the workflow ledger."
        : "No funding quote exists yet.",
    );
  }, [campaignId]);

  useEffect(() => {
    load().catch((error) => {
      setMessage(
        error instanceof Error
          ? error.message
          : "The creator funding state is unavailable.",
      );
    });
  }, [load]);

  async function refresh() {
    const order = lifecycle?.fundingOrder;
    if (!order) return load();
    setBusy(true);
    setMessage("Checking final settlement and contract evidence…");
    try {
      await refreshFundingOrder(order.id);
      await load();
      setMessage(
        "Latest provider and contract state loaded. No duplicate transfer was requested.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The final funding state is temporarily unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function requote() {
    const order = lifecycle?.fundingOrder;
    if (!order) {
      setMessage(
        "Return to the campaign builder to choose a funding asset for the first quote.",
      );
      return;
    }
    setBusy(true);
    setMessage("Requesting a fresh exact quote. No funds are being moved…");
    try {
      const result = await requestFundingQuote({
        campaignId,
        rail: order.rail === "DIRECT_NEAR" ? "direct" : "intents",
        originAssetId: order.originAssetId,
        refundTo: order.refundTo,
      });
      setLifecycle((current) =>
        current
          ? {
              ...current,
              fundingOrder: result.fundingOrder,
              authorizationRequired: result.authorizationRequired,
              quoteExpired: false,
            }
          : current,
      );
      setAuthorizedDeposit(null);
      setMessage(
        result.authorizationRequired
          ? "Fresh quote ready. Authorize its immutable escrow terms before the deposit is revealed."
          : "Fresh exact quote ready. Review it before opening your wallet.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "A fresh quote is not available. No funds were moved.",
      );
    } finally {
      setBusy(false);
    }
  }

  const order = lifecycle?.fundingOrder ?? null;
  const authorizationPending =
    order?.rail === "ONE_CLICK" &&
    lifecycle?.authorizationRequired === true &&
    !authorizedDeposit;
  const quoteExpired =
    lifecycle?.quoteExpired === true ||
    Boolean(order && new Date(order.expiresAt).getTime() <= Date.now());
  const terminal = Boolean(order && terminalFundingStates.has(order.status));

  return (
    <section className="funding-instructions" aria-live="polite">
      <p className="eyebrow">Private creator funding workspace</p>
      <h2>Continue from the durable receipt.</h2>
      {message ? (
        <p className="form-message" role="status">
          {message}
        </p>
      ) : null}

      {order ? (
        <div className="review-checks">
          <div>
            <span aria-hidden="true">1</span>
            <p>
              <strong>Workflow ledger</strong>
              {order.status.replaceAll("_", " ").toLowerCase()} · version{" "}
              {order.version}
            </p>
          </div>
          <div>
            <span aria-hidden="true">2</span>
            <p>
              <strong>Escrow contract</strong>
              {lifecycle?.chainUnavailable
                ? "final chain view temporarily unavailable"
                : lifecycle?.onChain?.status?.state ?? "awaiting final evidence"}
            </p>
          </div>
        </div>
      ) : null}

      {!order ? (
        <p>
          This private campaign has no recoverable quote. Return to create and
          choose the funding route again.
        </p>
      ) : terminal ? (
        <p>
          {order.status === "ALLOCATED"
            ? "The full prize is allocated. The public campaign appears only after the contract evidence matches every immutable term."
            : `This funding order is ${order.status.toLowerCase()}. No deposit instruction is active.`}
        </p>
      ) : quoteExpired ? (
        <>
          <h3>This quote expired safely.</h3>
          <p>
            Its amount and destination are hidden. Request a fresh quote; never
            reuse an expired provider address or memo.
          </p>
          <button
            className="button button--ink"
            disabled={busy}
            onClick={requote}
            type="button"
          >
            {busy ? "Requesting…" : "Request fresh quote"}
          </button>
        </>
      ) : authorizationPending ? (
        <>
          <h3>Authorize before the provider deposit is revealed.</h3>
          <p>
            Only the pinned v2 contract call is sent to your wallet. Origin
            amount, address, and memo stay masked until finality.
          </p>
          <ExternalFundingAuthorizationAction
            fundingOrder={order}
            onVerified={setAuthorizedDeposit}
          />
        </>
      ) : (
        <FundingTerms order={order} deposit={authorizedDeposit} />
      )}

      {order ? (
        <button
          className="button button--quiet"
          disabled={busy}
          onClick={refresh}
          type="button"
        >
          {busy ? "Checking…" : "Refresh final receipt"}
        </button>
      ) : null}
    </section>
  );
}
