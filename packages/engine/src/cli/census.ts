// Market-wide census of prediction-market liquidity: how much of the catalog is tradeable?
// Usage: node packages/engine/src/cli/census.ts [--cached] [bookSample=400]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { depthNear, Hip4, mapLimit, Polymarket, spread, type Market } from "@longtail/core";
import { assessRules, infoRegime } from "../rules.ts";

const args = process.argv.slice(2);
const cached = args.includes("--cached");
const bookSample = Number(args.find((a) => /^\d+$/.test(a)) ?? 400);
const CACHE = "data/pm-markets.json";

mkdirSync("data", { recursive: true });
const pm = new Polymarket();
let markets: Market[];
if (cached && existsSync(CACHE)) {
  markets = JSON.parse(readFileSync(CACHE, "utf8")) as Market[];
} else {
  markets = await pm.listMarkets((n) => process.stdout.write(`\r  listed ${n} markets`));
  process.stdout.write("\n");
  writeFileSync(CACHE, JSON.stringify(markets));
}
const now = Date.now();
markets = markets.filter((m) => m.acceptingOrders && (m.endTime ?? Infinity) > now);

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : NaN;
};
const share = (xs: Market[], f: (m: Market) => boolean) => (xs.length ? xs.filter(f).length / xs.length : 0);

function stats(xs: Market[]) {
  const vols = xs.map((m) => m.volume24h);
  const total = vols.reduce((a, b) => a + b, 0);
  const sorted = [...vols].sort((a, b) => b - a);
  const top = (f: number) => sorted.slice(0, Math.max(1, Math.floor(f * sorted.length))).reduce((a, b) => a + b, 0) / (total || 1);
  const quoted = xs.filter((m) => m.bestBid !== null && m.bestAsk !== null);
  const spreads = quoted.map((m) => m.bestAsk! - m.bestBid!);
  return {
    markets: xs.length,
    volume24hUsd: Math.round(total),
    top1PctShare: top(0.01),
    top10PctShare: top(0.1),
    under1kDaily: share(xs, (m) => m.volume24h < 1000),
    zeroDaily: share(xs, (m) => m.volume24h === 0),
    twoSidedShare: xs.length ? quoted.length / xs.length : 0,
    spreadMedian: q(spreads, 0.5),
    spreadP75: q(spreads, 0.75),
    spreadAtLeast5c: spreads.length ? spreads.filter((s) => s >= 0.05).length / spreads.length : 0,
    liquidityMedianUsd: Math.round(q(xs.map((m) => m.liquidity), 0.5)),
  };
}

const slow = markets.filter((m) => infoRegime(m) === "slow");
const live = markets.filter((m) => infoRegime(m) === "live");
// The addressable set: slow-information markets with clean rules, ending within 4 months.
const addressable = slow.filter((m) => assessRules(m).score <= 0.45 && (m.endTime ?? Infinity) - now < 120 * 86_400_000);
const longTail = addressable.filter((m) => m.volume24h < 1000);

// Sample real books from the addressable long tail to measure depth near the mid.
const sample = [...longTail].sort(() => Math.random() - 0.5).slice(0, bookSample);
const books = await mapLimit(sample, 8, (m) => pm.getBook(m).catch(() => null));
const depth2c = books.flatMap((b) => (b ? [depthNear(b, 2)] : []));
const bookSpreads = books.flatMap((b) => (b && spread(b) !== null ? [spread(b)!] : []));

const byCategory = new Map<string, { markets: number; volume24hUsd: number }>();
for (const m of addressable) {
  const c = byCategory.get(m.category) ?? { markets: 0, volume24hUsd: 0 };
  c.markets++;
  c.volume24hUsd += m.volume24h;
  byCategory.set(m.category, c);
}

let hip4: unknown = null;
try {
  const hm = await new Hip4().listMarkets();
  const hb = await mapLimit(hm, 8, (m) => new Hip4().getBook(m).catch(() => null));
  const hs = hb.flatMap((b) => (b && spread(b) !== null ? [spread(b)!] : []));
  hip4 = { markets: hm.length, twoSided: hs.length, spreadMedian: q(hs, 0.5), spreadP75: q(hs, 0.75) };
} catch (e) {
  hip4 = { error: String(e) };
}

// Concentration curve: share of 24h volume captured by the top x% of markets.
function lorenz(xs: Market[], points = 50) {
  const v = xs.map((m) => m.volume24h).sort((a, b) => b - a);
  const total = v.reduce((a, b) => a + b, 0) || 1;
  const out: { marketsPct: number; volumePct: number }[] = [{ marketsPct: 0, volumePct: 0 }];
  let cum = 0;
  let next = 1;
  for (let i = 0; i < v.length; i++) {
    cum += v[i]!;
    const pct = ((i + 1) / v.length) * 100;
    if (pct >= (next * 100) / points || i === v.length - 1) {
      out.push({ marketsPct: +pct.toFixed(2), volumePct: +((cum / total) * 100).toFixed(2) });
      next++;
    }
  }
  return out;
}

const SPREAD_BINS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];
function spreadHist(xs: Market[]) {
  const counts = new Array(SPREAD_BINS.length).fill(0) as number[];
  let oneSided = 0;
  for (const m of xs) {
    if (m.bestBid === null || m.bestAsk === null) {
      oneSided++;
      continue;
    }
    const s = m.bestAsk - m.bestBid;
    const i = SPREAD_BINS.findIndex((hi) => s <= hi + 1e-9);
    counts[i === -1 ? SPREAD_BINS.length - 1 : i]!++;
  }
  const n = xs.length || 1;
  const label = (i: number) => `${i === 0 ? 0 : Math.round(SPREAD_BINS[i - 1]! * 100)}–${Math.round(SPREAD_BINS[i]! * 100)}¢`;
  return [...counts.map((c, i) => ({ label: label(i), share: c / n })), { label: "one-sided", share: oneSided / n }];
}

// Liquidity rewards (written by `pnpm rewards`): USDC per day paid to makers per market.
const rewardsFile = "data/pm-rewards.json";
const REWARDS: Record<string, { daily: number; maxSpread: number; minSize: number }> = existsSync(rewardsFile)
  ? JSON.parse(readFileSync(rewardsFile, "utf8"))
  : {};
const rewardStats = (xs: Market[]) => {
  const r = xs.flatMap((m) => (REWARDS[m.groupId] ? [REWARDS[m.groupId]!.daily] : []));
  return { markets: r.length, dailyUsd: Math.round(r.reduce((a, b) => a + b, 0)), medianDailyUsd: q(r, 0.5) };
};

// Volume share by market-rank bucket: easier to read than a curve when 2% of markets hold ~all volume.
function rankBuckets(xs: Market[]) {
  const v = xs.map((m) => m.volume24h).sort((a, b) => b - a);
  const total = v.reduce((a, b) => a + b, 0) || 1;
  const cuts: [string, number, number][] = [["top 0.1%", 0, 0.001], ["0.1–1%", 0.001, 0.01], ["1–10%", 0.01, 0.1], ["bottom 90%", 0.1, 1]];
  return cuts.map(([label, lo, hi]) => {
    const slice = v.slice(Math.floor(lo * v.length), Math.floor(hi * v.length));
    return { label, markets: slice.length, volumeShare: slice.reduce((a, b) => a + b, 0) / total };
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  rewards: Object.keys(REWARDS).length
    ? {
        all: rewardStats(markets),
        addressable: rewardStats(addressable),
        addressableLongTail: rewardStats(longTail),
        zeroVolumeAddressable: rewardStats(addressable.filter((m) => m.volume24h === 0)),
      }
    : null,
  charts: {
    lorenz: lorenz(markets),
    rankBuckets: rankBuckets(markets),
    spreadHist: { live: spreadHist(live), slow: spreadHist(slow) },
  },
  polymarket: {
    all: stats(markets),
    live: stats(live),
    slow: stats(slow),
    addressable: stats(addressable),
    addressableLongTail: {
      markets: longTail.length,
      sampledBooks: depth2c.length,
      depthWithin2cMedianUsd: Math.round(q(depth2c, 0.5)),
      depthWithin2cP25Usd: Math.round(q(depth2c, 0.25)),
      bookSpreadMedian: q(bookSpreads, 0.5),
      bookSpreadP75: q(bookSpreads, 0.75),
    },
    topCategories: [...byCategory.entries()].sort((a, b) => b[1].markets - a[1].markets).slice(0, 15).map(([category, v]) => ({ category, ...v })),
  },
  hip4,
};
writeFileSync("data/census.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
