import type { FundingObservation } from "../funding/types";
import type { Repository } from "../repository";
import type {
  Campaign,
  Claim,
  ClaimStatus,
  JsonValue,
  OperationEvent,
} from "../types";

export type OneClickPayoutOutcome =
  | "PENDING"
  | "SETTLED"
  | "RECOVERED"
  | "FAILED"
  | "MISSING_RECEIPT";

export interface OneClickPayoutResult {
  outcome: OneClickPayoutOutcome;
  terminal: boolean;
  claimStatus: ClaimStatus;
  settlementTxHash: string | null;
}

function record(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function classifyOneClickPayout(
  observation: FundingObservation,
): OneClickPayoutOutcome {
  if (observation.orderStatus === "SETTLED") {
    return observation.settlementTxHash ? "SETTLED" : "MISSING_RECEIPT";
  }
  if (observation.orderStatus === "REFUNDED") {
    return observation.settlementTxHash ? "RECOVERED" : "MISSING_RECEIPT";
  }
  if (observation.orderStatus === "FAILED") return "FAILED";
  return "PENDING";
}

async function appendEventOnce(
  repository: Repository,
  input: Omit<OperationEvent, "id" | "createdAt">,
): Promise<void> {
  const events = await repository.listEvents(
    input.aggregateType,
    input.aggregateId,
  );
  if (
    events.some(
      (event) =>
        event.eventType === input.eventType &&
        event.idempotencyKey === input.idempotencyKey,
    )
  ) {
    return;
  }
  await repository.appendEvent(input);
}

function assertWinnerOwnedRoute(
  claim: Claim,
  observation: FundingObservation,
): void {
  if (claim.payout.kind !== "ONE_CLICK" || !claim.payoutQuote) {
    throw new Error("Claim is not a quoted 1Click payout");
  }
  const observedAddress = observation.evidence.depositAddress;
  if (
    typeof observedAddress !== "string" ||
    observedAddress !== claim.payoutQuote.depositAddress
  ) {
    throw new Error("1Click observation does not match the signed deposit address");
  }
  const originalReceiver = record(claim.evidence).receiverId;
  if (
    typeof originalReceiver !== "string" ||
    originalReceiver !== claim.payoutQuote.depositAddress
  ) {
    throw new Error("Claim evidence does not match the signed 1Click deposit address");
  }
  if (!claim.payout.recoveryAccount) {
    throw new Error("1Click payout has no winner-controlled recovery account");
  }
}

function terminalClaimPatch(
  claim: Claim,
  observation: FundingObservation,
  outcome: Extract<OneClickPayoutOutcome, "SETTLED" | "RECOVERED">,
): Pick<Claim, "settlementTxHash" | "evidence"> {
  return {
    settlementTxHash:
      observation.settlementTxHash ?? claim.settlementTxHash,
    evidence: {
      ...record(claim.evidence),
      ...observation.evidence,
      oneClickProviderStatus: observation.providerStatus,
      oneClickOutcome: outcome,
      payoutDestinationAsset: claim.payout.destinationAsset,
      payoutRecipient: claim.payout.recipient,
      winnerRecoveryAccount: claim.payout.recoveryAccount,
      downstreamReceipt: observation.settlementTxHash,
      downstreamObservedAt: new Date().toISOString(),
    },
  };
}

async function appendTerminalEvent(
  repository: Repository,
  claim: Claim,
): Promise<void> {
  if (claim.status !== "PAID" && claim.status !== "RECOVERED") {
    throw new Error("Cannot record a non-terminal 1Click payout event");
  }
  const evidence = record(claim.evidence);
  await appendEventOnce(repository, {
    aggregateType: "CLAIM",
    aggregateId: claim.id,
    eventType:
      claim.status === "PAID"
        ? "ONE_CLICK_PAYOUT_SETTLED"
        : "ONE_CLICK_PAYOUT_REFUNDED_TO_WINNER",
    actorId: claim.claimantId,
    fromState: "PAYING",
    toState: claim.status,
    idempotencyKey: `one-click-terminal:${claim.id}`,
    evidence: {
      providerStatus: evidence.oneClickProviderStatus ?? null,
      settlementTxHash: claim.settlementTxHash,
      destinationAsset: claim.payout.destinationAsset,
      recipient: claim.payout.recipient,
      recoveryAccount: claim.payout.recoveryAccount,
      responseDigest: evidence.responseDigest ?? null,
    },
  });
}

export async function repairTerminalOneClickPayout(
  repository: Repository,
  claim: Claim,
  campaign: Campaign,
): Promise<OneClickPayoutResult> {
  if (claim.campaignId !== campaign.id) {
    throw new Error("Claim and campaign do not match");
  }
  if (claim.status !== "PAID" && claim.status !== "RECOVERED") {
    throw new Error("1Click payout is not terminal");
  }
  if (claim.payout.kind !== "ONE_CLICK" || !claim.payoutQuote) {
    throw new Error("Claim is not a quoted 1Click payout");
  }
  const finalized = await repository.finalizeOneClickPayoutAtomically({
    claimId: claim.id,
    campaignId: campaign.id,
    target: claim.status,
  });
  if (!finalized) {
    throw new Error("Terminal 1Click ledger repair conflicted");
  }
  await appendTerminalEvent(repository, finalized.claim);
  return {
    outcome: finalized.claim.status === "PAID" ? "SETTLED" : "RECOVERED",
    terminal: true,
    claimStatus: finalized.claim.status,
    settlementTxHash: finalized.claim.settlementTxHash,
  };
}

async function updateClaim(
  repository: Repository,
  claim: Claim,
  to: ClaimStatus,
  observation: FundingObservation,
  outcome: OneClickPayoutOutcome,
): Promise<Claim> {
  const currentEvidence = record(claim.evidence);
  const nextEvidence: Record<string, JsonValue> = {
    ...currentEvidence,
    ...observation.evidence,
    oneClickProviderStatus: observation.providerStatus,
    oneClickOutcome: outcome,
    payoutDestinationAsset: claim.payout.destinationAsset,
    payoutRecipient: claim.payout.recipient,
    winnerRecoveryAccount: claim.payout.recoveryAccount,
    downstreamReceipt: observation.settlementTxHash,
    downstreamObservedAt: new Date().toISOString(),
  };
  const transitioned = await repository.transitionClaim(
    claim.id,
    [claim.status],
    to,
    claim.version,
    {
      settlementTxHash:
        observation.settlementTxHash ?? claim.settlementTxHash,
      evidence: nextEvidence,
    },
  );
  if (!transitioned) {
    const current = await repository.getClaim(claim.id);
    if (!current || current.status !== to) {
      throw new Error("1Click claim reconciliation conflicted");
    }
    return current;
  }
  return transitioned;
}

export async function reconcileOneClickPayout(
  repository: Repository,
  claim: Claim,
  campaign: Campaign,
  observation: FundingObservation,
): Promise<OneClickPayoutResult> {
  if (claim.campaignId !== campaign.id) {
    throw new Error("Claim and campaign do not match");
  }
  assertWinnerOwnedRoute(claim, observation);
  const outcome = classifyOneClickPayout(observation);

  if (outcome === "SETTLED" || outcome === "RECOVERED") {
    const target = outcome === "SETTLED" ? "PAID" : "RECOVERED";
    if (
      claim.status !== target &&
      !["PAYING", "FAILED"].includes(claim.status)
    ) {
      throw new Error(`Cannot finalize 1Click payout from ${claim.status}`);
    }
    const finalized = await repository.finalizeOneClickPayoutAtomically({
      claimId: claim.id,
      campaignId: campaign.id,
      target,
      claimPatch: terminalClaimPatch(claim, observation, outcome),
    });
    if (!finalized) {
      throw new Error("1Click terminal ledger reconciliation conflicted");
    }
    claim = finalized.claim;
    await appendTerminalEvent(repository, claim);
    return {
      outcome,
      terminal: true,
      claimStatus: target,
      settlementTxHash: claim.settlementTxHash,
    };
  }

  const nextStatus: ClaimStatus =
    outcome === "FAILED" ? "FAILED" : claim.status;
  const previousEvidence = record(claim.evidence);
  if (
    previousEvidence.oneClickProviderStatus !== observation.providerStatus ||
    previousEvidence.responseDigest !== observation.evidence.responseDigest ||
    claim.status !== nextStatus
  ) {
    claim = await updateClaim(
      repository,
      claim,
      nextStatus,
      observation,
      outcome,
    );
    await appendEventOnce(repository, {
      aggregateType: "CLAIM",
      aggregateId: claim.id,
      eventType:
        outcome === "FAILED"
          ? "ONE_CLICK_PAYOUT_FAILED_PENDING_RECOVERY"
          : "ONE_CLICK_PAYOUT_STATUS_OBSERVED",
      actorId: claim.claimantId,
      fromState: null,
      toState: nextStatus,
      idempotencyKey: `one-click-observation:${claim.id}:${claim.version}`,
      evidence: {
        providerStatus: observation.providerStatus,
        responseDigest: observation.evidence.responseDigest ?? null,
        winnerRecoveryAccount: claim.payout.recoveryAccount,
      },
    });
  }
  return {
    outcome,
    terminal: false,
    claimStatus: nextStatus,
    settlementTxHash: observation.settlementTxHash,
  };
}
