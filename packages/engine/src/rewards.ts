import type { Book, Level } from "@longtail/core";
import type { Quote } from "./quoter.ts";

/** Polymarket liquidity-reward config for one market (from /rewards/markets/current). */
export interface RewardConfig {
  /** USDC paid per day across all makers. */
  daily: number;
  /** Max distance from the adjusted midpoint that still scores, in cents. */
  maxSpread: number;
  /** Orders smaller than this (shares) don't score. */
  minSize: number;
}

const C = 3; // single-sided scaling factor, "currently 3.0 on all markets"

/** S(v, s) = ((v - s) / v)^2, with v and s in cents. */
export const orderScore = (vCents: number, sCents: number) => (sCents >= vCents ? 0 : ((vCents - sCents) / vCents) ** 2);

/** Midpoint of the best levels that meet the size cutoff. */
export function adjustedMid(book: Book, minSize: number): number | null {
  const bid = book.bids.find((l) => l.size >= minSize)?.price;
  const ask = book.asks.find((l) => l.size >= minSize)?.price;
  return bid === undefined || ask === undefined ? null : (bid + ask) / 2;
}

function sideScore(levels: Level[], mid: number, cfg: RewardConfig): number {
  let q = 0;
  for (const l of levels) {
    if (l.size < cfg.minSize) continue;
    q += orderScore(cfg.maxSpread, Math.abs(mid - l.price) * 100) * l.size;
  }
  return q;
}

export function qMin(qOne: number, qTwo: number, mid: number): number {
  if (mid >= 0.1 && mid <= 0.9) return Math.max(Math.min(qOne, qTwo), Math.max(qOne / C, qTwo / C));
  return Math.min(qOne, qTwo);
}

/**
 * Our expected share of a market's liquidity rewards for one sample.
 *
 * The rest of the book is treated as a single competitor. Summing everyone else's
 * per-maker Qmin can only be <= the Qmin of their combined orders, so this overstates
 * competition and understates our share.
 */
export function rewardShare(quote: Quote, book: Book, cfg: RewardConfig): { share: number; ourQ: number; otherQ: number; mid: number | null } {
  // Once posted, our orders are part of the book the midpoint is measured from.
  const withOurs: Book = {
    ...book,
    bids: [...book.bids, ...(quote.bid ? [quote.bid] : [])].sort((a, b) => b.price - a.price),
    asks: [...book.asks, ...(quote.ask ? [quote.ask] : [])].sort((a, b) => a.price - b.price),
  };
  const mid = adjustedMid(withOurs, cfg.minSize);
  if (mid === null) return { share: 0, ourQ: 0, otherQ: 0, mid };
  const ours = sideScore(quote.bid ? [quote.bid] : [], mid, cfg);
  const oursAsk = sideScore(quote.ask ? [quote.ask] : [], mid, cfg);
  const ourQ = qMin(ours, oursAsk, mid);
  const otherQ = qMin(sideScore(book.bids, mid, cfg), sideScore(book.asks, mid, cfg), mid);
  return { share: ourQ + otherQ > 0 ? ourQ / (ourQ + otherQ) : 0, ourQ, otherQ, mid };
}

/** Expected rewards (USDC) accrued while a quote rests for `ms`. */
export const rewardAccrual = (share: number, cfg: RewardConfig, ms: number) => cfg.daily * share * (ms / 86_400_000);
