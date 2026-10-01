export type VenueId = "polymarket" | "hip4";

/** One tradeable binary outcome (the YES side). Prices are probabilities in [0, 1]. */
export interface Market {
  venue: VenueId;
  /** Venue-unique id for the YES outcome token/asset. */
  id: string;
  /** Groups outcomes that settle together (Polymarket conditionId, HIP-4 question id). */
  groupId: string;
  /** Parent event (several binaries can belong to one multi-outcome event). */
  eventId?: string;
  question: string;
  /** Plain-text resolution rules as published by the venue. */
  rules: string;
  resolutionSource: string;
  category: string;
  endTime: number | null;
  tickSize: number;
  minSize: number;
  bestBid: number | null;
  bestAsk: number | null;
  volume24h: number;
  liquidity: number;
  acceptingOrders: boolean;
  url: string;
}

export interface Level {
  price: number;
  size: number;
}

export interface Book {
  marketId: string;
  ts: number;
  bids: Level[]; // best first
  asks: Level[]; // best first
}

export interface Trade {
  marketId: string;
  ts: number;
  price: number; // YES price
  size: number;
  /** Aggressor side from the YES perspective: "buy" lifted an ask, "sell" hit a bid. */
  side: "buy" | "sell";
}

export interface PricePoint {
  ts: number;
  price: number;
}

export interface ResolvedMarket {
  market: Market;
  /** 1 if YES won, 0 if NO won, fractional for split resolutions. */
  outcome: number;
  resolvedAt: number;
  /** Lifetime traded volume, USD. */
  volume: number;
  startedAt: number | null;
}

export interface Venue {
  id: VenueId;
  listMarkets(): Promise<Market[]>;
  getBook(market: Market): Promise<Book>;
  getTrades(market: Market, sinceTs?: number): Promise<Trade[]>;
  getHistory(market: Market, startTs: number, endTs: number): Promise<PricePoint[]>;
}

export const mid = (b: Book): number | null => {
  const bid = b.bids[0]?.price;
  const ask = b.asks[0]?.price;
  if (bid === undefined || ask === undefined) return null;
  return (bid + ask) / 2;
};

export const spread = (b: Book): number | null => {
  const bid = b.bids[0]?.price;
  const ask = b.asks[0]?.price;
  return bid === undefined || ask === undefined ? null : ask - bid;
};

/** USD notional resting within `cents` of the mid on both sides. */
export function depthNear(b: Book, cents: number): number {
  const m = mid(b);
  if (m === null) return 0;
  const lo = m - cents / 100;
  const hi = m + cents / 100;
  let usd = 0;
  for (const l of b.bids) if (l.price >= lo) usd += l.price * l.size;
  for (const l of b.asks) if (l.price <= hi) usd += l.price * l.size;
  return usd;
}
