// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {LearningRewards} from "../src/LearningRewards.sol";
import {TestUSDC} from "./Fixtures.sol";

contract RewardsHandler is Test {
    uint256 constant ISSUER_KEY = 0xA11CE;
    address public constant RECIPIENT = address(0xBEEF);
    LearningRewards public immutable rewards;
    TestUSDC public immutable token;
    uint256 public funded;
    uint256 public paid;
    uint256 public refunded;
    uint256 public donations;

    constructor(LearningRewards rewards_, TestUSDC token_) {
        rewards = rewards_;
        token = token_;
        token.approve(address(rewards), type(uint256).max);
    }

    function fund(uint96 amountSeed, uint8 countSeed) external {
        if (rewards.campaignCount() >= 16) return;
        uint256 reward = bound(amountSeed, 1, 1_000_000);
        uint32 count = uint32(bound(countSeed, 1, 12));
        uint64 start = uint64(block.timestamp + 10);
        token.mint(address(this), reward * count);
        rewards.createCampaign(
            LearningRewards.CampaignTerms(
                reward, count, start, start + 100, start + 200, keccak256("terms"), vm.addr(ISSUER_KEY)
            )
        );
        funded += reward * count;
    }

    function redeem(uint256 campaignSeed, uint32 slotSeed) external {
        uint256 count = rewards.campaignCount();
        if (count == 0) return;
        uint256 id = bound(campaignSeed, 1, count);
        LearningRewards.Campaign memory c = rewards.getCampaign(id);
        if (c.closed || c.paused || block.timestamp < c.terms.startsAt || block.timestamp > c.terms.claimDeadline) {
            return;
        }
        uint32 slot = uint32(bound(slotSeed, 0, c.terms.maxClaims - 1));
        if (rewards.usedSlots(id, slot)) return;
        LearningRewards.Claim memory p = LearningRewards.Claim(
            id, slot, bytes32(uint256(slot) + 1), RECIPIENT, c.terms.rewardAtomic, c.terms.claimDeadline, c.signerEpoch
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ISSUER_KEY, rewards.claimDigest(p));
        rewards.claim(p, abi.encodePacked(r, s, v));
        paid += p.amount;
    }

    function control(uint256 campaignSeed, bool paused, bool rotate) external {
        uint256 count = rewards.campaignCount();
        if (count == 0) return;
        uint256 id = bound(campaignSeed, 1, count);
        if (rewards.getCampaign(id).closed) return;
        rewards.setPaused(id, paused);
        if (rotate) rewards.rotateSigner(id, vm.addr(ISSUER_KEY));
    }

    function refund(uint256 campaignSeed) external {
        uint256 count = rewards.campaignCount();
        if (count == 0) return;
        uint256 id = bound(campaignSeed, 1, count);
        LearningRewards.Campaign memory c = rewards.getCampaign(id);
        if (c.closed) return;
        uint256 amount = rewards.outstanding(id);
        if (block.timestamp < c.terms.startsAt) rewards.cancelCampaign(id);
        else if (block.timestamp > c.terms.claimDeadline) rewards.refundExpired(id);
        else return;
        refunded += amount;
    }

    function advance(uint32 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1, 60));
    }

    function donate(uint96 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 1_000_000);
        token.mint(address(rewards), amount);
        donations += amount;
    }
}

contract LearningRewardsInvariantTest is StdInvariant, Test {
    LearningRewards rewards;
    TestUSDC token;
    RewardsHandler handler;

    function setUp() public {
        vm.warp(1000);
        token = new TestUSDC();
        rewards = new LearningRewards(token);
        handler = new RewardsHandler(rewards, token);
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = handler.fund.selector;
        selectors[1] = handler.redeem.selector;
        selectors[2] = handler.control.selector;
        selectors[3] = handler.refund.selector;
        selectors[4] = handler.advance.selector;
        selectors[5] = handler.donate.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariantCampaignsAndTokenBalanceReconcile() public view {
        uint256 outstandingSum;
        uint256 paidSum;
        uint256 refundedSum;
        for (uint256 id = 1; id <= rewards.campaignCount(); ++id) {
            LearningRewards.Campaign memory c = rewards.getCampaign(id);
            uint256 remaining = rewards.outstanding(id);
            uint256 paidAmount = uint256(c.paidCount) * c.terms.rewardAtomic;
            assertLe(c.paidCount, c.terms.maxClaims);
            assertEq(c.fundedAtomic, paidAmount + remaining + c.refundedAtomic);
            if (c.closed) assertEq(remaining, 0);
            uint256 used;
            for (uint32 slot; slot < c.terms.maxClaims; ++slot) {
                if (rewards.usedSlots(id, slot)) used += 1;
            }
            assertEq(used, c.paidCount);
            outstandingSum += remaining;
            paidSum += paidAmount;
            refundedSum += c.refundedAtomic;
        }
        assertEq(rewards.totalReserved(), outstandingSum);
        assertEq(handler.paid(), paidSum);
        assertEq(handler.refunded(), refundedSum);
        assertEq(handler.funded(), outstandingSum + paidSum + refundedSum);
        assertEq(token.balanceOf(address(rewards)), outstandingSum + handler.donations());
        assertEq(token.balanceOf(handler.RECIPIENT()), paidSum);
    }
}
