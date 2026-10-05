// Runs Longtail's engine on any Polymarket market, on demand: the same forecast, calibration,
// rule checks, AI triage, risk decision and quote the live engine produces every five minutes.
import { Polymarket, spread, type Market } from "@longtail/core";
import {
  applyCalibration,
  assessRules,
  decide,
  DEFAULT_RISK,
  flowImbalance,
  forecastMarket,
  infoRegime,
  LlmForecaster,
  makeQuote,
  triageRules,
  type CalibrationCurve,
  type LlmForecast,
} from "@longtail/engine";
import { readData } from "@/lib/data";

export const maxDuration = 120;

const pm = new Polymarket();
let llm: LlmForecaster | null = null;
const aiCalls = new Map<string, number[]>(); // ip -> recent AI call times (best effort, per instance)
const AI_PER_HOUR = 6;

/** polymarket.com/event/<event>/<market>, /market/<slug>, or a bare slug → candidate slugs, most specific first. */
function slugsFrom(q: string): string[] {
  const t = q.trim();
  try {
    const u = new URL(t.startsWith("http") ? t : `https://${t}`);
    if (u.hostname.endsWith("polymarket.com")) {
      const parts = u.pathname.split("/").filter(Boolean).filter((p) => !["event", "market", "markets"].includes(p));
      return [...parts].reverse();
    }
  } catch {
    /* not a URL */
  }
  return [t.replace(/^\/+|\/+$/g, "")];
}

function aiAllowed(ip: string) {
  const now = Date.now();
  const recent = (aiCalls.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= AI_PER_HOUR) return false;
  aiCalls.set(ip, [...recent, now]);
  return true;
}

async function analyze(m: Market, withAi: boolean, ip: string) {
  const now = Date.now();
  const [book, trades, history, cal] = await Promise.all([
    pm.getBook(m),
    pm.getTrades(m, now - 7 * 86_400_000, 500).catch(() => []),
    pm.getHistory(m, now - 7 * 86_400_000, now).catch(() => []),
    readData<CalibrationCurve>("calibration.json"),
  ]);

  let ai: LlmForecast | null = null;
  let aiNote: string | null = null;
  if (withAi) {
    if (!LlmForecaster.available()) aiNote = "AI agent not configured on this deployment";
    else if (!aiAllowed(ip)) aiNote = `AI limit reached (${AI_PER_HOUR} per hour); showing the engine without it`;
    else {
      llm ??= new LlmForecaster({ effort: "low", maxSearches: 3, ttlMs: 6 * 3600_000, cacheFile: "/tmp/longtail/llm-cache.json" });
      ai = await llm.analyze(m, book, trades).catch(() => null);
      if (!ai) aiNote = "The AI agent didn't return a forecast this time";
    }
  }

  const external = ai ? [{ name: "llm", forecast: async () => ({ p: ai!.probability, confidence: ai!.confidence }) }] : [];
  const raw = await forecastMarket(m, book, trades, history, now, external);
  const curve = cal?.data ?? null;
  const calibrated = curve && !ai ? applyCalibration(curve, raw.fair) : raw.fair;
  const bid = book.bids[0]?.price;
  const ask = book.asks[0]?.price;
  const tight = bid !== undefined && ask !== undefined && ask - bid <= 0.1;
  const f = { ...raw, fair: tight ? Math.min(ask!, Math.max(bid!, calibrated)) : calibrated };

  const priceAt = (t: number) => history.filter((p) => p.ts <= t).at(-1)?.price;
  const hourAgo = priceAt(now - 3600_000);
  const sixAgo = priceAt(now - 6 * 3600_000);
  const rules = triageRules(assessRules(m), ai);
  const decision = decide(
    m,
    f,
    rules,
    0,
    flowImbalance(trades, now),
    hourAgo === undefined ? null : raw.fair - hourAgo,
    { position: 0, marketPnl: 0, categoryUsd: 0, grossUsd: 0 },
    now,
    DEFAULT_RISK,
    sixAgo === undefined ? null : raw.fair - sixAgo,
  );
  const quote = decision.quote ? makeQuote(m, book, f, 0, decision) : null;
  const venueSpread = spread(book);
  const ourSpread = quote?.bid && quote?.ask ? quote.ask.price - quote.bid.price : null;

  return {
    market: { id: m.id, question: m.question, url: m.url, category: m.category, endTime: m.endTime, rules: m.rules.slice(0, 1200), volume24h: m.volume24h },
    regime: infoRegime(m),
    book: { bid: bid ?? null, ask: ask ?? null, spread: venueSpread, bids: book.bids.slice(0, 5), asks: book.asks.slice(0, 5) },
    trades: trades.length,
    signals: f.signals,
    fair: f.fair,
    sigma: f.sigma,
    calibratedFrom: curve && !ai ? raw.fair : null,
    rules,
    ai,
    aiNote,
    decision,
    quote: quote ? { bid: quote.bid, ask: quote.ask, spread: ourSpread } : null,
    improves: venueSpread != null && ourSpread != null ? ourSpread < venueSpread - 1e-9 : null,
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { q?: string; marketId?: string; ai?: boolean };
  if (!body.q?.trim()) return Response.json({ error: "Paste a Polymarket link or market slug" }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  try {
    let markets: Market[] = [];
    let closed = false;
    for (const slug of slugsFrom(body.q)) {
      const found = await pm.findBySlug(slug);
      closed ||= !!found.closed;
      markets = found;
      if (markets.length) break;
    }
    if (!markets.length) {
      const error = closed ? "That market has closed, so there's nothing left to quote. Try one that's still trading." : "No Polymarket market found for that link";
      return Response.json({ error }, { status: 404 });
    }
    const chosen = body.marketId ? markets.find((m) => m.id === body.marketId) : markets.length === 1 ? markets[0] : undefined;
    if (!chosen) {
      return Response.json({ choices: markets.slice(0, 30).map((m) => ({ id: m.id, question: m.question })) });
    }
    return Response.json(await analyze(chosen, body.ai !== false, ip));
  } catch (e) {
    return Response.json({ error: `Engine error: ${String(e).slice(0, 160)}` }, { status: 502 });
  }
}
