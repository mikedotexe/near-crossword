import type { Repository } from "../repository";
import type { FundingOrder, Job } from "../types";

const DEFAULT_MAX_ATTEMPTS = 8;

export type RefundReason = "CREATOR_CANCEL" | "EXPIRED";
export interface EnqueueRecoveryOptions {
  reactivateDead?: boolean;
}

export async function enqueueFundingReconciliation(
  repository: Repository,
  order: FundingOrder,
  runAfter = new Date().toISOString(),
  options: EnqueueRecoveryOptions = {},
): Promise<Job> {
  const result = await repository.enqueueJob({
    type: "RECONCILE_FUNDING_ORDER",
    aggregateType: "FUNDING_ORDER",
    aggregateId: order.id,
    deduplicationKey: `funding-reconcile:${order.id}`,
    payload: {
      fundingOrderId: order.id,
      campaignId: order.campaignId,
    },
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    runAfter,
    reactivateDead: options.reactivateDead,
  });
  return result.job;
}

export async function enqueueCampaignLifecycle(
  repository: Repository,
  campaignId: string,
  fundingOrderId: string,
  runAfter = new Date().toISOString(),
): Promise<Job> {
  const result = await repository.enqueueJob({
    type: "RECONCILE_CAMPAIGN_LIFECYCLE",
    aggregateType: "CAMPAIGN",
    aggregateId: campaignId,
    deduplicationKey: `campaign-lifecycle:${campaignId}`,
    payload: { campaignId, fundingOrderId },
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    runAfter,
  });
  return result.job;
}

export async function enqueueCampaignRefund(
  repository: Repository,
  campaignId: string,
  fundingOrderId: string,
  reason: RefundReason,
  runAfter = new Date().toISOString(),
  options: EnqueueRecoveryOptions = {},
): Promise<Job> {
  const result = await repository.enqueueJob({
    type: "REFUND_CAMPAIGN",
    aggregateType: "CAMPAIGN",
    aggregateId: campaignId,
    deduplicationKey: `campaign-refund:${campaignId}:${reason.toLowerCase()}`,
    payload: { campaignId, fundingOrderId, reason },
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    runAfter,
    reactivateDead: options.reactivateDead,
  });
  return result.job;
}
