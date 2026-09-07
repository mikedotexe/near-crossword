// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Prefunded fixed rewards. The issuer attests eligibility, not this contract.
contract LearningRewards is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct CampaignTerms {
        uint256 rewardAtomic;
        uint32 maxClaims;
        uint64 startsAt;
        uint64 endsAt;
        uint64 claimDeadline;
        bytes32 termsHash;
        address eligibilitySigner;
    }

    struct Campaign {
        address sponsor;
        CampaignTerms terms;
        uint256 fundedAtomic;
        uint256 refundedAtomic;
        uint64 signerEpoch;
        uint32 paidCount;
        bool paused;
        bool closed;
    }

    struct Claim {
        uint256 campaignId;
        uint32 slot;
        bytes32 participantId;
        address recipient;
        uint256 amount;
        uint64 deadline;
        uint64 signerEpoch;
    }

    enum RefundReason {
        Cancelled,
        Expired
    }

    error InvalidToken();
    error InvalidTerms();
    error FundingMismatch();
    error UnknownCampaign();
    error Unauthorized();
    error CampaignClosed();
    error CampaignPaused();
    error OutsideClaimWindow();
    error InvalidClaim();
    error InvalidSignature();
    error AlreadyClaimed();
    error RefundUnavailable();

    event CampaignFunded(
        uint256 indexed campaignId,
        address indexed sponsor,
        address token,
        CampaignTerms terms,
        uint256 fundedAtomic,
        uint64 signerEpoch
    );
    event RewardPaid(
        uint256 indexed campaignId,
        uint32 indexed slot,
        bytes32 indexed participantId,
        address recipient,
        uint256 amount
    );
    event CampaignPauseChanged(uint256 indexed campaignId, bool paused);
    event EligibilitySignerChanged(
        uint256 indexed campaignId, address previousSigner, address newSigner, uint64 signerEpoch
    );
    event CampaignRefunded(uint256 indexed campaignId, address indexed sponsor, uint256 amount, RefundReason reason);

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "Claim(uint256 campaignId,uint32 slot,bytes32 participantId,address recipient,uint256 amount,uint64 deadline,uint64 signerEpoch)"
    );

    IERC20 public immutable token;
    uint256 public totalReserved;
    uint256 public campaignCount;
    mapping(uint256 => Campaign) private campaigns;
    mapping(uint256 => mapping(uint32 => bool)) public usedSlots;
    mapping(uint256 => mapping(bytes32 => bool)) public claimedParticipants;

    constructor(IERC20 token_) EIP712("Crossword Learning Rewards", "1") {
        if (address(token_).code.length == 0) revert InvalidToken();
        token = token_;
    }

    function createCampaign(CampaignTerms calldata terms) external nonReentrant returns (uint256 campaignId) {
        if (
            terms.rewardAtomic == 0 || terms.maxClaims == 0 || terms.startsAt < block.timestamp
                || terms.endsAt <= terms.startsAt || terms.claimDeadline <= terms.endsAt
                || terms.termsHash == bytes32(0) || terms.eligibilitySigner == address(0)
        ) revert InvalidTerms();
        uint256 principal = terms.rewardAtomic * terms.maxClaims;
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), principal);
        if (token.balanceOf(address(this)) != beforeBalance + principal) revert FundingMismatch();

        campaignId = ++campaignCount;
        Campaign storage campaign = campaigns[campaignId];
        campaign.sponsor = msg.sender;
        campaign.terms = terms;
        campaign.fundedAtomic = principal;
        campaign.signerEpoch = 1;
        totalReserved += principal;
        emit CampaignFunded(campaignId, msg.sender, address(token), terms, principal, 1);
    }

    function claim(Claim calldata authorization, bytes calldata signature) external nonReentrant {
        Campaign storage campaign = _openCampaign(authorization.campaignId);
        if (campaign.paused) revert CampaignPaused();
        if (
            block.timestamp < campaign.terms.startsAt || block.timestamp > authorization.deadline
                || authorization.deadline > campaign.terms.claimDeadline
        ) revert OutsideClaimWindow();
        if (
            authorization.slot >= campaign.terms.maxClaims || authorization.participantId == bytes32(0)
                || authorization.recipient == address(0) || authorization.recipient == address(this)
                || authorization.amount != campaign.terms.rewardAtomic
                || authorization.signerEpoch != campaign.signerEpoch
        ) revert InvalidClaim();
        if (
            usedSlots[authorization.campaignId][authorization.slot]
                || claimedParticipants[authorization.campaignId][authorization.participantId]
        ) revert AlreadyClaimed();
        if (!SignatureChecker.isValidSignatureNow(
                campaign.terms.eligibilitySigner, claimDigest(authorization), signature
            )) {
            revert InvalidSignature();
        }

        // In-range unused slots cap paidCount, even if an issuer signs conflicting authorizations.
        usedSlots[authorization.campaignId][authorization.slot] = true;
        claimedParticipants[authorization.campaignId][authorization.participantId] = true;
        campaign.paidCount += 1;
        totalReserved -= authorization.amount;
        token.safeTransfer(authorization.recipient, authorization.amount);
        emit RewardPaid(
            authorization.campaignId,
            authorization.slot,
            authorization.participantId,
            authorization.recipient,
            authorization.amount
        );
    }

    function setPaused(uint256 campaignId, bool paused) external nonReentrant {
        Campaign storage campaign = _controlledCampaign(campaignId);
        campaign.paused = paused;
        emit CampaignPauseChanged(campaignId, paused);
    }

    function rotateSigner(uint256 campaignId, address signer) external nonReentrant {
        Campaign storage campaign = _controlledCampaign(campaignId);
        if (signer == address(0)) revert InvalidTerms();
        address previousSigner = campaign.terms.eligibilitySigner;
        campaign.terms.eligibilitySigner = signer;
        campaign.signerEpoch += 1;
        emit EligibilitySignerChanged(campaignId, previousSigner, signer, campaign.signerEpoch);
    }

    function cancelCampaign(uint256 campaignId) external nonReentrant {
        Campaign storage campaign = _controlledCampaign(campaignId);
        if (block.timestamp >= campaign.terms.startsAt || campaign.paidCount != 0) revert RefundUnavailable();
        _refund(campaignId, campaign, RefundReason.Cancelled);
    }

    function refundExpired(uint256 campaignId) external nonReentrant {
        Campaign storage campaign = _openCampaign(campaignId);
        if (block.timestamp <= campaign.terms.claimDeadline) revert RefundUnavailable();
        _refund(campaignId, campaign, RefundReason.Expired);
    }

    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        return _campaign(campaignId);
    }

    function outstanding(uint256 campaignId) external view returns (uint256) {
        return _outstanding(_campaign(campaignId));
    }

    function claimDigest(Claim calldata authorization) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CLAIM_TYPEHASH,
                    authorization.campaignId,
                    authorization.slot,
                    authorization.participantId,
                    authorization.recipient,
                    authorization.amount,
                    authorization.deadline,
                    authorization.signerEpoch
                )
            )
        );
    }

    function _campaign(uint256 campaignId) private view returns (Campaign storage campaign) {
        campaign = campaigns[campaignId];
        if (campaign.sponsor == address(0)) revert UnknownCampaign();
    }

    function _openCampaign(uint256 campaignId) private view returns (Campaign storage campaign) {
        campaign = _campaign(campaignId);
        if (campaign.closed) revert CampaignClosed();
    }

    function _controlledCampaign(uint256 campaignId) private view returns (Campaign storage campaign) {
        campaign = _openCampaign(campaignId);
        if (campaign.sponsor != msg.sender) revert Unauthorized();
    }

    function _outstanding(Campaign storage campaign) private view returns (uint256) {
        return
            campaign.fundedAtomic - uint256(campaign.paidCount) * campaign.terms.rewardAtomic - campaign.refundedAtomic;
    }

    function _refund(uint256 campaignId, Campaign storage campaign, RefundReason reason) private {
        uint256 amount = _outstanding(campaign);
        campaign.closed = true;
        campaign.refundedAtomic += amount;
        totalReserved -= amount;
        if (amount != 0) token.safeTransfer(campaign.sponsor, amount);
        emit CampaignRefunded(campaignId, campaign.sponsor, amount, reason);
    }
}
