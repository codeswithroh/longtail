import { getJson } from "./net.ts";

const API = "https://api.elections.kalshi.com/trade-api/v2";

/** Read-only Kalshi market snapshot (combination markets excluded). */
export interface KalshiMarket {
  ticker: string;
  eventTicker: string;
  title: string;
  bid: number | null;
  ask: number | null;
  volume24h: number;
  closeTime: number | null;
}

interface Raw {
  ticker: string;
  event_ticker: string;
  title: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  volume_24h_fp?: string;
  close_time?: string;
}

const num = (s: string | undefined) => (s ? Number(s) : 0);

export class Kalshi {
  async listOpen(onPage?: (n: number) => void): Promise<KalshiMarket[]> {
    const out: KalshiMarket[] = [];
    for (let cursor = ""; ; ) {
      const page = await getJson<{ markets: Raw[]; cursor?: string }>(`${API}/markets?status=open&limit=1000&mve_filter=exclude&cursor=${cursor}`, { retries: 4, timeoutMs: 60_000 });
      for (const m of page.markets) {
        const bid = num(m.yes_bid_dollars);
        const ask = num(m.yes_ask_dollars);
        out.push({
          ticker: m.ticker,
          eventTicker: m.event_ticker,
          title: m.title,
          bid: bid > 0 ? bid : null,
          ask: ask > 0 && ask < 1 ? ask : null,
          volume24h: num(m.volume_24h_fp),
          closeTime: m.close_time ? Date.parse(m.close_time) : null,
        });
      }
      onPage?.(out.length);
      cursor = page.cursor ?? "";
      if (!cursor || page.markets.length === 0) break;
    }
    return out;
  }
}
