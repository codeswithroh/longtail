// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {LongtailVault} from "../src/LongtailVault.sol";

/// @notice Testnet stand-in for USDC (6 decimals). Anyone can mint; never deploy to mainnet.
contract TestUSDC is ERC20 {
    constructor() ERC20("Test USD Coin", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Deploys TestUSDC + LongtailVault to a testnet with the broadcaster as owner, keeper and fee recipient.
/// forge script script/Deploy.s.sol --rpc-url $RPC --private-key $KEEPER_PRIVATE_KEY --broadcast
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        address me = msg.sender;
        TestUSDC usdc = new TestUSDC();
        LongtailVault vault = new LongtailVault(usdc, me, me, me, 1_000_000e6);
        vault.setVenueAccount(me, true);
        usdc.mint(me, 10_000e6);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(1_000e6, me);
        vm.stopBroadcast();
        console2.log("TestUSDC", address(usdc));
        console2.log("LongtailVault", address(vault));
    }
}
