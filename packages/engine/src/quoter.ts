import type { Book, Market } from "@longtail/core";
import type { Forecast } from "./forecast.ts";
import type { RiskDecision } from "./risk.ts";

export interface QuoteConfig {
  /** USD notional per side at full size. */
  baseUsd: number;
  /** Floor on half-spread, prob points. */
  minHalfSpread: number;
  /** Half-spread per unit of forecast sigma. */
  sigmaMult: number;
  /** Inventory aversion: shift in reservation price per $100 of position. */
  skewPer100Usd: number;
}

export const DEFAULT_QUOTE: QuoteConfig = { baseUsd: 25, minHalfSpread: 0.01, sigmaMult: 1.0, skewPer100Usd: 0.02 };

export interface Quote {
  marketId: string;
  bid: { price: number; size: number } | null;
  ask: { price: number; size: number } | null;
  fair: number;
  reservation: number;
  halfSpread: number;
}

const roundDown = (p: number, tick: number) => Math.floor(p / tick + 1e-9) * tick;
const roundUp = (p: number, tick: number) => Math.ceil(p / tick - 1e-9) * tick;
const fix = (p: number) => Math.round(p * 1e6) / 1e6;

/**
 * Inventory-skewed two-sided quote for a binary. Post-only: never crosses the
 * venue's opposite best, so every fill is passive.
 */
export function makeQuote(m: Market, book: Book, f: Forecast, position: number, risk: RiskDecision, cfg: QuoteConfig = DEFAULT_QUOTE): Quote {
  const tick = Math.max(m.tickSize, 0.001);
  const posUsd = position * f.fair;
  const reservation = f.fair - (cfg.skewPer100Usd * posUsd) / 100;
  const halfSpread = Math.max(cfg.minHalfSpread, cfg.sigmaMult * f.sigma) + risk.extraHalfSpread;

  let bidPx = roundDown(reservation - halfSpread, tick);
  let askPx = roundUp(reservation + halfSpread, tick);
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  if (bestAsk !== undefined && bidPx >= bestAsk) bidPx = roundDown(bestAsk - tick, tick);
  if (bestBid !== undefined && askPx <= bestBid) askPx = roundUp(bestBid + tick, tick);
  bidPx = fix(Math.max(tick, bidPx));
  askPx = fix(Math.min(1 - tick, askPx));

  const sideUsd = cfg.baseUsd * risk.sizeScale;
  const size = (px: number) => Math.max(m.minSize, Math.floor(sideUsd / Math.max(px, 0.05)));
  // Smaller size on the side that adds to inventory.
  const lean = Math.max(0.25, 1 - Math.abs(posUsd) / 200);

  const bid = risk.quote && risk.allowBid && bidPx < askPx ? { price: bidPx, size: Math.floor(size(bidPx) * (posUsd > 0 ? lean : 1)) } : null;
  const ask = risk.quote && risk.allowAsk && askPx > bidPx ? { price: askPx, size: Math.floor(size(askPx) * (posUsd < 0 ? lean : 1)) } : null;
  return { marketId: m.id, bid: bid && bid.size > 0 ? bid : null, ask: ask && ask.size > 0 ? ask : null, fair: f.fair, reservation, halfSpread };
}
