import { decodeEventLog, type Address } from "viem";
import { learningRewardsAbi } from "../../lib/base/escrow-abi";
import type { FinalizedCampaignState } from "./issuer";
import { chainFailure, chainInteger, type BaseDeployment, type ChainBlock, type EscrowLog, type EscrowTotals } from "./chain-reader";

export type CampaignAccounting = Omit<FinalizedCampaignState, "blockHash" | "blockNumber" | "blockTimestamp" | "observedAt">;
export interface BlockEvents { block: ChainBlock; logs: EscrowLog[] }
export function accountingJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
}
function check(value: unknown): asserts value { if (!value) chainFailure("BASE_RECONCILIATION_MISMATCH"); }
function nonzero(value: string) { return BigInt(value) !== 0n; }
function normalized(value: Address) { return value.toLowerCase() as Address; }

export function projectEscrowEvents(deployment: BaseDeployment, blocks: BlockEvents[]) {
  const campaigns = new Map<string, CampaignAccounting>();
  const slots = new Set<string>();
  const participants = new Set<string>();
  const transactions = new Map<string, string>();
  let previousBlock: ChainBlock | undefined;
  for (const { block, logs } of blocks) {
    check(block.number >= deployment.deploymentBlock);
    if (block.number === deployment.deploymentBlock) check(block.hash === deployment.deploymentBlockHash);
    if (previousBlock) check(block.number > previousBlock.number && block.timestamp >= previousBlock.timestamp);
    previousBlock = block;
    let previousIndex = -1; let previousTransaction = -1;
    for (const log of logs) {
      check(log.blockHash === block.hash && log.blockNumber === block.number && log.logIndex > previousIndex && log.transactionIndex >= previousTransaction);
      previousIndex = log.logIndex; previousTransaction = log.transactionIndex;
      check(!transactions.has(log.transactionHash) || transactions.get(log.transactionHash) === block.hash);
      transactions.set(log.transactionHash, block.hash);
      let event;
      try { event = decodeEventLog({ abi: learningRewardsAbi, data: log.data, topics: log.topics, strict: true }); }
      catch { chainFailure("BASE_RECONCILIATION_MISMATCH"); }
      const args = event.args;
      const key = args.campaignId.toString();
      if (event.eventName === "CampaignFunded") {
        const { terms, sponsor, token, fundedAtomic, signerEpoch } = event.args;
        check(event.args.campaignId === BigInt(campaigns.size) + 1n && campaigns.size < 1000 && !campaigns.has(key));
        check(nonzero(sponsor) && normalized(token) === deployment.token && nonzero(terms.eligibilitySigner) && nonzero(terms.termsHash));
        check(terms.rewardAtomic > 0n && terms.maxClaims > 0 && fundedAtomic === terms.rewardAtomic * BigInt(terms.maxClaims) && signerEpoch === 1n);
        const startsAt = chainInteger(terms.startsAt); const endsAt = chainInteger(terms.endsAt); const claimDeadline = chainInteger(terms.claimDeadline);
        check(startsAt >= block.timestamp && endsAt > startsAt && claimDeadline > endsAt);
        campaigns.set(key, {
          chainId: deployment.chainId, escrow: deployment.escrow, onChainId: event.args.campaignId,
          sponsor: normalized(sponsor), token: normalized(token), rewardAtomic: terms.rewardAtomic, maxClaims: terms.maxClaims,
          startsAt, endsAt, claimDeadline, termsHash: terms.termsHash, fundedAtomic, outstandingAtomic: fundedAtomic,
          refundedAtomic: 0n, paidCount: 0, signer: normalized(terms.eligibilitySigner), signerEpoch, paused: false, closed: false,
        });
        continue;
      }
      const campaign = campaigns.get(key);
      check(campaign && !campaign.closed);
      if (event.eventName === "RewardPaid") {
        const { slot, participantId, recipient, amount } = event.args;
        check(!campaign.paused && block.timestamp >= campaign.startsAt && block.timestamp <= campaign.claimDeadline);
        check(slot < campaign.maxClaims && nonzero(participantId) && nonzero(recipient) && normalized(recipient) !== deployment.escrow && amount === campaign.rewardAtomic);
        check(!slots.has(`${key}:${slot}`) && !participants.has(`${key}:${participantId}`));
        slots.add(`${key}:${slot}`); participants.add(`${key}:${participantId}`);
        campaign.paidCount++; campaign.outstandingAtomic -= amount;
      } else if (event.eventName === "CampaignPauseChanged") {
        campaign.paused = event.args.paused;
      } else if (event.eventName === "EligibilitySignerChanged") {
        check(normalized(event.args.previousSigner) === campaign.signer && event.args.signerEpoch === campaign.signerEpoch + 1n && nonzero(event.args.newSigner));
        campaign.signer = normalized(event.args.newSigner); campaign.signerEpoch = event.args.signerEpoch;
      } else if (event.eventName === "CampaignRefunded") {
        const { sponsor, amount, reason } = event.args;
        check(normalized(sponsor) === campaign.sponsor && amount === campaign.outstandingAtomic);
        check((reason === 0 && block.timestamp < campaign.startsAt && campaign.paidCount === 0) || (reason === 1 && block.timestamp > campaign.claimDeadline));
        campaign.refundedAtomic += amount; campaign.outstandingAtomic = 0n; campaign.closed = true;
      }
      check(campaign.paidCount <= campaign.maxClaims && campaign.outstandingAtomic >= 0n &&
        campaign.fundedAtomic === campaign.outstandingAtomic + campaign.refundedAtomic + BigInt(campaign.paidCount) * campaign.rewardAtomic);
    }
  }
  return campaigns;
}

export function reconcileCampaign(expected: CampaignAccounting, actual: FinalizedCampaignState, block: ChainBlock) {
  check(actual.blockHash === block.hash && actual.blockNumber === block.number && actual.blockTimestamp === block.timestamp);
  for (const key of Object.keys(expected) as Array<keyof CampaignAccounting>) check(expected[key] === actual[key]);
}
export function reconcileTotals(campaigns: Map<string, CampaignAccounting>, totals: EscrowTotals) {
  const reserved = [...campaigns.values()].reduce((sum, state) => sum + state.outstandingAtomic, 0n);
  check(totals.campaignCount === BigInt(campaigns.size) && totals.totalReserved === reserved && totals.balance >= reserved);
  return { fundedAtomic: [...campaigns.values()].reduce((sum, state) => sum + state.fundedAtomic, 0n), reservedAtomic: reserved, surplusAtomic: totals.balance - reserved };
}
