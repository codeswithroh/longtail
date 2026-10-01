import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// The engine writes JSON to <repo>/data; the web app reads it at request time.
const DATA_DIR = process.env.LONGTAIL_DATA_DIR ?? path.resolve(process.cwd(), "../../data");

export function readData<T>(file: string): { data: T; updatedAt: Date } | null {
  const p = path.join(DATA_DIR, file);
  if (!existsSync(p)) return null;
  try {
    return { data: JSON.parse(readFileSync(p, "utf8")) as T, updatedAt: statSync(p).mtime };
  } catch {
    return null;
  }
}

export interface RegimeStats {
  markets: number;
  volume24hUsd: number;
  top1PctShare: number;
  top10PctShare: number;
  under1kDaily: number;
  zeroDaily: number;
  twoSidedShare: number;
  spreadMedian: number;
  spreadP75: number;
  spreadAtLeast5c: number;
  liquidityMedianUsd: number;
}

export interface Census {
  generatedAt: string;
  charts: {
    lorenz: { marketsPct: number; volumePct: number }[];
    spreadHist: { live: { label: string; share: number }[]; slow: { label: string; share: number }[] };
  };
  polymarket: {
    all: RegimeStats;
    live: RegimeStats;
    slow: RegimeStats;
    addressable: RegimeStats;
    addressableLongTail: {
      markets: number;
      sampledBooks: number;
      depthWithin2cMedianUsd: number;
      depthWithin2cP25Usd: number;
      bookSpreadMedian: number;
      bookSpreadP75: number;
    };
    topCategories: { category: string; markets: number; volume24hUsd: number }[];
  };
  hip4: { markets: number; twoSided: number; spreadMedian: number; spreadP75: number } | { error: string } | null;
}

export interface ArmSummary {
  markets: number;
  marketsTraded: number;
  fills: number;
  volumeUsd: number;
  edgeUsd: number;
  pnlUsd: number;
  winRate: number;
  returnOnPeakCapital: number;
  worstMarketUsd: number;
  byCategory: Record<string, { markets: number; pnlUsd: number; volumeUsd: number }>;
}

export interface Backtest {
  generatedAt: string;
  universe: { count: number; live: number; weeks: number; minVolume: number; maxVolume: number };
  assumptions: string[];
  summary: Record<"guarded" | "guardedWithLive" | "naive", ArmSummary>;
  markets: {
    marketId: string;
    question: string;
    category: string;
    regime: "live" | "slow";
    outcome: number;
    fills: number;
    volumeUsd: number;
    edgeUsd: number;
    pnlUsd: number;
    naivePnlUsd: number;
    withLivePnlUsd: number;
    maxGrossUsd: number;
    hoursQuoted: number;
    pulledReasons: Record<string, number>;
  }[];
}

export interface PaperMarket {
  id: string;
  venue: "polymarket" | "hip4";
  question: string;
  category: string;
  url: string;
  endTime: number | null;
  volume24h: number;
  book: { bid: number | null; ask: number | null; spread: number | null } | null;
  fair: number | null;
  sigma: number | null;
  signals: { name: string; p: number; weight: number }[];
  quote: { bid: { price: number; size: number } | null; ask: { price: number; size: number } | null; spread: number | null } | null;
  improvesSpread: boolean | null;
  decision: { quote: boolean; reasons: string[] } | null;
  position: { shares: number; pnl: number; fills: number; volumeUsd: number; edgeUsd: number } | null;
  rules: { score: number; reasons: string[] };
}

export interface PaperState {
  summary: {
    startedAt: number;
    updatedAt: number;
    cycles: number;
    markets: number;
    quoting: number;
    improvingSpread: number;
    medianVenueSpread: number | null;
    medianOurSpread: number | null;
    fills: number;
    volumeUsd: number;
    edgeUsd: number;
    pnlUsd: number;
    grossExposureUsd: number;
    markout5m: number | null;
    markout30m: number | null;
    pullReasons: Record<string, number>;
    llm: { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; searches: number } | null;
  };
  markets: PaperMarket[];
}
