// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {LongtailVault} from "../src/LongtailVault.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract LongtailVaultTest is Test {
    MockUSDC usdc;
    LongtailVault vault;
    address owner = address(0xA11CE);
    address keeper = address(0xBEEF);
    address fees = address(0xFEE);
    address venue = address(0x7E7E);
    address alice = address(0x1);
    address bob = address(0x2);

    uint256 constant USD = 1e6;

    function setUp() public {
        usdc = new MockUSDC();
        vault = new LongtailVault(usdc, owner, keeper, fees, 1_000_000 * USD);
        vm.prank(owner);
        vault.setVenueAccount(venue, true);
        for (uint256 i = 0; i < 2; i++) {
            address u = i == 0 ? alice : bob;
            usdc.mint(u, 100_000 * USD);
            vm.prank(u);
            usdc.approve(address(vault), type(uint256).max);
        }
        vm.prank(venue);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _deposit(address u, uint256 amt) internal returns (uint256) {
        vm.prank(u);
        return vault.deposit(amt, u);
    }

    function test_depositAndRedeemRoundTrip() public {
        uint256 shares = _deposit(alice, 10_000 * USD);
        assertEq(vault.totalAssets(), 10_000 * USD);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);
        assertEq(out, 10_000 * USD);
    }

    function test_deployOnlyToVenueAndOnlyByKeeper() public {
        _deposit(alice, 10_000 * USD);
        vm.expectRevert(LongtailVault.NotKeeper.selector);
        vault.deploy(venue, 1_000 * USD);
        vm.prank(keeper);
        vm.expectRevert(LongtailVault.NotVenueAccount.selector);
        vault.deploy(address(0xBAD), 1_000 * USD);
        vm.prank(keeper);
        vault.deploy(venue, 6_000 * USD);
        assertEq(usdc.balanceOf(venue), 6_000 * USD);
        assertEq(vault.totalAssets(), 10_000 * USD, "NAV unchanged by deployment");
    }

    function test_withdrawalsLimitedToIdle() public {
        _deposit(alice, 10_000 * USD);
        vm.prank(keeper);
        vault.deploy(venue, 8_000 * USD);
        assertEq(vault.maxWithdraw(alice), 2_000 * USD);
        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(3_000 * USD, alice, alice);
    }

    function test_navReportIsRateLimitedAndBounded() public {
        _deposit(alice, 10_000 * USD);
        vm.prank(keeper);
        vault.deploy(venue, 5_000 * USD);
        vm.prank(keeper);
        vm.expectRevert(LongtailVault.ReportTooSoon.selector);
        vault.reportNav(5_100 * USD, bytes32(0), "");
        vm.warp(block.timestamp + 11 minutes);
        // 5% of 10k = 500 max move per report
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(LongtailVault.NavChangeTooLarge.selector, 5_000 * USD, 5_600 * USD));
        vault.reportNav(5_600 * USD, bytes32(0), "");
        vm.prank(keeper);
        vault.reportNav(5_400 * USD, keccak256("snap"), "ipfs://snap");
        assertEq(vault.lastSnapshotHash(), keccak256("snap"));
    }

    function test_staleNavBlocksFlows() public {
        _deposit(alice, 10_000 * USD);
        vm.prank(keeper);
        vault.deploy(venue, 5_000 * USD);
        vm.warp(block.timestamp + 3 days);
        assertTrue(vault.isStale());
        assertEq(vault.maxDeposit(bob), 0);
        assertEq(vault.maxWithdraw(alice), 0);
    }

    function test_performanceFeeOnlyAboveHighWaterMark() public {
        _deposit(alice, 10_000 * USD);
        vm.prank(keeper);
        vault.deploy(venue, 5_000 * USD);
        vm.warp(block.timestamp + 11 minutes);
        vm.prank(keeper);
        vault.reportNav(5_400 * USD, bytes32(0), ""); // +400 gain
        uint256 feeShares = vault.balanceOf(fees);
        assertGt(feeShares, 0);
        // Fee worth ~10% of the 400 gain.
        assertApproxEqAbs(vault.convertToAssets(feeShares), 40 * USD, 1 * USD);
        // A loss then a partial recovery below the old peak charges nothing.
        vm.warp(block.timestamp + 11 minutes);
        vm.prank(keeper);
        vault.reportNav(5_000 * USD, bytes32(0), "");
        vm.warp(block.timestamp + 11 minutes);
        vm.prank(keeper);
        vault.reportNav(5_300 * USD, bytes32(0), "");
        assertEq(vault.balanceOf(fees), feeShares);
    }

    function test_recallReducesDeployed() public {
        _deposit(alice, 10_000 * USD);
        vm.prank(keeper);
        vault.deploy(venue, 5_000 * USD);
        vm.prank(keeper);
        vault.recall(venue, 5_000 * USD);
        assertEq(vault.deployedValue(), 0);
        assertEq(vault.idleAssets(), 10_000 * USD);
    }

    function test_firstDepositorInflationAttackIsUnprofitable() public {
        // Attacker deposits 1 wei, donates a large amount, victim deposits.
        vm.prank(bob);
        vault.deposit(1, bob);
        vm.prank(bob);
        usdc.transfer(address(vault), 10_000 * USD);
        uint256 victimShares = _deposit(alice, 10_000 * USD);
        assertGt(victimShares, 0);
        vm.prank(alice);
        uint256 back = vault.redeem(victimShares, alice, alice);
        assertGt(back, 9_990 * USD, "victim keeps ~all value");
    }

    function test_depositCap() public {
        vm.prank(owner);
        vault.setParams(500, 10 minutes, 2 days, 1_000, 5_000 * USD);
        assertEq(vault.maxDeposit(alice), 5_000 * USD);
        vm.prank(alice);
        vm.expectRevert();
        vault.deposit(6_000 * USD, alice);
    }
}
