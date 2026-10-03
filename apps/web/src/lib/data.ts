import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Dev: the engine writes JSON to <repo>/data. Production: the scheduled engine publishes the
// same files to the repo's live-state branch, and LONGTAIL_DATA_URL points at its raw URL.
const DATA_DIR = process.env.LONGTAIL_DATA_DIR ?? path.resolve(process.cwd(), "../../data");
const DATA_URL = process.env.LONGTAIL_DATA_URL;
// Research artifacts (census, backtest, agent eval) are versioned on main under snapshot/.
const SNAPSHOT_URL = process.env.LONGTAIL_SNAPSHOT_URL;
const SNAPSHOT_FILES = new Set(["census.json", "backtest.json", "llm-eval.json", "calibration.json"]);

export async function readData<T>(file: string): Promise<{ data: T; updatedAt: Date } | null> {
  const base = SNAPSHOT_URL && SNAPSHOT_FILES.has(file) ? SNAPSHOT_URL : DATA_URL;
  if (base) {
    try {
      const res = await fetch(`${base}/${file}`, { cache: "no-store" });
      if (!res.ok) return null;
      return { data: (await res.json()) as T, updatedAt: new Date(res.headers.get("last-modified") ?? Date.now()) };
    } catch {
      return null;
    }
  }
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
  rewards: Record<"all" | "addressable" | "addressableLongTail" | "zeroVolumeAddressable", { markets: number; dailyUsd: number; medianDailyUsd: number }> | null;
  charts: {
    lorenz: { marketsPct: number; volumePct: number }[];
    rankBuckets: { label: string; markets: number; volumeShare: number }[];
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
  kalshi?: { markets: number; top0_1PctShare: number; top1PctShare: number; zeroDaily: number; twoSidedShare: number; spreadMedian: number } | { error: string } | null;
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
  marketDaysQuoted: number;
  byCategory: Record<string, { markets: number; pnlUsd: number; volumeUsd: number }>;
}

export interface Backtest {
  generatedAt: string;
  universe: { count: number; live: number; weeks: number; minVolume: number; maxVolume: number };
  assumptions: string[];
  summary: Record<"guarded" | "guardedWithLive" | "naive", ArmSummary>;
  walkForward?: {
    trainMarkets: number;
    testMarkets: number;
    splitAt: string;
    curve: { p: number; y: number; n: number }[];
    brierMarket: number;
    brierCalibrated: number;
    arms: Record<"naive" | "riskEngine" | "plusDriftGuard" | "plusCalibration", ArmSummary>;
    rewards: { rewardedShare: number | null; meanDailyUsd: number | null; breakevenShare: Record<string, number> };
  };
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
  rewards: { daily: number; maxSpread: number; share: number | null; accruedUsd: number } | null;
  position: { shares: number; pnl: number; fills: number; volumeUsd: number; edgeUsd: number } | null;
  rules: { score: number; reasons: string[] };
  ai?: { p: number; confidence: number; insiderRisk: number; clarity: number; rationale: string; evidence: string[] } | null;
  settled?: { outcome: number; at: number } | null;
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
    rewardsUsd: number;
    rewardsDailyAvailableUsd: number;
    rewardsDailyRunRateUsd: number;
    grossExposureUsd: number;
    markout5m: number | null;
    markout30m: number | null;
    pullReasons: Record<string, number>;
    llm: { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; searches: number; triaged?: number; gated?: number } | null;
    settledMarkets?: number;
    realizedUsd?: number;
  };
  markets: PaperMarket[];
}

export interface LlmEval {
  generatedAt: string;
  model: string;
  cutoff: string;
  markets: number;
  forecast: { brierMarket: number; brierCalibrated: number; brierLlm: number; brierBlend: number };
  triage: { thresholds: { maxInsiderRisk: number; minResolutionClarity: number }; flagged: { markets: number; pnlUsd: number }; kept: { markets: number; pnlUsd: number } };
  rows: { id: string; question: string; outcome: number; price: number; probability: number; insider_risk: number; resolution_clarity: number; rationale: string; flagged: boolean; pnlUsd: number }[];
}

export interface TimelineRow {
  t: number;
  quoting: number;
  markets: number;
  fills: number;
  pnlUsd: number;
  rewardsUsd: number;
  runRate: number;
  gross: number;
}

/** Engine timeline (JSON lines), downsampled to at most `max` points. */
export async function readTimeline(max = 300): Promise<TimelineRow[]> {
  const url = process.env.LONGTAIL_DATA_URL;
  let text = "";
  try {
    if (url) {
      const res = await fetch(`${url}/timeline.jsonl`, { cache: "no-store" });
      text = res.ok ? await res.text() : "";
    } else {
      const p = path.join(DATA_DIR, "timeline.jsonl");
      text = existsSync(p) ? readFileSync(p, "utf8") : "";
    }
  } catch {
    return [];
  }
  const rows = text
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as TimelineRow];
      } catch {
        return [];
      }
    });
  const step = Math.max(1, Math.ceil(rows.length / max));
  return rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
}
