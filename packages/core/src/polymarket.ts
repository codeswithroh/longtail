import { getJson, mapLimit } from "./net.ts";
import type { Book, Level, Market, PricePoint, ResolvedMarket, Trade, Venue } from "./types.ts";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const DATA = "https://data-api.polymarket.com";
const PAGE = 100; // Gamma caps page size at 100

interface GammaTag {
  label?: string;
}
interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  description?: string;
  resolutionSource?: string;
  endDate?: string;
  closedTime?: string | null;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  bestBid?: number;
  bestAsk?: number;
  volume24hr?: number;
  liquidityNum?: number;
  orderPriceMinTickSize?: number;
  orderMinSize?: number;
  acceptingOrders?: boolean;
  enableOrderBook?: boolean;
  closed?: boolean;
  umaResolutionStatus?: string | null;
  tags?: GammaTag[];
  events?: { title?: string; slug?: string; tags?: GammaTag[] }[];
}

// Tags that describe cadence or format, not subject matter.
const NON_TOPIC_TAGS = new Set(["recurring", "hide from new", "featured", "trending", "new", "all"]);

function categoryOf(m: GammaMarket): string {
  const tags = [...(m.tags ?? []), ...(m.events?.[0]?.tags ?? [])];
  const t = tags.map((x) => x.label?.trim()).find((l) => l && !NON_TOPIC_TAGS.has(l.toLowerCase()));
  return t ?? "Other";
}

const parse = <T>(s: string | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function toMarket(m: GammaMarket): Market | null {
  const tokens = parse<string[]>(m.clobTokenIds, []);
  const yes = tokens[0];
  if (!yes) return null;
  const end = m.endDate ? Date.parse(m.endDate) : NaN;
  return {
    venue: "polymarket",
    id: yes,
    groupId: m.conditionId,
    eventId: m.events?.[0]?.slug,
    question: m.question,
    rules: m.description ?? "",
    resolutionSource: m.resolutionSource ?? "",
    category: categoryOf(m),
    endTime: Number.isFinite(end) ? end : null,
    tickSize: m.orderPriceMinTickSize ?? 0.01,
    minSize: m.orderMinSize ?? 5,
    bestBid: m.bestBid && m.bestBid > 0 ? m.bestBid : null,
    bestAsk: m.bestAsk && m.bestAsk > 0 && m.bestAsk < 1 ? m.bestAsk : null,
    volume24h: m.volume24hr ?? 0,
    liquidity: m.liquidityNum ?? 0,
    acceptingOrders: Boolean(m.acceptingOrders && m.enableOrderBook && !m.closed),
    url: `https://polymarket.com/market/${m.slug}`,
  };
}

/** The NO token id for a market, needed to translate NO-side trades into YES prices. */
const noTokens = new Map<string, string>();

export class Polymarket implements Venue {
  readonly id = "polymarket" as const;

  /** Every market that is open, has an order book, and has not passed its end date. */
  async listMarkets(onPage?: (count: number) => void): Promise<Market[]> {
    const nowIso = new Date().toISOString();
    const out: Market[] = [];
    const seen = new Set<string>();
    // Offset paging stops at ~2,000 rows; the keyset endpoint walks the full set.
    for (let cursor: string | undefined; ; ) {
      const res = await getJson<{ markets: GammaMarket[]; next_cursor?: string | null }>(
        `${GAMMA}/markets/keyset?active=true&closed=false&enableOrderBook=true&include_tag=true&end_date_min=${nowIso}&limit=500` +
          (cursor ? `&after_cursor=${encodeURIComponent(cursor)}` : ""),
      );
      let fresh = 0;
      for (const g of res.markets) {
        if (seen.has(g.id)) continue;
        seen.add(g.id);
        fresh++;
        const m = toMarket(g);
        if (!m || !m.acceptingOrders) continue;
        const no = parse<string[]>(g.clobTokenIds, [])[1];
        if (no) noTokens.set(m.id, no);
        out.push(m);
      }
      onPage?.(out.length);
      cursor = res.next_cursor ?? undefined;
      // Stop if the cursor starts replaying pages we've already seen.
      if (!cursor || res.markets.length === 0 || fresh === 0) break;
    }
    return out;
  }

  async getBook(market: Market): Promise<Book> {
    const raw = await getJson<{ timestamp: string; bids: { price: string; size: string }[]; asks: { price: string; size: string }[] }>(
      `${CLOB}/book?token_id=${market.id}`,
    );
    const lv = (xs: { price: string; size: string }[]): Level[] => xs.map((x) => ({ price: Number(x.price), size: Number(x.size) }));
    // The CLOB returns bids ascending and asks descending; normalize to best-first.
    const bids = lv(raw.bids).sort((a, b) => b.price - a.price);
    const asks = lv(raw.asks).sort((a, b) => a.price - b.price);
    return { marketId: market.id, ts: Number(raw.timestamp) || Date.now(), bids, asks };
  }

  /** Taker prints for a market, newest pages first, translated to YES prices. */
  async getTrades(market: Market, sinceTs = 0, maxTrades = 500): Promise<Trade[]> {
    const no = noTokens.get(market.id);
    const trades: Trade[] = [];
    for (let offset = 0; offset < maxTrades; offset += 500) {
      const raw = await getJson<{ asset: string; side: "BUY" | "SELL"; price: number; size: number; timestamp: number }[]>(
        `${DATA}/trades?market=${market.groupId}&limit=500&offset=${offset}&takerOnly=true`,
      );
      let older = false;
      for (const t of raw) {
        const ts = t.timestamp * 1000;
        if (ts <= sinceTs) {
          older = true;
          continue;
        }
        const isYes = t.asset === market.id;
        if (!isYes && t.asset !== no) continue;
        // Buying NO is economically selling YES at 1 - p.
        const price = isYes ? t.price : 1 - t.price;
        const side = (t.side === "BUY") === isYes ? "buy" : "sell";
        trades.push({ marketId: market.id, ts, price, size: t.size, side });
      }
      if (raw.length < 500 || older) break;
    }
    return trades.sort((a, b) => a.ts - b.ts);
  }

  /**
   * Hourly price history. The CLOB rejects long ranges at hourly fidelity, so fetch in
   * 14-day chunks; resolved markets often only keep coarse history, so fall back to
   * the full-life series at 12h fidelity.
   */
  async getHistory(market: Market, startTs: number, endTs: number): Promise<PricePoint[]> {
    const CHUNK = 14 * 86_400_000;
    const points: PricePoint[] = [];
    for (let from = Math.max(startTs, endTs - 180 * 86_400_000); from < endTs; from += CHUNK) {
      const to = Math.min(endTs, from + CHUNK);
      const raw = await getJson<{ history?: { t: number; p: number }[] }>(
        `${CLOB}/prices-history?market=${market.id}&startTs=${Math.floor(from / 1000)}&endTs=${Math.floor(to / 1000)}&fidelity=60`,
      ).catch(() => ({ history: [] }));
      for (const h of raw.history ?? []) points.push({ ts: h.t * 1000, price: h.p });
    }
    if (points.length === 0) {
      const raw = await getJson<{ history?: { t: number; p: number }[] }>(`${CLOB}/prices-history?market=${market.id}&interval=max&fidelity=720`).catch(
        () => ({ history: [] }),
      );
      for (const h of raw.history ?? []) if (h.t * 1000 >= startTs && h.t * 1000 <= endTs) points.push({ ts: h.t * 1000, price: h.p });
    }
    return points.sort((x, y) => x.ts - y.ts);
  }

  /**
   * Recently resolved binary markets with lifetime volume in [minVolume, maxVolume],
   * newest first. Used to replay the strategy against real outcomes.
   */
  async listResolved(
    limit: number,
    minVolume = 0,
    maxVolume = Number.MAX_SAFE_INTEGER,
    window?: { endFrom: number; endTo: number },
  ): Promise<ResolvedMarket[]> {
    const out: ResolvedMarket[] = [];
    const range = window ? `&end_date_min=${new Date(window.endFrom).toISOString()}&end_date_max=${new Date(window.endTo).toISOString()}` : "";
    for (let offset = 0; out.length < limit && offset < 2000; offset += PAGE) {
      const page = await getJson<(GammaMarket & { volumeNum?: number; startDate?: string })[]>(
        // Gamma 500s when sorting by close time inside a date window, so windowed queries go unsorted.
        `${GAMMA}/markets?closed=true&include_tag=true${window ? "" : "&order=closedTime&ascending=false"}&volume_num_min=${minVolume}&volume_num_max=${maxVolume}${range}&limit=${PAGE}&offset=${offset}`,
      );
      if (page.length === 0) break;
      for (const g of page) {
        if (g.umaResolutionStatus !== "resolved" || !g.closedTime || !g.enableOrderBook) continue;
        const outcomes = parse<string[]>(g.outcomes, []);
        const prices = parse<string[]>(g.outcomePrices, []).map(Number);
        const outcome = prices[0];
        if (outcomes.length !== 2 || outcome === undefined || !(outcome === 0 || outcome === 1)) continue;
        const m = toMarket(g);
        if (!m) continue;
        const no = parse<string[]>(g.clobTokenIds, [])[1];
        if (no) noTokens.set(m.id, no);
        const resolvedAt = Date.parse(g.closedTime.replace(" ", "T").replace(/\+00$/, "Z"));
        out.push({
          market: m,
          outcome,
          resolvedAt: Number.isFinite(resolvedAt) ? resolvedAt : (m.endTime ?? Date.now()),
          volume: g.volumeNum ?? 0,
          startedAt: g.startDate ? Date.parse(g.startDate) : null,
        });
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  async getBooks(markets: Market[], concurrency = 8): Promise<(Book | null)[]> {
    return mapLimit(markets, concurrency, (m) => this.getBook(m).catch(() => null));
  }
}
