// HyperEVM testnet: chain definition, contract addresses and the ABI fragments the app uses.
import { defineChain, parseAbi } from "viem";

export const hyperEvmTestnet = defineChain({
  id: 998,
  name: "HyperEVM Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.hyperliquid-testnet.xyz/evm"] } },
  testnet: true,
});

export const VAULT_ADDRESS = "0x1c4DA07db8A2b1D23dBecDE9aAD3707dfc733AfC" as const;
export const USDC_ADDRESS = "0x619E00476F63af724e478aDa07c07530795943be" as const;

export const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
]);

export const vaultAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function maxWithdraw(address owner) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function maxDeposit(address) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);
