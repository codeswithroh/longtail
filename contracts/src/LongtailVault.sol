// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title LongtailVault
/// @notice USDC vault that funds Longtail's prediction-market liquidity strategy.
/// Idle USDC sits here; deployed capital lives in venue accounts (Polymarket, HIP-4)
/// and is reported by a keeper. Every report is rate-limited, timestamped and linked
/// to a public position snapshot, so depositors can audit what the NAV is made of.
contract LongtailVault is ERC4626, Ownable2Step, Pausable {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 private constant BPS = 10_000;

    /// @notice Signs NAV reports and moves capital to and from venue accounts.
    address public keeper;
    /// @notice Receives performance-fee shares.
    address public feeRecipient;
    /// @notice Venue account addresses allowed to receive deployed capital.
    mapping(address => bool) public isVenueAccount;

    /// @notice Last reported value of capital deployed at venues (USDC, 6 decimals).
    uint256 public deployedValue;
    /// @notice Principal currently sent out to venues, used to bound reports.
    uint256 public deployedPrincipal;
    uint256 public lastReportAt;
    bytes32 public lastSnapshotHash;

    uint256 public maxNavChangeBps = 500; // per report, vs total assets
    uint256 public minReportInterval = 10 minutes;
    uint256 public maxStaleness = 2 days;
    uint256 public performanceFeeBps = 1_000; // 10% of gains above the high-water mark
    uint256 public depositCap;
    /// @notice Assets per 1e18 shares at the last fee charge.
    uint256 public highWaterMark;

    event KeeperSet(address keeper);
    event VenueAccountSet(address account, bool allowed);
    event Deployed(address indexed to, uint256 amount);
    event Returned(address indexed from, uint256 amount);
    event NavReported(uint256 deployedValue, uint256 totalAssets, uint256 pricePerShare, bytes32 snapshotHash, string snapshotUri);
    event FeeCharged(uint256 shares, uint256 pricePerShare);
    event ParamsSet(uint256 maxNavChangeBps, uint256 minReportInterval, uint256 maxStaleness, uint256 performanceFeeBps, uint256 depositCap);

    error NotKeeper();
    error NotVenueAccount();
    error ReportTooSoon();
    error NavChangeTooLarge(uint256 previous, uint256 proposed);
    error ExceedsIdle(uint256 requested, uint256 idle);
    error BadParam();

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    constructor(IERC20 usdc, address owner_, address keeper_, address feeRecipient_, uint256 depositCap_)
        ERC20("Longtail Liquidity", "ltUSDC")
        ERC4626(usdc)
        Ownable(owner_)
    {
        keeper = keeper_;
        feeRecipient = feeRecipient_;
        depositCap = depositCap_;
        lastReportAt = block.timestamp;
        highWaterMark = _pricePerShare();
    }

    // ---------------------------------------------------------------- accounting

    /// @dev Virtual-share offset blunts the first-depositor inflation attack.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function idleAssets() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function totalAssets() public view override returns (uint256) {
        return idleAssets() + deployedValue;
    }

    function isStale() public view returns (bool) {
        return deployedPrincipal > 0 && block.timestamp > lastReportAt + maxStaleness;
    }

    function pricePerShare() external view returns (uint256) {
        return _pricePerShare();
    }

    function _pricePerShare() internal view returns (uint256) {
        return convertToAssets(1e18);
    }

    // ------------------------------------------------------- deposit/withdraw limits

    /// @dev No deposits at a stale NAV: new money would buy in at an unverified price.
    function maxDeposit(address) public view override returns (uint256) {
        if (paused() || isStale()) return 0;
        uint256 ta = totalAssets();
        return depositCap > ta ? depositCap - ta : 0;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return convertToShares(maxDeposit(receiver));
    }

    /// @dev Withdrawals are served from idle USDC only; deployed capital returns via the keeper.
    function maxWithdraw(address owner_) public view override returns (uint256) {
        if (paused() || isStale()) return 0;
        return Math.min(super.maxWithdraw(owner_), idleAssets());
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        if (paused() || isStale()) return 0;
        return Math.min(super.maxRedeem(owner_), convertToShares(idleAssets()));
    }

    // ------------------------------------------------------------ keeper operations

    /// @notice Send idle USDC to an allow-listed venue account.
    function deploy(address to, uint256 amount) external onlyKeeper whenNotPaused {
        if (!isVenueAccount[to]) revert NotVenueAccount();
        uint256 idle = idleAssets();
        if (amount > idle) revert ExceedsIdle(amount, idle);
        deployedPrincipal += amount;
        deployedValue += amount;
        IERC20(asset()).safeTransfer(to, amount);
        emit Deployed(to, amount);
    }

    /// @notice Pull USDC back from a venue account (which must have approved the vault).
    function recall(address from, uint256 amount) external onlyKeeper {
        if (!isVenueAccount[from]) revert NotVenueAccount();
        IERC20(asset()).safeTransferFrom(from, address(this), amount);
        deployedPrincipal = amount >= deployedPrincipal ? 0 : deployedPrincipal - amount;
        deployedValue = amount >= deployedValue ? 0 : deployedValue - amount;
        emit Returned(from, amount);
    }

    /// @notice Report the mark-to-model value of all venue positions plus venue cash.
    /// @param newDeployedValue USDC value of everything held at venues.
    /// @param snapshotHash keccak256 of the published position snapshot.
    /// @param snapshotUri Where the snapshot is published (IPFS or HTTPS).
    function reportNav(uint256 newDeployedValue, bytes32 snapshotHash, string calldata snapshotUri) external onlyKeeper {
        if (block.timestamp < lastReportAt + minReportInterval) revert ReportTooSoon();
        uint256 before = totalAssets();
        uint256 diff = newDeployedValue > deployedValue ? newDeployedValue - deployedValue : deployedValue - newDeployedValue;
        // A compromised or buggy keeper can only move NAV slowly; owner can pause meanwhile.
        if (before > 0 && diff * BPS > before * maxNavChangeBps) revert NavChangeTooLarge(deployedValue, newDeployedValue);
        deployedValue = newDeployedValue;
        lastReportAt = block.timestamp;
        lastSnapshotHash = snapshotHash;
        _chargePerformanceFee();
        emit NavReported(newDeployedValue, totalAssets(), _pricePerShare(), snapshotHash, snapshotUri);
    }

    function _chargePerformanceFee() internal {
        uint256 pps = _pricePerShare();
        uint256 supply = totalSupply();
        if (pps <= highWaterMark || supply == 0 || performanceFeeBps == 0) {
            if (supply == 0) highWaterMark = pps;
            return;
        }
        // Gain above the high-water mark, in assets, across all shares.
        uint256 gain = (pps - highWaterMark).mulDiv(supply, 1e18);
        uint256 feeAssets = gain.mulDiv(performanceFeeBps, BPS);
        // Mint shares worth feeAssets at the post-fee price: s = fee * S / (A - fee).
        uint256 ta = totalAssets();
        if (feeAssets == 0 || feeAssets >= ta) return;
        uint256 feeShares = feeAssets.mulDiv(supply, ta - feeAssets);
        _mint(feeRecipient, feeShares);
        highWaterMark = _pricePerShare();
        emit FeeCharged(feeShares, highWaterMark);
    }

    // ----------------------------------------------------------------------- admin

    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    function setVenueAccount(address account, bool allowed) external onlyOwner {
        isVenueAccount[account] = allowed;
        emit VenueAccountSet(account, allowed);
    }

    function setFeeRecipient(address r) external onlyOwner {
        feeRecipient = r;
    }

    function setParams(uint256 navBps, uint256 interval, uint256 staleness, uint256 feeBps, uint256 cap) external onlyOwner {
        if (navBps == 0 || navBps > 2_000 || feeBps > 3_000 || staleness < interval) revert BadParam();
        maxNavChangeBps = navBps;
        minReportInterval = interval;
        maxStaleness = staleness;
        performanceFeeBps = feeBps;
        depositCap = cap;
        emit ParamsSet(navBps, interval, staleness, feeBps, cap);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
