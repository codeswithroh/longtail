/**
 * Flow toxicity from markouts: after each of our fills, how far did fair value move
 * against us? Persistent adverse markouts mean we are trading with better-informed
 * flow, so quotes widen and eventually pull.
 */
export interface Fill {
  marketId: string;
  category: string;
  ts: number;
  /** +1 we bought YES, -1 we sold YES */
  dir: 1 | -1;
  price: number;
  size: number;
}

interface Pending {
  fill: Fill;
  horizonMs: number;
}

export class ToxicityTracker {
  private pending: Pending[] = [];
  private byMarket = new Map<string, number>();
  private byCategory = new Map<string, number>();
  private readonly alpha: number;
  readonly horizonsMs: number[];

  constructor(horizonsMs = [5 * 60_000, 30 * 60_000], alpha = 0.3) {
    this.horizonsMs = horizonsMs;
    this.alpha = alpha;
  }

  record(fill: Fill) {
    for (const h of this.horizonsMs) this.pending.push({ fill, horizonMs: h });
  }

  /**
   * Resolve markouts whose horizon has passed, given current fair values.
   * Returns markouts in probability points (negative = adverse to us).
   */
  update(now: number, fairOf: (marketId: string) => number | undefined): { fill: Fill; horizonMs: number; markout: number }[] {
    const done: { fill: Fill; horizonMs: number; markout: number }[] = [];
    this.pending = this.pending.filter((p) => {
      if (now - p.fill.ts < p.horizonMs) return true;
      const fair = fairOf(p.fill.marketId);
      if (fair === undefined) return true;
      const markout = p.fill.dir * (fair - p.fill.price);
      done.push({ fill: p.fill, horizonMs: p.horizonMs, markout });
      const adverse = Math.max(0, -markout);
      this.bump(this.byMarket, p.fill.marketId, adverse);
      this.bump(this.byCategory, p.fill.category, adverse);
      return false;
    });
    return done;
  }

  private bump(map: Map<string, number>, key: string, x: number) {
    const prev = map.get(key) ?? 0;
    map.set(key, prev + this.alpha * (x - prev));
  }

  /** EWMA adverse markout, in probability points. */
  score(marketId: string, category: string): number {
    return Math.max(this.byMarket.get(marketId) ?? 0, 0.5 * (this.byCategory.get(category) ?? 0));
  }

  snapshot() {
    return { markets: Object.fromEntries(this.byMarket), categories: Object.fromEntries(this.byCategory), pending: this.pending.length };
  }
}

/**
 * One-sided public taker flow over a window, in [-1, 1]. Strong imbalance just before
 * we quote is a cheap early-warning for informed flow.
 */
export function flowImbalance(trades: { ts: number; side: "buy" | "sell"; size: number; price: number }[], now: number, windowMs = 60 * 60_000): number {
  let buy = 0;
  let sell = 0;
  for (const t of trades) {
    if (now - t.ts > windowMs) continue;
    const usd = t.size * t.price;
    if (t.side === "buy") buy += usd;
    else sell += usd;
  }
  const tot = buy + sell;
  return tot < 50 ? 0 : (buy - sell) / tot;
}
