import type { Book, Trade } from "@longtail/core";
import type { Quote } from "./quoter.ts";
import type { Fill } from "./toxicity.ts";

/**
 * Counterfactual fills for resting quotes against real taker prints.
 *
 * A real taker who sold at price x <= our bid would have hit our bid first, but only
 * if our bid was the best price. When our bid sits at the venue's existing best bid we
 * assume we are last in the queue and only fill on prints strictly through our price.
 * Fills are capped by the print's size: we never invent volume.
 */
export function simulateFills(quote: Quote, bookAtQuote: Book, prints: Trade[], category: string, quotedAt: number): Fill[] {
  const fills: Fill[] = [];
  let bidLeft = quote.bid?.size ?? 0;
  let askLeft = quote.ask?.size ?? 0;
  const venueBid = bookAtQuote.bids[0]?.price ?? 0;
  const venueAsk = bookAtQuote.asks[0]?.price ?? 1;
  for (const t of prints) {
    if (t.ts <= quotedAt) continue;
    if (quote.bid && bidLeft > 0 && t.side === "sell") {
      const improves = quote.bid.price > venueBid + 1e-9;
      const hit = improves ? t.price <= quote.bid.price + 1e-9 : t.price < quote.bid.price - 1e-9;
      if (hit) {
        const size = Math.min(bidLeft, t.size);
        bidLeft -= size;
        fills.push({ marketId: quote.marketId, category, ts: t.ts, dir: 1, price: quote.bid.price, size });
      }
    }
    if (quote.ask && askLeft > 0 && t.side === "buy") {
      const improves = quote.ask.price < venueAsk - 1e-9;
      const hit = improves ? t.price >= quote.ask.price - 1e-9 : t.price > quote.ask.price + 1e-9;
      if (hit) {
        const size = Math.min(askLeft, t.size);
        askLeft -= size;
        fills.push({ marketId: quote.marketId, category, ts: t.ts, dir: -1, price: quote.ask.price, size });
      }
    }
  }
  return fills;
}

/**
 * Signed worst-case dollars at risk: a long YES position can lose shares x price,
 * a short can lose shares x (1 - price). Marking a short long-shot at its (small)
 * price would hide almost all of its risk.
 */
export const atRiskUsd = (shares: number, price: number) => (shares >= 0 ? shares * price : shares * (1 - price));

export interface PositionState {
  marketId: string;
  category: string;
  /** Signed YES shares. */
  shares: number;
  /** Cash spent on YES (negative when net seller). */
  cost: number;
  volumeUsd: number;
  fills: number;
  /** Spread captured vs fair at fill time, USD. */
  edgeUsd: number;
  settled: boolean;
}

export class Portfolio {
  readonly positions = new Map<string, PositionState>();
  realizedUsd = 0;

  get(marketId: string, category = "Other"): PositionState {
    let p = this.positions.get(marketId);
    if (!p) {
      p = { marketId, category, shares: 0, cost: 0, volumeUsd: 0, fills: 0, edgeUsd: 0, settled: false };
      this.positions.set(marketId, p);
    }
    return p;
  }

  apply(fill: Fill, fairAtFill: number) {
    const p = this.get(fill.marketId, fill.category);
    p.shares += fill.dir * fill.size;
    p.cost += fill.dir * fill.size * fill.price;
    p.volumeUsd += fill.size * fill.price;
    p.fills += 1;
    p.edgeUsd += fill.dir * (fairAtFill - fill.price) * fill.size;
  }

  /** Mark-to-model PnL for one market. */
  pnl(marketId: string, fair: number): number {
    const p = this.positions.get(marketId);
    return p ? p.shares * fair - p.cost : 0;
  }

  settle(marketId: string, outcome: number) {
    const p = this.positions.get(marketId);
    if (!p || p.settled) return;
    this.realizedUsd += p.shares * outcome - p.cost;
    p.settled = true;
  }

  exposureUsd(fairOf: (id: string) => number): { gross: number; byCategory: Map<string, number> } {
    let gross = 0;
    const byCategory = new Map<string, number>();
    for (const p of this.positions.values()) {
      if (p.settled) continue;
      const usd = Math.abs(atRiskUsd(p.shares, fairOf(p.marketId)));
      gross += usd;
      byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + usd);
    }
    return { gross, byCategory };
  }
}
