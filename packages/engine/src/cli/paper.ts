// Live paper trading: quote the addressable long tail against live books, fill against
// live taker prints, never send an order. State goes to data/ for the dashboard.
// Usage: node packages/engine/src/cli/paper.ts [markets=150] [cycleSec=60]
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Hip4, mapLimit, Polymarket, spread, type Book, type Market, type PricePoint, type Trade, type Venue } from "@longtail/core";
import { forecastMarket, historyStats, type ExternalForecaster, type Forecast } from "../forecast.ts";
import { LlmForecaster } from "../llm.ts";
import { Portfolio, simulateFills } from "../paper.ts";
import { makeQuote, type Quote } from "../quoter.ts";
import { decide, DEFAULT_RISK, type RiskDecision } from "../risk.ts";
import { assessRules, infoRegime } from "../rules.ts";
import { rewardAccrual, rewardShare, type RewardConfig } from "../rewards.ts";
import { applyCalibration, type CalibrationCurve } from "../calibration.ts";
import { flowImbalance, ToxicityTracker } from "../toxicity.ts";

const [nArg = "150", cycleArg = "60"] = process.argv.slice(2);
const N = Number(nArg);
const CYCLE_MS = Number(cycleArg) * 1000;
const DATA = "data";
mkdirSync(DATA, { recursive: true });

const pm = new Polymarket();
// Liquidity-reward configs keyed by conditionId (written by the census).
const REWARDS: Record<string, RewardConfig> = existsSync(`${DATA}/pm-rewards.json`)
  ? (JSON.parse(readFileSync(`${DATA}/pm-rewards.json`, "utf8")) as Record<string, RewardConfig>)
  : {};
const CURVE: CalibrationCurve | null = existsSync(`${DATA}/calibration.json`) ? (JSON.parse(readFileSync(`${DATA}/calibration.json`, "utf8")) as CalibrationCurve) : null;
const rewardOf = (m: Market) => (m.venue === "polymarket" ? REWARDS[m.groupId] : undefined);
const hip4 = new Hip4();
const venues: Record<string, Venue> = { polymarket: pm, hip4 };

// ---------------------------------------------------------------- universe
async function selectUniverse(): Promise<Market[]> {
  const now = Date.now();
  const cache = `${DATA}/pm-markets.json`;
  const all: Market[] = existsSync(cache) ? (JSON.parse(readFileSync(cache, "utf8")) as Market[]) : await pm.listMarkets();
  const eligible = (m: Market) =>
    m.acceptingOrders &&
    infoRegime(m) === "slow" &&
    assessRules(m).score <= DEFAULT_RISK.maxRuleScore &&
    m.endTime !== null &&
    m.endTime - now > 3 * 86_400_000 &&
    m.endTime - now < DEFAULT_RISK.maxDaysToEnd * 86_400_000;
  // Long tail with a pulse: some trading, but too little for professional makers to bother.
  const pmPick = all
    .filter((m) => eligible(m) && m.volume24h >= 20 && m.volume24h < 2_000 && (m.bestAsk ?? 1) - (m.bestBid ?? 0) >= 0.02)
    .sort((a, b) => (rewardOf(b)?.daily ?? 0) - (rewardOf(a)?.daily ?? 0) || b.volume24h - a.volume24h);
  const perEvent = new Map<string, number>();
  const picked: Market[] = [];
  for (const m of pmPick) {
    const k = m.eventId ?? m.groupId;
    if ((perEvent.get(k) ?? 0) >= 2) continue;
    perEvent.set(k, (perEvent.get(k) ?? 0) + 1);
    picked.push(m);
    if (picked.length >= N) break;
  }
  const hm = (await hip4.listMarkets().catch(() => [])).filter((m) => eligible({ ...m, endTime: m.endTime ?? now + 30 * 86_400_000 }));
  return [...picked, ...hm.slice(0, 20)];
}

// ---------------------------------------------------------------- state
interface MarketState {
  market: Market;
  lastTradeTs: number;
  history: PricePoint[];
  historyAt: number;
  recent: Trade[];
  quote: Quote | null;
  quoteBook: Book | null;
  quotedAt: number;
  forecast: Forecast | null;
  decision: RiskDecision | null;
  book: { bid: number | null; ask: number | null; spread: number | null } | null;
  rewardsUsd: number;
  rewardShare: number | null;
}

const pf = new Portfolio();
const tox = new ToxicityTracker();
const states = new Map<string, MarketState>();
const external: ExternalForecaster[] = LlmForecaster.available() ? [new LlmForecaster()] : [];
const startedAt = Date.now();
let cycles = 0;
const markouts: { horizonMs: number; markout: number }[] = [];

function fairOf(id: string): number {
  return states.get(id)?.forecast?.fair ?? 0.5;
}

async function step(s: MarketState, now: number) {
  const venue = venues[s.market.venue]!;
  const [book, newTrades] = await Promise.all([venue.getBook(s.market), venue.getTrades(s.market, s.lastTradeTs)]);
  if (newTrades.length) s.lastTradeTs = newTrades.at(-1)!.ts;
  s.recent = [...s.recent, ...newTrades].slice(-300);

  // 1. Rewards and fills for the quote we left resting last cycle.
  const cfg = rewardOf(s.market);
  if (s.quote && s.quoteBook && cfg) {
    const r = rewardShare(s.quote, s.quoteBook, cfg);
    s.rewardShare = r.share;
    s.rewardsUsd += rewardAccrual(r.share, cfg, now - s.quotedAt);
  }
  if (s.quote && s.quoteBook) {
    for (const fill of simulateFills(s.quote, s.quoteBook, newTrades, s.market.category, s.quotedAt)) {
      pf.apply(fill, fairOf(s.market.id));
      tox.record(fill);
      appendFileSync(`${DATA}/fills.jsonl`, JSON.stringify({ ...fill, venue: s.market.venue, question: s.market.question }) + "\n");
    }
  }

  // 2. Refresh history every 30 minutes; it only feeds slow-moving signals.
  if (now - s.historyAt > 30 * 60_000) {
    s.history = await venue.getHistory(s.market, now - 7 * 86_400_000, now).catch(() => s.history);
    s.historyAt = now;
  }

  // 3. Forecast, risk, quote.
  const raw = await forecastMarket(s.market, book, s.recent, s.history, now, external);
  // Calibrate only market-implied signals; an LLM forecast is already a probability judgement.
  const f = CURVE && external.length === 0 ? { ...raw, fair: applyCalibration(CURVE, raw.fair) } : raw;
  s.forecast = f;
  const pos = pf.get(s.market.id, s.market.category);
  const exp = pf.exposureUsd(fairOf);
  const hourAgo = s.history.filter((p) => p.ts <= now - 3600_000).at(-1)?.price;
  const sixAgo = s.history.filter((p) => p.ts <= now - 6 * 3600_000).at(-1)?.price;
  const decision = decide(
    s.market,
    f,
    assessRules(s.market),
    tox.score(s.market.id, s.market.category),
    flowImbalance(s.recent, now),
    hourAgo === undefined ? null : raw.fair - hourAgo,
    { position: pos.shares, marketPnl: pf.pnl(s.market.id, f.fair), categoryUsd: exp.byCategory.get(s.market.category) ?? 0, grossUsd: exp.gross },
    now,
    DEFAULT_RISK,
    sixAgo === undefined ? null : raw.fair - sixAgo,
  );
  s.decision = decision;
  const rc = rewardOf(s.market);
  s.quote = decision.quote ? makeQuote(s.market, book, f, pos.shares, decision, undefined, rc ? { maxSpreadCents: rc.maxSpread, minSize: rc.minSize } : undefined) : null;
  s.quoteBook = book;
  s.quotedAt = now;
  s.book = { bid: book.bids[0]?.price ?? null, ask: book.asks[0]?.price ?? null, spread: spread(book) };
}

function snapshot(now: number) {
  const rows = [...states.values()].map((s) => {
    const p = pf.positions.get(s.market.id);
    const ourSpread = s.quote?.bid && s.quote?.ask ? s.quote.ask.price - s.quote.bid.price : null;
    return {
      id: s.market.id,
      venue: s.market.venue,
      question: s.market.question,
      category: s.market.category,
      url: s.market.url,
      endTime: s.market.endTime,
      volume24h: s.market.volume24h,
      book: s.book,
      fair: s.forecast?.fair ?? null,
      sigma: s.forecast?.sigma ?? null,
      signals: s.forecast?.signals.map((x) => ({ name: x.name, p: x.p, weight: x.weight })) ?? [],
      quote: s.quote ? { bid: s.quote.bid, ask: s.quote.ask, spread: ourSpread } : null,
      rewards: rewardOf(s.market) ? { daily: rewardOf(s.market)!.daily, maxSpread: rewardOf(s.market)!.maxSpread, share: s.rewardShare, accruedUsd: s.rewardsUsd } : null,
      improvesSpread: ourSpread !== null && s.book?.spread !== null && s.book?.spread !== undefined ? ourSpread < s.book.spread : null,
      decision: s.decision ? { quote: s.decision.quote, reasons: s.decision.reasons } : null,
      position: p ? { shares: p.shares, pnl: pf.pnl(s.market.id, s.forecast?.fair ?? 0.5), fills: p.fills, volumeUsd: p.volumeUsd, edgeUsd: p.edgeUsd } : null,
      rules: assessRules(s.market),
    };
  });
  const quoted = rows.filter((r) => r.quote);
  const exp = pf.exposureUsd(fairOf);
  const unreal = [...pf.positions.keys()].reduce((a, id) => a + pf.pnl(id, fairOf(id)), 0);
  const fills = [...pf.positions.values()].reduce((a, p) => a + p.fills, 0);
  const summary = {
    startedAt,
    updatedAt: now,
    cycles,
    markets: rows.length,
    quoting: quoted.length,
    improvingSpread: rows.filter((r) => r.improvesSpread).length,
    medianVenueSpread: median(rows.flatMap((r) => (r.book?.spread != null ? [r.book.spread] : []))),
    medianOurSpread: median(quoted.flatMap((r) => (r.quote?.spread != null ? [r.quote.spread] : []))),
    fills,
    volumeUsd: [...pf.positions.values()].reduce((a, p) => a + p.volumeUsd, 0),
    edgeUsd: [...pf.positions.values()].reduce((a, p) => a + p.edgeUsd, 0),
    pnlUsd: unreal + pf.realizedUsd,
    rewardsUsd: [...states.values()].reduce((a, s) => a + s.rewardsUsd, 0),
    rewardsDailyAvailableUsd: [...states.values()].reduce((a, s) => a + (rewardOf(s.market)?.daily ?? 0), 0),
    rewardsDailyRunRateUsd: [...states.values()].reduce((a, s) => a + (s.quote && s.rewardShare ? (rewardOf(s.market)?.daily ?? 0) * s.rewardShare : 0), 0),
    grossExposureUsd: exp.gross,
    markout5m: avg(markouts.filter((m) => m.horizonMs === 5 * 60_000).map((m) => m.markout)),
    markout30m: avg(markouts.filter((m) => m.horizonMs === 30 * 60_000).map((m) => m.markout)),
    pullReasons: countReasons(rows),
    llm: external.length ? (external[0] as LlmForecaster).usage : null,
  };
  writeFileSync(`${DATA}/paper-state.json`, JSON.stringify({ summary, markets: rows, toxicity: tox.snapshot() }));
  return summary;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function countReasons(rows: { decision: { quote: boolean; reasons: string[] } | null }[]) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!r.decision || r.decision.quote) continue;
    const k = (r.decision.reasons.at(-1) ?? "other").split(/[:(\d]/)[0]!.trim();
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// ---------------------------------------------------------------- main loop
const universe = await selectUniverse();
console.log(`paper trading ${universe.length} markets (${universe.filter((m) => m.venue === "hip4").length} HIP-4), LLM forecaster: ${external.length ? "on" : "off"}`);
for (const m of universe) {
  states.set(m.id, { market: m, lastTradeTs: Date.now(), history: [], historyAt: 0, recent: [], quote: null, quoteBook: null, quotedAt: 0, forecast: null, decision: null, book: null, rewardsUsd: 0, rewardShare: null });
}

let stopping = false;
process.on("SIGINT", () => (stopping = true));
while (!stopping) {
  const t0 = Date.now();
  await mapLimit([...states.values()], 6, (s) => step(s, Date.now()).catch((e) => console.error(`  ${s.market.question.slice(0, 40)}: ${String(e).slice(0, 120)}`)));
  for (const m of tox.update(Date.now(), fairOf)) markouts.push({ horizonMs: m.horizonMs, markout: m.markout });
  cycles++;
  const s = snapshot(Date.now());
  console.log(
    `[${new Date().toISOString().slice(11, 19)}] cycle ${cycles}: quoting ${s.quoting}/${s.markets}, improving spread on ${s.improvingSpread}, ` +
      `fills ${s.fills}, vol $${s.volumeUsd.toFixed(0)}, PnL $${s.pnlUsd.toFixed(2)}, rewards $${s.rewardsUsd.toFixed(2)} (run-rate $${s.rewardsDailyRunRateUsd.toFixed(0)}/day), gross $${s.grossExposureUsd.toFixed(0)} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
  );
  await new Promise((r) => setTimeout(r, Math.max(0, CYCLE_MS - (Date.now() - t0))));
}
snapshot(Date.now());
