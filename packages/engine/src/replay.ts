import type { Book, Market, PricePoint, Trade } from "@longtail/core";
import { combine, decayedVwap, historyStats, lastPrint, type Signal } from "./forecast.ts";
import { atRiskUsd, Portfolio } from "./paper.ts";
import { makeQuote, DEFAULT_QUOTE, type QuoteConfig } from "./quoter.ts";
import { decide, DEFAULT_RISK, type RiskConfig } from "./risk.ts";
import { assessRules } from "./rules.ts";
import { applyCalibration, type CalibrationCurve } from "./calibration.ts";
import { simulateFills } from "./paper.ts";
import { ToxicityTracker, flowImbalance } from "./toxicity.ts";

export interface ReplayInput {
  market: Market;
  outcome: number;
  resolvedAt: number;
  trades: Trade[];
  history: PricePoint[];
}

export interface ReplayResult {
  marketId: string;
  question: string;
  category: string;
  outcome: number;
  fills: number;
  volumeUsd: number;
  /** Spread captured against our own fair value at fill time. */
  edgeUsd: number;
  /** Final PnL after settlement at the true outcome. */
  pnlUsd: number;
  maxGrossUsd: number;
  hoursQuoted: number;
  pulledReasons: Record<string, number>;
}

export interface ReplayOptions {
  stepMs?: number;
  risk?: RiskConfig;
  quote?: QuoteConfig;
  /** Disable the risk engine: always quote both sides at the base spread (control arm). */
  naive?: boolean;
  /** Map market-implied fair values through a calibration curve fitted on other markets. */
  calibration?: CalibrationCurve | null;
}

const emptyBook = (id: string, ts: number): Book => ({ marketId: id, ts, bids: [], asks: [] });

/**
 * Walk a resolved market hour by hour using only information available at each step,
 * quote, fill against the real prints that followed, and settle at the real outcome.
 * No historical order book exists, so we assume we never improve the venue's best price
 * (back of queue): fills only on prints strictly through our quote.
 */
export function replayMarket(input: ReplayInput, opts: ReplayOptions = {}): ReplayResult {
  const { market: m, trades, history } = input;
  const step = opts.stepMs ?? 15 * 60_000;
  const risk = opts.risk ?? DEFAULT_RISK;
  const qcfg = opts.quote ?? DEFAULT_QUOTE;
  const rules = assessRules(m);
  const tox = new ToxicityTracker();
  const pf = new Portfolio();
  const pulled: Record<string, number> = {};
  const start = Math.min(trades[0]?.ts ?? Infinity, history[0]?.ts ?? Infinity);
  const end = Math.min(input.resolvedAt, m.endTime ?? Infinity);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { marketId: m.id, question: m.question, category: m.category, outcome: input.outcome, fills: 0, volumeUsd: 0, edgeUsd: 0, pnlUsd: 0, maxGrossUsd: 0, hoursQuoted: 0, pulledReasons: {} };
  }

  // Both arrays are time-sorted; count elements at or before t by binary search.
  const upto = <T extends { ts: number }>(xs: T[], t: number) => {
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid]!.ts <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const priceAt = (t: number) => history[upto(history, t) - 1]?.price;
  let lastFair = history[0]?.price ?? trades[0]?.price ?? 0.5;
  let maxGross = 0;
  let hoursQuoted = 0;
  const fairAt = (t: number) => priceAt(t) ?? lastFair;

  for (let t = start; t < end; t += step) {
    const nT = upto(trades, t);
    const nH = upto(history, t);
    const recentTrades = trades.slice(Math.max(0, nT - 200), nT);
    const signals: Signal[] = [];
    const vw = decayedVwap(recentTrades, t);
    if (vw) signals.push({ name: "trade_vwap", p: vw.p, weight: vw.weight });
    const lp = lastPrint(recentTrades, t);
    if (lp) signals.push({ name: "last_print", p: lp.p, weight: lp.weight });
    // Same weights as the live forecaster (forecastMarket); replay has no historical book.
    const hs = historyStats(history.slice(Math.max(0, nH - 72), nH), 6);
    if (hs) signals.push({ name: "history_ewma", p: hs.ewma, weight: 0.25 });
    const raw = combine(signals, m.endTime === null ? null : (m.endTime - t) / 3600_000, hs?.volLogit ?? null);
    const f = opts.calibration ? { ...raw, fair: applyCalibration(opts.calibration, raw.fair) } : raw;
    lastFair = raw.fair;

    tox.update(t, () => f.fair);
    const pos = pf.get(m.id, m.category);
    const hourAgo = priceAt(t - 3600_000);
    const move = hourAgo === undefined ? null : raw.fair - hourAgo;
    const sixAgo = priceAt(t - 6 * 3600_000);
    const drift = sixAgo === undefined ? null : raw.fair - sixAgo;
    const risked = Math.abs(atRiskUsd(pos.shares, f.fair));
    const exposure = { position: pos.shares, marketPnl: pf.pnl(m.id, f.fair), categoryUsd: risked, grossUsd: risked };
    const mm = { ...m, acceptingOrders: true };
    const decision = opts.naive
      ? { quote: true, allowBid: true, allowAsk: true, sizeScale: 1, extraHalfSpread: 0, reasons: [] }
      : decide(mm, f, rules, tox.score(m.id, m.category), flowImbalance(recentTrades.slice(-100), t), move, exposure, t, risk, drift);
    if (!decision.quote) {
      const key = decision.reasons.at(-1)?.split(/[:(\d]/)[0]?.trim() ?? "other";
      pulled[key] = (pulled[key] ?? 0) + 1;
      continue;
    }
    // Naive arm: fixed 2c half-spread around the last price, no skew, no limits.
    const qf = opts.naive ? { ...f, sigma: 0.02 } : f;
    const q = makeQuote(mm, emptyBook(m.id, t), qf, opts.naive ? 0 : pos.shares, decision, opts.naive ? { ...qcfg, skewPer100Usd: 0, sigmaMult: 1, minHalfSpread: 0.02 } : qcfg);
    hoursQuoted += step / 3600_000;
    const window = trades.slice(nT, upto(trades, t + step));
    // Back-of-queue: pretend the venue already shows our prices, so we never "improve".
    const book: Book = { marketId: m.id, ts: t, bids: q.bid ? [{ price: q.bid.price, size: 1 }] : [], asks: q.ask ? [{ price: q.ask.price, size: 1 }] : [] };
    for (const fill of simulateFills(q, book, window, m.category, t)) {
      pf.apply(fill, fairAt(fill.ts));
      tox.record(fill);
    }
    const p = pf.get(m.id);
    maxGross = Math.max(maxGross, Math.abs(atRiskUsd(p.shares, f.fair)));
  }

  const p = pf.get(m.id, m.category);
  pf.settle(m.id, input.outcome);
  return {
    marketId: m.id,
    question: m.question,
    category: m.category,
    outcome: input.outcome,
    fills: p.fills,
    volumeUsd: p.volumeUsd,
    edgeUsd: p.edgeUsd,
    pnlUsd: pf.realizedUsd,
    maxGrossUsd: maxGross,
    hoursQuoted,
    pulledReasons: pulled,
  };
}

export interface ReplaySummary {
  markets: number;
  marketsTraded: number;
  fills: number;
  volumeUsd: number;
  edgeUsd: number;
  pnlUsd: number;
  winRate: number;
  /** PnL over the sum of peak per-market exposure: a conservative return on capital. */
  returnOnPeakCapital: number;
  worstMarketUsd: number;
  /** Market-days spent with a live quote: the exposure base for reward income. */
  marketDaysQuoted: number;
  byCategory: Record<string, { markets: number; pnlUsd: number; volumeUsd: number }>;
}

export function summarize(results: ReplayResult[]): ReplaySummary {
  const traded = results.filter((r) => r.fills > 0);
  const byCategory: ReplaySummary["byCategory"] = {};
  for (const r of traded) {
    const c = (byCategory[r.category] ??= { markets: 0, pnlUsd: 0, volumeUsd: 0 });
    c.markets++;
    c.pnlUsd += r.pnlUsd;
    c.volumeUsd += r.volumeUsd;
  }
  const sum = (f: (r: ReplayResult) => number) => traded.reduce((a, r) => a + f(r), 0);
  const capital = sum((r) => r.maxGrossUsd);
  return {
    markets: results.length,
    marketsTraded: traded.length,
    fills: sum((r) => r.fills),
    volumeUsd: sum((r) => r.volumeUsd),
    edgeUsd: sum((r) => r.edgeUsd),
    pnlUsd: sum((r) => r.pnlUsd),
    winRate: traded.length ? traded.filter((r) => r.pnlUsd > 0).length / traded.length : 0,
    returnOnPeakCapital: capital > 0 ? sum((r) => r.pnlUsd) / capital : 0,
    worstMarketUsd: traded.reduce((a, r) => Math.min(a, r.pnlUsd), 0),
    marketDaysQuoted: results.reduce((a, r) => a + r.hoursQuoted, 0) / 24,
    byCategory,
  };
}
