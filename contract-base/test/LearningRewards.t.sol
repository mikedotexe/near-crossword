// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {stdError} from "forge-std/StdError.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {LearningRewards} from "../src/LearningRewards.sol";
import {TestUSDC, TestIssuer} from "./Fixtures.sol";

contract LearningRewardsTest is Test {
    uint256 constant ISSUER_KEY = 0xA11CE; // Public, test-only signing key.
    uint256 constant REWARD = 100_000;
    TestUSDC token;
    LearningRewards rewards;
    address issuer;
    address recipient;

    function setUp() public {
        vm.warp(1000);
        vm.chainId(8453);
        issuer = vm.addr(ISSUER_KEY);
        recipient = makeAddr("recipient");
        token = new TestUSDC();
        rewards = new LearningRewards(token);
        token.mint(address(this), 1_000_000_000);
        token.approve(address(rewards), type(uint256).max);
    }

    function terms(uint32 count) internal view returns (LearningRewards.CampaignTerms memory) {
        return LearningRewards.CampaignTerms(REWARD, count, 1001, 2000, 3000, keccak256("public terms"), issuer);
    }

    function fund(uint32 count) internal returns (uint256) {
        return rewards.createCampaign(terms(count));
    }

    function permit(uint256 id, uint32 slot) internal view returns (LearningRewards.Claim memory) {
        return LearningRewards.Claim(id, slot, bytes32(uint256(slot) + 1), recipient, REWARD, 3000, 1);
    }

    function sign(LearningRewards.Claim memory p) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ISSUER_KEY, rewards.claimDigest(p));
        return abi.encodePacked(r, s, v);
    }

    function redeem(uint256 id, uint32 slot) internal {
        LearningRewards.Claim memory p = permit(id, slot);
        rewards.claim(p, sign(p));
    }

    function testFundingReservesExactPrincipalAndIgnoresDonation() public {
        token.transfer(address(rewards), 777);
        uint256 id = fund(3);
        LearningRewards.Campaign memory c = rewards.getCampaign(id);
        assertEq(id, 1);
        assertEq(c.sponsor, address(this));
        assertEq(c.fundedAtomic, REWARD * 3);
        assertEq(c.signerEpoch, 1);
        assertEq(rewards.totalReserved(), REWARD * 3);
        assertEq(rewards.outstanding(id), REWARD * 3);
        assertEq(token.balanceOf(address(rewards)), REWARD * 3 + 777);
    }

    function testEventsReconstructFundingPaymentAndRefund() public {
        vm.recordLogs();
        uint256 id = fund(3);
        vm.warp(1001);
        redeem(id, 0);
        vm.warp(3001);
        rewards.refundExpired(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 contractEvents;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(rewards)) continue;
            assertEq(logs[i].topics[1], bytes32(id));
            if (contractEvents == 0) {
                assertEq(
                    logs[i].topics[0],
                    keccak256(
                        "CampaignFunded(uint256,address,address,(uint256,uint32,uint64,uint64,uint64,bytes32,address),uint256,uint64)"
                    )
                );
                assertEq(logs[i].topics[2], bytes32(uint256(uint160(address(this)))));
                assertEq(logs[i].data, abi.encode(address(token), terms(3), REWARD * 3, uint64(1)));
            } else if (contractEvents == 1) {
                assertEq(logs[i].topics[0], keccak256("RewardPaid(uint256,uint32,bytes32,address,uint256)"));
                assertEq(logs[i].topics[2], bytes32(0));
                assertEq(logs[i].topics[3], bytes32(uint256(1)));
                assertEq(logs[i].data, abi.encode(recipient, REWARD));
            } else {
                assertEq(logs[i].topics[0], keccak256("CampaignRefunded(uint256,address,uint256,uint8)"));
                assertEq(logs[i].data, abi.encode(REWARD * 2, LearningRewards.RefundReason.Expired));
            }
            contractEvents += 1;
        }
        assertEq(contractEvents, 3);
        assertEq(rewards.totalReserved(), 0);
    }

    function testRejectsTokenWithoutCode() public {
        vm.expectRevert(LearningRewards.InvalidToken.selector);
        new LearningRewards(IERC20(address(0)));
    }

    function testRejectsFeeOnTransferFundingAtomically() public {
        token.setFee(true);
        vm.expectRevert(LearningRewards.FundingMismatch.selector);
        fund(3);
        assertEq(rewards.campaignCount(), 0);
        assertEq(rewards.totalReserved(), 0);
        assertEq(token.balanceOf(address(rewards)), 0);
    }

    function testRejectsFalseReturnFunding() public {
        token.setFailure(true);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        fund(3);
        assertEq(rewards.campaignCount(), 0);
    }

    function testRejectsInvalidTerms() public {
        for (uint256 i; i < 7; ++i) {
            LearningRewards.CampaignTerms memory t = terms(3);
            if (i == 0) t.rewardAtomic = 0;
            if (i == 1) t.maxClaims = 0;
            if (i == 2) t.startsAt = 999;
            if (i == 3) t.endsAt = t.startsAt;
            if (i == 4) t.claimDeadline = t.endsAt;
            if (i == 5) t.termsHash = bytes32(0);
            if (i == 6) t.eligibilitySigner = address(0);
            vm.expectRevert(LearningRewards.InvalidTerms.selector);
            rewards.createCampaign(t);
        }
    }

    function testFundingOverflowReverts() public {
        LearningRewards.CampaignTerms memory t = terms(2);
        t.rewardAtomic = type(uint256).max;
        vm.expectRevert(stdError.arithmeticError);
        rewards.createCampaign(t);
    }

    function testMultipleRelayedClaimsPayOnlyNamedRecipient() public {
        uint256 id = fund(3);
        vm.warp(1001);
        for (uint32 slot; slot < 3; ++slot) {
            LearningRewards.Claim memory p = permit(id, slot);
            bytes memory signature = sign(p);
            vm.prank(makeAddr("relayer"));
            rewards.claim(p, signature);
        }
        assertEq(token.balanceOf(recipient), REWARD * 3);
        assertEq(token.balanceOf(makeAddr("relayer")), 0);
        assertEq(rewards.totalReserved(), 0);
        assertEq(rewards.getCampaign(id).paidCount, 3);
    }

    function testSlotAndParticipantReplayAreIndependent() public {
        uint256 id = fund(3);
        vm.warp(1001);
        redeem(id, 0);
        LearningRewards.Claim memory p = permit(id, 0);
        p.participantId = bytes32(uint256(99));
        bytes memory signature = sign(p);
        vm.expectRevert(LearningRewards.AlreadyClaimed.selector);
        rewards.claim(p, signature);
        p = permit(id, 1);
        p.participantId = bytes32(uint256(1));
        signature = sign(p);
        vm.expectRevert(LearningRewards.AlreadyClaimed.selector);
        rewards.claim(p, signature);
    }

    function testRejectsMalformedClaimFields() public {
        uint256 id = fund(3);
        vm.warp(1001);
        for (uint256 i; i < 6; ++i) {
            LearningRewards.Claim memory p = permit(id, 0);
            if (i == 0) p.slot = 3;
            if (i == 1) p.participantId = bytes32(0);
            if (i == 2) p.recipient = address(0);
            if (i == 3) p.recipient = address(rewards);
            if (i == 4) p.amount += 1;
            if (i == 5) p.signerEpoch = 0;
            bytes memory signature = sign(p);
            vm.expectRevert(LearningRewards.InvalidClaim.selector);
            rewards.claim(p, signature);
        }
    }

    function testSignatureBindsAllOtherwiseValidFields() public {
        uint256 id = fund(3);
        fund(3);
        vm.warp(1001);
        bytes memory signature = sign(permit(id, 0));
        for (uint256 i; i < 5; ++i) {
            LearningRewards.Claim memory p = permit(id, 0);
            if (i == 0) p.recipient = makeAddr("other recipient");
            if (i == 1) p.slot = 1;
            if (i == 2) p.participantId = bytes32(uint256(99));
            if (i == 3) p.deadline = 2999;
            if (i == 4) p.campaignId = 2;
            vm.expectRevert(LearningRewards.InvalidSignature.selector);
            rewards.claim(p, signature);
        }
    }

    function testSignatureCannotCrossChainsOrDeployments() public {
        uint256 id = fund(3);
        LearningRewards.Claim memory p = permit(id, 0);
        bytes memory signature = sign(p);
        LearningRewards other = new LearningRewards(token);
        token.approve(address(other), type(uint256).max);
        other.createCampaign(terms(3));
        vm.warp(1001);
        vm.expectRevert(LearningRewards.InvalidSignature.selector);
        other.claim(p, signature);
        vm.chainId(84532);
        vm.expectRevert(LearningRewards.InvalidSignature.selector);
        rewards.claim(p, signature);
    }

    function testClaimWindowBoundariesAndGrace() public {
        uint256 id = fund(3);
        LearningRewards.Claim memory p = permit(id, 0);
        bytes memory signature = sign(p);
        vm.expectRevert(LearningRewards.OutsideClaimWindow.selector);
        rewards.claim(p, signature);
        vm.warp(1001);
        redeem(id, 0);
        vm.warp(2000);
        redeem(id, 1);
        vm.warp(3000);
        redeem(id, 2);
        assertEq(rewards.getCampaign(id).paidCount, 3);
    }

    function testRejectsExpiredOrOverlongPermit() public {
        uint256 id = fund(3);
        LearningRewards.Claim memory p = permit(id, 0);
        p.deadline = 3001;
        bytes memory signature = sign(p);
        vm.warp(1001);
        vm.expectRevert(LearningRewards.OutsideClaimWindow.selector);
        rewards.claim(p, signature);
        p.deadline = 1500;
        signature = sign(p);
        vm.warp(1501);
        vm.expectRevert(LearningRewards.OutsideClaimWindow.selector);
        rewards.claim(p, signature);
    }

    function testRotationRevokesOldEpochAndCannotReviveIt() public {
        uint256 id = fund(3);
        LearningRewards.Claim memory p = permit(id, 0);
        bytes memory oldSignature = sign(p);
        rewards.rotateSigner(id, makeAddr("new signer"));
        rewards.rotateSigner(id, issuer);
        vm.warp(1001);
        vm.expectRevert(LearningRewards.InvalidClaim.selector);
        rewards.claim(p, oldSignature);
        p.signerEpoch = 3;
        rewards.claim(p, sign(p));
        rewards.rotateSigner(id, issuer);
        p.signerEpoch = 4;
        bytes memory replacement = sign(p);
        vm.expectRevert(LearningRewards.AlreadyClaimed.selector);
        rewards.claim(p, replacement);
    }

    function testOnlySponsorCanControlCampaign() public {
        uint256 id = fund(3);
        address other = makeAddr("other");
        vm.startPrank(other);
        vm.expectRevert(LearningRewards.Unauthorized.selector);
        rewards.setPaused(id, true);
        vm.expectRevert(LearningRewards.Unauthorized.selector);
        rewards.rotateSigner(id, other);
        vm.expectRevert(LearningRewards.Unauthorized.selector);
        rewards.cancelCampaign(id);
        vm.stopPrank();
        vm.expectRevert(LearningRewards.InvalidTerms.selector);
        rewards.rotateSigner(id, address(0));
    }

    function testPausedClaimsResumeAndCannotRefundEarly() public {
        uint256 id = fund(3);
        rewards.setPaused(id, true);
        LearningRewards.Claim memory p = permit(id, 0);
        bytes memory signature = sign(p);
        vm.warp(1001);
        vm.expectRevert(LearningRewards.CampaignPaused.selector);
        rewards.claim(p, signature);
        vm.expectRevert(LearningRewards.RefundUnavailable.selector);
        rewards.refundExpired(id);
        rewards.setPaused(id, false);
        rewards.claim(p, signature);
    }

    function testExpiredRefundIsPermissionlessEvenPausedAndCannotRepeat() public {
        uint256 id = fund(3);
        vm.warp(1001);
        redeem(id, 0);
        rewards.setPaused(id, true);
        vm.warp(3000);
        vm.expectRevert(LearningRewards.RefundUnavailable.selector);
        rewards.refundExpired(id);
        vm.warp(3001);
        uint256 beforeBalance = token.balanceOf(address(this));
        vm.prank(makeAddr("refund relayer"));
        rewards.refundExpired(id);
        assertEq(token.balanceOf(address(this)) - beforeBalance, REWARD * 2);
        assertEq(rewards.outstanding(id), 0);
        assertEq(rewards.getCampaign(id).refundedAtomic, REWARD * 2);
        vm.expectRevert(LearningRewards.CampaignClosed.selector);
        rewards.refundExpired(id);
    }

    function testCancellationClosesAllAuthorizationsAndRestoresFunds() public {
        uint256 id = fund(3);
        LearningRewards.Claim memory p = permit(id, 0);
        bytes memory signature = sign(p);
        rewards.cancelCampaign(id);
        assertEq(token.balanceOf(address(this)), 1_000_000_000);
        assertEq(rewards.totalReserved(), 0);
        vm.warp(1001);
        vm.expectRevert(LearningRewards.CampaignClosed.selector);
        rewards.claim(p, signature);
        vm.expectRevert(LearningRewards.CampaignClosed.selector);
        rewards.cancelCampaign(id);
    }

    function testCannotCancelAtStart() public {
        uint256 id = fund(3);
        vm.warp(1001);
        vm.expectRevert(LearningRewards.RefundUnavailable.selector);
        rewards.cancelCampaign(id);
    }

    function testClaimTransferFailureRollsBackAndCanRetry() public {
        uint256 id = fund(3);
        vm.warp(1001);
        token.setFailure(true);
        LearningRewards.Claim memory p = permit(id, 0);
        bytes memory signature = sign(p);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        rewards.claim(p, signature);
        assertFalse(rewards.usedSlots(id, 0));
        assertFalse(rewards.claimedParticipants(id, p.participantId));
        assertEq(rewards.getCampaign(id).paidCount, 0);
        assertEq(rewards.totalReserved(), REWARD * 3);
        token.setFailure(false);
        rewards.claim(p, signature);
    }

    function testRefundTransferFailureRollsBackAndCanRetry() public {
        uint256 id = fund(3);
        vm.warp(3001);
        token.setFailure(true);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        rewards.refundExpired(id);
        assertFalse(rewards.getCampaign(id).closed);
        assertEq(rewards.getCampaign(id).refundedAtomic, 0);
        assertEq(rewards.totalReserved(), REWARD * 3);
        token.setFailure(false);
        rewards.refundExpired(id);
    }

    function testZeroRemainderClosesWithoutTokenTransfer() public {
        uint256 id = fund(1);
        vm.warp(1001);
        redeem(id, 0);
        token.setFailure(true);
        vm.warp(3001);
        rewards.refundExpired(id);
        assertTrue(rewards.getCampaign(id).closed);
        assertEq(rewards.getCampaign(id).refundedAtomic, 0);
    }

    function testSupportsDeployed1271IssuerAndRevocation() public {
        TestIssuer smartIssuer = new TestIssuer(issuer);
        LearningRewards.CampaignTerms memory t = terms(3);
        t.eligibilitySigner = address(smartIssuer);
        uint256 id = rewards.createCampaign(t);
        vm.warp(1001);
        redeem(id, 0);
        smartIssuer.setRevoked(true);
        LearningRewards.Claim memory p = permit(id, 1);
        bytes memory signature = sign(p);
        vm.expectRevert(LearningRewards.InvalidSignature.selector);
        rewards.claim(p, signature);
    }

    function testMaliciousTokenCannotReenterClaim() public {
        uint256 id = fund(3);
        vm.warp(1001);
        LearningRewards.Claim memory p = permit(id, 1);
        token.setCallback(address(rewards), abi.encodeCall(rewards.claim, (p, sign(p))));
        redeem(id, 0);
        assertFalse(token.callbackSucceeded());
        assertEq(bytes4(token.callbackResult()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(rewards.getCampaign(id).paidCount, 1);
        assertFalse(rewards.usedSlots(id, 1));
    }

    function testRejectsUnknownCampaign() public {
        vm.expectRevert(LearningRewards.UnknownCampaign.selector);
        rewards.getCampaign(1);
        vm.expectRevert(LearningRewards.UnknownCampaign.selector);
        rewards.refundExpired(1);
    }

    function testTypeScriptSignatureFixture() public {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/claim-v1.json"));
        address fixtureContract = vm.parseJsonAddress(json, ".contract");
        vm.chainId(vm.parseJsonUint(json, ".chainId"));
        vm.etch(fixtureContract, address(rewards).code);
        LearningRewards.Claim memory p = LearningRewards.Claim(
            vm.parseUint(vm.parseJsonString(json, ".claim.campaignId")),
            uint32(vm.parseJsonUint(json, ".claim.slot")),
            vm.parseJsonBytes32(json, ".claim.participantId"),
            vm.parseJsonAddress(json, ".claim.recipient"),
            vm.parseUint(vm.parseJsonString(json, ".claim.amount")),
            uint64(vm.parseUint(vm.parseJsonString(json, ".claim.deadline"))),
            uint64(vm.parseUint(vm.parseJsonString(json, ".claim.signerEpoch")))
        );
        bytes32 digest = LearningRewards(fixtureContract).claimDigest(p);
        assertEq(digest, vm.parseJsonBytes32(json, ".digest"));
        assertEq(ECDSA.recover(digest, vm.parseJsonBytes(json, ".signature")), vm.parseJsonAddress(json, ".signer"));
    }

    function testFuzzExhaustionPreservesOtherCampaign(uint8 rawCount, uint8 rawSlot) public {
        uint32 count = uint32(bound(rawCount, 1, 20));
        uint256 first = fund(count);
        uint256 second = fund(2);
        vm.warp(1001);
        for (uint32 slot; slot < count; ++slot) {
            redeem(first, slot);
        }
        uint32 duplicate = uint32(bound(rawSlot, 0, count - 1));
        LearningRewards.Claim memory p = permit(first, duplicate);
        bytes memory signature = sign(p);
        vm.expectRevert(LearningRewards.AlreadyClaimed.selector);
        rewards.claim(p, signature);
        p = permit(first, count);
        signature = sign(p);
        vm.expectRevert(LearningRewards.InvalidClaim.selector);
        rewards.claim(p, signature);
        assertEq(rewards.outstanding(second), REWARD * 2);
        assertEq(rewards.totalReserved(), REWARD * 2);
        assertEq(token.balanceOf(address(rewards)), REWARD * 2);
    }
}
