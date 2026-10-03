import { postJson } from "./net.ts";
import type { Book, Market, PricePoint, Trade, Venue } from "./types.ts";

const INFO = process.env.HL_INFO_URL ?? "https://api.hyperliquid.xyz/info";

interface Outcome {
  outcome: number;
  name: string;
  description: string;
  sideSpecs: { name: string }[];
  venue?: string;
}
interface Question {
  question: number;
  name: string;
  description: string;
  fallbackOutcome: number;
  namedOutcomes: number[];
  settledNamedOutcomes: number[];
}

/** HIP-4 descriptions are `key:value|key:value` strings. */
export function parseSpec(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split("|")) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

/** `20261002-0800` (UTC) -> epoch ms */
export function parseHlTime(s: string | undefined): number | null {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

const template = (name: string) => name.replace(/^template:/, "");

function describe(o: Outcome, q: Question | undefined): { question: string; category: string; end: number | null } {
  const spec = parseSpec(o.description);
  const qs = q ? parseSpec(q.description) : {};
  const t = template(o.name);
  const end =
    parseHlTime(spec.time) ??
    parseHlTime(spec.expiry) ??
    parseHlTime(spec.dateTime) ??
    parseHlTime(qs.resolutionDeadline) ??
    parseHlTime(qs.decisionDeadline) ??
    parseHlTime(qs.expiry);
  const underlying = (spec.perp ?? spec.underlying ?? qs.underlying ?? "").replace(/^perp:/, "");
  switch (t) {
    case "binaryPrice":
      return { question: `${underlying} ≥ ${spec.threshold} at ${spec.time} UTC?`, category: "Crypto & markets", end };
    case "priceTouch":
      return { question: `${underlying} touches ${spec.threshold} before ${spec.time ?? spec.expiry} UTC?`, category: "Crypto & markets", end };
    case "companyIpoConfirmed":
      return { question: `${spec.company} IPO confirmed by ${spec.dateTime}?`, category: "Business", end };
    case "Recurring Named Outcome":
    case "Recurring":
      return { question: `${qs.underlying ?? underlying} ${o.description}`, category: "Crypto & markets", end };
    case "policyRateNoChange":
    case "policyRateDecrease":
    case "policyRateIncrease": {
      const move = t === "policyRateNoChange" ? "no change" : t === "policyRateDecrease" ? "a cut" : "a hike";
      return { question: `${qs.institution ?? "Central bank"} ${qs.decisionLabel ?? "decision"}: ${move}?`, category: "Economy", end };
    }
    default: {
      const label = spec.participant ?? spec.description ?? o.description;
      const comp = qs.competition ?? qs.institution ?? q?.name ?? "";
      const cat = t.startsWith("sports") ? "Sports" : t.startsWith("policyRate") ? "Economy" : "Other";
      return { question: `${template(q?.name ?? t)}: ${label}${comp ? ` (${comp})` : ""}`, category: cat, end };
    }
  }
}

const coinOf = (m: Market) => `#${m.id}`;

export const HL_MAINNET_INFO = "https://api.hyperliquid.xyz/info";
export const HL_TESTNET_INFO = "https://api.hyperliquid-testnet.xyz/info";

export class Hip4 implements Venue {
  readonly id = "hip4" as const;
  private url: string;

  constructor(url: string = INFO) {
    this.url = url;
  }

  async listMarkets(): Promise<Market[]> {
    const meta = await postJson<{ outcomes: Outcome[]; questions: Question[] }>(this.url, { type: "outcomeMeta" });
    const qOf = new Map<number, Question>();
    for (const q of meta.questions) for (const o of [...q.namedOutcomes, q.fallbackOutcome]) qOf.set(o, q);
    const mids = await postJson<Record<string, string>>(this.url, { type: "allMids" });
    const now = Date.now();
    const out: Market[] = [];
    for (const o of meta.outcomes) {
      if (o.name === "template fallback" || o.name === "Recurring Fallback") continue;
      const q = qOf.get(o.outcome);
      const { question, category, end } = describe(o, q);
      if (end !== null && end < now) continue;
      const enc = 10 * o.outcome; // side 0 = YES
      const midPx = Number(mids[`#${enc}`]);
      out.push({
        venue: "hip4",
        id: String(enc),
        groupId: q ? `q${q.question}` : `o${o.outcome}`,
        question,
        rules: `${o.name} ${o.description}${q ? ` | ${q.name} ${q.description}` : ""}`,
        resolutionSource: parseSpec(q?.description ?? "").officialSource ?? parseSpec(o.description).priceDescription ?? "HyperCore",
        category,
        endTime: end,
        tickSize: 0.00001,
        minSize: 1,
        bestBid: null,
        bestAsk: Number.isFinite(midPx) ? null : null,
        volume24h: 0,
        liquidity: 0,
        acceptingOrders: true,
        url: `https://app.hyperliquid.xyz/trade/${encodeURIComponent(`#${enc}`)}`,
      });
    }
    return out;
  }

  async getBook(market: Market): Promise<Book> {
    const raw = await postJson<{ time: number; levels: [{ px: string; sz: string }[], { px: string; sz: string }[]] }>(this.url, {
      type: "l2Book",
      coin: coinOf(market),
    });
    const lv = (xs: { px: string; sz: string }[]) => xs.map((x) => ({ price: Number(x.px), size: Number(x.sz) }));
    return { marketId: market.id, ts: raw.time, bids: lv(raw.levels[0]), asks: lv(raw.levels[1]) };
  }

  async getTrades(market: Market, sinceTs = 0): Promise<Trade[]> {
    const raw = await postJson<{ side: "B" | "A"; px: string; sz: string; time: number }[]>(this.url, { type: "recentTrades", coin: coinOf(market) });
    return raw
      .filter((t) => t.time > sinceTs)
      .map((t) => ({ marketId: market.id, ts: t.time, price: Number(t.px), size: Number(t.sz), side: t.side === "B" ? ("buy" as const) : ("sell" as const) }))
      .sort((a, b) => a.ts - b.ts);
  }

  /** settleFraction once the outcome has settled, otherwise null. */
  async getResolution(market: Market): Promise<number | null> {
    const r = await postJson<{ settleFraction?: string } | null>(this.url, { type: "settledOutcome", outcome: Math.floor(Number(market.id) / 10) }).catch(() => null);
    return r?.settleFraction !== undefined ? Number(r.settleFraction) : null;
  }

  async getHistory(market: Market, startTs: number, endTs: number): Promise<PricePoint[]> {
    const raw = await postJson<{ t: number; c: string; n: number }[]>(this.url, {
      type: "candleSnapshot",
      req: { coin: coinOf(market), interval: "1h", startTime: startTs, endTime: endTs },
    });
    return raw.filter((c) => c.n > 0).map((c) => ({ ts: c.t, price: Number(c.c) }));
  }
}
