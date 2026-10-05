// Live reads of the LongtailVault on HyperEVM testnet, via plain eth_call (no client library).
import { memo } from "./memo";

export const VAULT = {
  chainId: 998,
  network: "HyperEVM testnet",
  rpc: "https://rpc.hyperliquid-testnet.xyz/evm",
  vault: "0x1c4DA07db8A2b1D23dBecDE9aAD3707dfc733AfC",
  asset: "0x619E00476F63af724e478aDa07c07530795943be",
  keeper: "0x66B3A4B691699d0fbA15CefF3B7f11c71f3C9667",
};

const SEL = {
  totalAssets: "0x01e1d114",
  deployedValue: "0x2d7f73be",
  idleAssets: "0xe16b03a3",
  pricePerShare: "0x99530b06",
  totalSupply: "0x18160ddd",
  lastReportAt: "0x92dc7b7b",
  isStale: "0x1a26f447",
  lastSnapshotHash: "0x045aff77",
} as const;

export interface VaultState {
  totalAssets: number;
  deployedValue: number;
  idleAssets: number;
  pricePerShare: number;
  totalSupply: number;
  lastReportAt: number;
  isStale: boolean;
  lastSnapshotHash: string;
}

async function call(data: string): Promise<string> {
  const res = await fetch(VAULT.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: VAULT.vault, data }, "latest"] }),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000), // a slow testnet RPC shouldn't hold the page
  });
  const j = (await res.json()) as { result?: string; error?: unknown };
  if (!j.result) throw new Error("eth_call failed");
  return j.result;
}

/** Short cache: the Earn page refreshes after a deposit and should see it within seconds. */
export function readVault(): Promise<VaultState | null> {
  return memo("vault", 8_000, readVaultUncached);
}

async function readVaultUncached(): Promise<VaultState | null> {
  try {
    const keys = Object.keys(SEL) as (keyof typeof SEL)[];
    const raw = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await call(SEL[k])] as const))) as Record<keyof typeof SEL, string>;
    const n = (h: string) => Number(BigInt(h));
    return {
      totalAssets: n(raw.totalAssets) / 1e6,
      deployedValue: n(raw.deployedValue) / 1e6,
      idleAssets: n(raw.idleAssets) / 1e6,
      pricePerShare: n(raw.pricePerShare) / 1e12, // tUSDC per ltUSDC
      totalSupply: n(raw.totalSupply) / 1e12, // 6 asset decimals + 6 offset decimals
      lastReportAt: n(raw.lastReportAt) * 1000,
      isStale: BigInt(raw.isStale) !== BigInt(0),
      lastSnapshotHash: raw.lastSnapshotHash,
    };
  } catch {
    return null;
  }
}
