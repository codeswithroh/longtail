import type { Book, Market, PricePoint, Trade } from "@longtail/core";

export interface Signal {
  name: string;
  p: number;
  /** Relative trust in this signal (0..1). */
  weight: number;
}

export interface Forecast {
  fair: number;
  /** One-sigma uncertainty of `fair`, in probability units. */
  sigma: number;
  signals: Signal[];
}

/** Optional external forecaster (e.g. an LLM agent). Returns null when it declines. */
export interface ExternalForecaster {
  name: string;
  forecast(market: Market, context: { book: Book; recent: Trade[] }): Promise<{ p: number; confidence: number } | null>;
}

const EPS = 0.005;
export const clampP = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));
export const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Size-weighted top of book; ignores books too wide to carry information. */
export function microprice(book: Book, maxSpread = 0.15): number | null {
  const b = book.bids[0];
  const a = book.asks[0];
  if (!b || !a || a.price - b.price > maxSpread) return null;
  const w = b.size + a.size;
  return w > 0 ? (b.price * a.size + a.price * b.size) / w : (b.price + a.price) / 2;
}

/** Trade VWAP with exponential time decay (half-life in ms). */
export function decayedVwap(trades: Trade[], now: number, halfLifeMs = 6 * 3600_000): { p: number; weight: number } | null {
  let num = 0;
  let den = 0;
  for (const t of trades) {
    const w = t.size * t.price * Math.pow(0.5, (now - t.ts) / halfLifeMs);
    num += w * t.price;
    den += w;
  }
  if (den <= 0) return null;
  // Saturating trust: $200 of decayed notional is plenty for a long-tail market.
  return { p: num / den, weight: Math.min(1, den / 200) };
}

/** The latest print, trusted less as it ages (half-life 2h) and when tiny. */
export function lastPrint(trades: Trade[], now: number): { p: number; weight: number } | null {
  const t = trades.at(-1);
  if (!t) return null;
  const age = Math.pow(0.5, (now - t.ts) / (2 * 3600_000));
  return { p: t.price, weight: 0.9 * age * Math.min(1, (t.size * t.price) / 20) };
}

/** EWMA of hourly closes and their realized volatility (per sqrt-hour, in logit space). */
export function historyStats(history: PricePoint[], halfLifePts = 12): { ewma: number; volLogit: number } | null {
  if (history.length < 3) return null;
  const alpha = 1 - Math.pow(0.5, 1 / halfLifePts);
  let ewma = history[0]!.price;
  let sq = 0;
  let n = 0;
  for (let i = 1; i < history.length; i++) {
    const p = history[i]!.price;
    ewma = alpha * p + (1 - alpha) * ewma;
    const d = logit(p) - logit(history[i - 1]!.price);
    sq += d * d;
    n++;
  }
  return { ewma, volLogit: Math.sqrt(sq / Math.max(1, n)) };
}

/**
 * Blend signals in logit space. Disagreement between signals and thin evidence both
 * widen sigma, which in turn widens quotes.
 */
export function combine(signals: Signal[], hoursToEnd: number | null, volLogit: number | null): Forecast {
  const usable = signals.filter((s) => s.weight > 0 && Number.isFinite(s.p));
  if (usable.length === 0) return { fair: 0.5, sigma: 0.25, signals };
  const wsum = usable.reduce((a, s) => a + s.weight, 0);
  const meanL = usable.reduce((a, s) => a + s.weight * logit(s.p), 0) / wsum;
  const dispL = Math.sqrt(usable.reduce((a, s) => a + s.weight * (logit(s.p) - meanL) ** 2, 0) / wsum);
  const fair = sigmoid(meanL);
  // Expected move over the next hour from realized vol, plus a floor for thin evidence.
  const evidence = Math.min(1, wsum);
  const sigL = Math.sqrt(dispL ** 2 + (volLogit ?? 0.15) ** 2 + (0.6 * (1 - evidence)) ** 2);
  // Delta method: dp = p(1-p) dL. Near expiry, outcomes jump, so add a jump term.
  let sigma = fair * (1 - fair) * sigL;
  if (hoursToEnd !== null && hoursToEnd < 48) sigma += 0.02 * (48 - hoursToEnd) / 48;
  return { fair, sigma: Math.min(0.25, Math.max(0.005, sigma)), signals };
}

export async function forecastMarket(
  market: Market,
  book: Book,
  trades: Trade[],
  history: PricePoint[],
  now: number,
  external: ExternalForecaster[] = [],
): Promise<Forecast> {
  const signals: Signal[] = [];
  const mp = microprice(book);
  if (mp !== null) {
    const top = (book.bids[0]?.size ?? 0) * (book.bids[0]?.price ?? 0) + (book.asks[0]?.size ?? 0) * (book.asks[0]?.price ?? 0);
    signals.push({ name: "microprice", p: mp, weight: Math.min(1, top / 500) * 0.8 });
  }
  const vw = decayedVwap(trades, now);
  if (vw) signals.push({ name: "trade_vwap", p: vw.p, weight: vw.weight });
  const lp = lastPrint(trades, now);
  if (lp) signals.push({ name: "last_print", p: lp.p, weight: lp.weight });
  const hs = historyStats(history);
  if (hs) signals.push({ name: "history_ewma", p: hs.ewma, weight: 0.5 });
  for (const ext of external) {
    const r = await ext.forecast(market, { book, recent: trades }).catch(() => null);
    if (r) signals.push({ name: ext.name, p: r.p, weight: Math.max(0, Math.min(1, r.confidence)) });
  }
  const hoursToEnd = market.endTime === null ? null : (market.endTime - now) / 3600_000;
  return combine(signals, hoursToEnd, hs?.volLogit ?? null);
}
