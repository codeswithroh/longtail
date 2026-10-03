// Mirror the paper portfolio's return into the LongtailVault on HyperEVM testnet.
// The keeper reports deployedValue = deployed principal × (1 + paper net PnL / paper capital),
// pinned to keccak256 of the published paper-state.json. Testnet tokens only.
// Usage: node packages/engine/src/cli/report-nav.ts [path=data/paper-state.json]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, parseAbi, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEFAULT_RISK } from "../risk.ts";

export const HYPEREVM_TESTNET = defineChain({
  id: 998,
  name: "HyperEVM Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.hyperliquid-testnet.xyz/evm"] } },
});
export const VAULT = "0x1c4DA07db8A2b1D23dBecDE9aAD3707dfc733AfC" as const;
const PRINCIPAL = 500_000_000n; // 500 tUSDC deployed to the keeper's venue account
const SNAPSHOT_URI = "https://raw.githubusercontent.com/codeswithroh/longtail/live-state/paper-state.json";

const abi = parseAbi([
  "function deployedValue() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function lastReportAt() view returns (uint256)",
  "function minReportInterval() view returns (uint256)",
  "function maxNavChangeBps() view returns (uint256)",
  "function reportNav(uint256 newDeployedValue, bytes32 snapshotHash, string snapshotUri)",
]);

const pk = process.env.KEEPER_PRIVATE_KEY as `0x${string}` | undefined;
if (!pk) throw new Error("KEEPER_PRIVATE_KEY is not set");
const raw = readFileSync(process.argv[2] ?? "data/paper-state.json", "utf8");
const s = JSON.parse(raw).summary as { pnlUsd: number; rewardsUsd: number };
const paperReturn = (s.pnlUsd + s.rewardsUsd) / DEFAULT_RISK.maxGrossUsd;

const pub = createPublicClient({ chain: HYPEREVM_TESTNET, transport: http() });
const read = <T>(functionName: "deployedValue" | "totalAssets" | "lastReportAt" | "minReportInterval" | "maxNavChangeBps") =>
  pub.readContract({ address: VAULT, abi, functionName }) as Promise<T>;
const [current, total, last, interval, bps] = await Promise.all([
  read<bigint>("deployedValue"),
  read<bigint>("totalAssets"),
  read<bigint>("lastReportAt"),
  read<bigint>("minReportInterval"),
  read<bigint>("maxNavChangeBps"),
]);
const now = BigInt(Math.floor(Date.now() / 1000));
if (now < last + interval) {
  console.log(`report too soon (last ${now - last}s ago)`);
  process.exit(0);
}

// Move toward the target, never more than 90% of the contract's per-report bound.
const target = (PRINCIPAL * BigInt(Math.round((1 + paperReturn) * 1e6))) / 1_000_000n;
const step = (total * bps * 9n) / 100_000n;
const next = target > current ? (target - current > step ? current + step : target) : current - target > step ? current - step : target;

const wallet = createWalletClient({ chain: HYPEREVM_TESTNET, transport: http(), account: privateKeyToAccount(pk) });
const hash = await wallet.writeContract({ address: VAULT, abi, functionName: "reportNav", args: [next, keccak256(toBytes(raw)), SNAPSHOT_URI] });
const rcpt = await pub.waitForTransactionReceipt({ hash });
const logPath = "data/nav-reports.json";
const history = existsSync(logPath) ? (JSON.parse(readFileSync(logPath, "utf8")) as unknown[]) : [];
history.push({ t: Date.now(), deployedValue: Number(next) / 1e6, paperReturn, snapshotHash: keccak256(toBytes(raw)), tx: hash, status: rcpt.status });
writeFileSync(logPath, JSON.stringify(history.slice(-500), null, 2));
console.log(`reportNav ${Number(next) / 1e6} tUSDC (paper return ${(paperReturn * 100).toFixed(2)}%) · ${rcpt.status} · ${hash}`);
