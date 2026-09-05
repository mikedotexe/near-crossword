import { parseAbi } from "viem";

// Keep tuples and event signatures in conformance with contract-base/src/LearningRewards.sol.
export const learningRewardsAbi = parseAbi([
  "struct CampaignTerms { uint256 rewardAtomic; uint32 maxClaims; uint64 startsAt; uint64 endsAt; uint64 claimDeadline; bytes32 termsHash; address eligibilitySigner; }",
  "struct Campaign { address sponsor; CampaignTerms terms; uint256 fundedAtomic; uint256 refundedAtomic; uint64 signerEpoch; uint32 paidCount; bool paused; bool closed; }",
  "function token() view returns (address)",
  "function totalReserved() view returns (uint256)",
  "function campaignCount() view returns (uint256)",
  "function getCampaign(uint256 campaignId) view returns (Campaign)",
  "function outstanding(uint256 campaignId) view returns (uint256)",
  "function usedSlots(uint256 campaignId, uint32 slot) view returns (bool)",
  "function claimedParticipants(uint256 campaignId, bytes32 participantId) view returns (bool)",
  "event CampaignFunded(uint256 indexed campaignId, address indexed sponsor, address token, CampaignTerms terms, uint256 fundedAtomic, uint64 signerEpoch)",
  "event RewardPaid(uint256 indexed campaignId, uint32 indexed slot, bytes32 indexed participantId, address recipient, uint256 amount)",
  "event CampaignPauseChanged(uint256 indexed campaignId, bool paused)",
  "event EligibilitySignerChanged(uint256 indexed campaignId, address previousSigner, address newSigner, uint64 signerEpoch)",
  "event CampaignRefunded(uint256 indexed campaignId, address indexed sponsor, uint256 amount, uint8 reason)",
]);

export const baseNativeUsdc = {
  8453: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  84532: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
} as const;
