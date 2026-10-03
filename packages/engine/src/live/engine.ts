// The live paper engine. Every call to cycle() is self-contained: it can run in a
// long-lived loop on a laptop, or once per scheduled job with state loaded and saved
// around it. No orders are ever sent; fills are simulated against real taker prints.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Hip4, mapLimit, Polymarket, spread, type Book, type Market, type PricePoint, type Trade, type Venue } from "@longtail/core";
import { applyCalibration, type CalibrationCurve } from "../calibration.ts";
import { forecastMarket, type ExternalForecaster, type Forecast } from "../forecast.ts";
import { LlmForecaster, triageRules } from "../llm.ts";
import { Portfolio, simulateFills } from "../paper.ts";
import { makeQuote, type Quote } from "../quoter.ts";
import { rewardAccrual, rewardShare, type RewardConfig } from "../rewards.ts";
import { decide, DEFAULT_RISK, type RiskDecision } from "../risk.ts";
import { assessRules } from "../rules.ts";
import { flowImbalance, ToxicityTracker } from "../toxicity.ts";

export interface MarketState {
  market: Market;
  lastTradeTs: number;
  history: PricePoint[];
  historyAt: number;
  recent: Trade[];
  quote: Quote | null;
  quoteBook: Book | null;
  quotedAt: number;
  forecast: Forecast | null;
  decision: RiskDecision | null;
  book: { bid: number | null; ask: number | null; spread: number | null } | null;
  rewardsUsd: number;
  rewardShare: number | null;
  /** Set once the market has resolved and positions are paid out. */
  settled: { outcome: number; at: number } | null;
}

interface SavedState {
  version: 1;
  startedAt: number;
  cycles: number;
  states: MarketState[];
  portfolio: ReturnType<Portfolio["toJSON"]>;
  toxicity: ReturnType<ToxicityTracker["toJSON"]>;
  markouts: { horizonMs: number; markout: number; ts: number }[];
}

export interface EngineOptions {
  dataDir?: string;
  /** Run the Claude triage/forecast agent (needs ANTHROPIC_API_KEY). */
  llm?: boolean;
  /** Max agent calls per cycle; bounds spend when the engine runs on a schedule. */
  llmPerCycle?: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export class LiveEngine {
  readonly dir: string;
  private pm = new Polymarket();
  private hip4 = new Hip4();
  private venues: Record<string, Venue & { getResolution(m: Market): Promise<number | null> }>;
  private rewards: Record<string, RewardConfig>;
  private curve: CalibrationCurve | null;
  private llm: LlmForecaster | null;
  private llmPerCycle: number;
  private external: ExternalForecaster[];

  startedAt = Date.now();
  cycles = 0;
  states = new Map<string, MarketState>();
  pf = new Portfolio();
  tox = new ToxicityTracker();
  markouts: SavedState["markouts"] = [];

  constructor(opts: EngineOptions = {}) {
    this.dir = opts.dataDir ?? "data";
    mkdirSync(this.dir, { recursive: true });
    this.venues = { polymarket: this.pm, hip4: this.hip4 };
    this.rewards = this.readJson(`pm-rewards.json`) ?? {};
    this.curve = this.readJson<CalibrationCurve>(`calibration.json`);
    this.llm = opts.llm && LlmForecaster.available() ? new LlmForecaster({ effort: "low", maxSearches: 3, ttlMs: 48 * 3600_000, cacheFile: `${this.dir}/llm-cache.json` }) : null;
    this.llmPerCycle = opts.llmPerCycle ?? 8;
    const llm = this.llm;
    this.external = llm
      ? [
          {
            name: "llm",
            forecast: async (m: Market) => {
              const f = llm.cached(m.id);
              return f ? { p: f.probability, confidence: f.confidence } : null;
            },
          },
        ]
      : [];
  }

  private readJson<T>(file: string): T | null {
    const p = `${this.dir}/${file}`;
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
  }

  private rewardOf(m: Market) {
    return m.venue === "polymarket" ? this.rewards[m.groupId] : undefined;
  }

  private fairOf = (id: string) => this.states.get(id)?.forecast?.fair ?? 0.5;

  // ------------------------------------------------------------ persistence
  load(): boolean {
    const s = this.readJson<SavedState>("engine-state.json");
    if (!s) return false;
    this.startedAt = s.startedAt;
    this.cycles = s.cycles;
    this.states = new Map(s.states.map((x) => [x.market.id, x]));
    this.pf = Portfolio.fromJSON(s.portfolio);
    this.tox = ToxicityTracker.fromJSON(s.toxicity);
    this.markouts = s.markouts ?? [];
    return true;
  }

  /** One line per cycle, so the dashboard can chart the run over time. */
  appendTimeline(s: ReturnType<LiveEngine["snapshot"]>) {
    const row = { t: s.updatedAt, quoting: s.quoting, markets: s.markets, fills: s.fills, pnlUsd: +s.pnlUsd.toFixed(2), rewardsUsd: +s.rewardsUsd.toFixed(2), runRate: +s.rewardsDailyRunRateUsd.toFixed(1), gross: +s.grossExposureUsd.toFixed(0) };
    appendFileSync(`${this.dir}/timeline.jsonl`, JSON.stringify(row) + "\n");
  }

  save() {
    const s: SavedState = {
      version: 1,
      startedAt: this.startedAt,
      cycles: this.cycles,
      // History is re-fetched on demand; keep the saved state small.
      states: [...this.states.values()].map((x) => ({ ...x, history: x.history.slice(-72), recent: x.recent.slice(-100) })),
      portfolio: this.pf.toJSON(),
      toxicity: this.tox.toJSON(),
      markouts: this.markouts.slice(-2000),
    };
    writeFileSync(`${this.dir}/engine-state.json`, JSON.stringify(s));
  }

  /** Add markets from a universe list; never drops markets that still hold a position. */
  setUniverse(markets: Market[]) {
    for (const m of markets) {
      if (this.states.has(m.id)) continue;
      this.states.set(m.id, {
        market: m,
        lastTradeTs: Date.now(),
        history: [],
        historyAt: 0,
        recent: [],
        quote: null,
        quoteBook: null,
        quotedAt: 0,
        forecast: null,
        decision: null,
        book: null,
        rewardsUsd: 0,
        rewardShare: null,
        settled: null,
      });
    }
    const keep = new Set(markets.map((m) => m.id));
    for (const [id, s] of this.states) {
      const held = (this.pf.positions.get(id)?.shares ?? 0) !== 0;
      if (!keep.has(id) && !held && !s.settled) this.states.delete(id);
    }
  }

  // ------------------------------------------------------------ one cycle
  async cycle() {
    const now = Date.now();
    const active = [...this.states.values()].filter((s) => !s.settled);
    await mapLimit(active, 6, (s) => this.step(s, Date.now()).catch((e) => console.error(`  ${s.market.question.slice(0, 40)}: ${String(e).slice(0, 120)}`)));
    for (const m of this.tox.update(Date.now(), this.fairOf)) this.markouts.push({ horizonMs: m.horizonMs, markout: m.markout, ts: m.fill.ts });
    if (this.llm) await this.triage(this.llmPerCycle);
    this.cycles++;
    return this.snapshot(now);
  }

  /** Refresh the agent's view of the markets it hasn't seen recently, a few per cycle. */
  private async triage(limit: number) {
    const llm = this.llm!;
    const due = [...this.states.values()].filter((s) => !s.settled && !llm.cached(s.market.id)).slice(0, limit);
    await mapLimit(due, 4, (s) => llm.analyze(s.market, s.quoteBook ?? { marketId: s.market.id, ts: Date.now(), bids: [], asks: [] }, s.recent).catch(() => null));
  }

  private async settleIfResolved(s: MarketState, now: number): Promise<boolean> {
    if (s.market.endTime !== null && s.market.endTime > now) return false;
    const outcome = await this.venues[s.market.venue]!.getResolution(s.market).catch(() => null);
    if (outcome === null) return false;
    this.pf.settle(s.market.id, outcome);
    s.settled = { outcome, at: now };
    s.quote = null;
    return true;
  }

  private async step(s: MarketState, now: number) {
    if (await this.settleIfResolved(s, now)) return;
    const venue = this.venues[s.market.venue]!;
    const [book, newTrades] = await Promise.all([venue.getBook(s.market), venue.getTrades(s.market, s.lastTradeTs)]);
    if (newTrades.length) s.lastTradeTs = newTrades.at(-1)!.ts;
    s.recent = [...s.recent, ...newTrades].slice(-300);

    // 1. Rewards and fills for the quote left resting since the last cycle.
    const cfg = this.rewardOf(s.market);
    if (s.quote && s.quoteBook && cfg) {
      const r = rewardShare(s.quote, s.quoteBook, cfg);
      s.rewardShare = r.share;
      // Cap accrual at one hour per cycle so a stalled scheduler can't fake income.
      s.rewardsUsd += rewardAccrual(r.share, cfg, Math.min(now - s.quotedAt, 3600_000));
    }
    if (s.quote && s.quoteBook) {
      for (const fill of simulateFills(s.quote, s.quoteBook, newTrades, s.market.category, s.quotedAt)) {
        this.pf.apply(fill, this.fairOf(s.market.id));
        this.tox.record(fill);
        appendFileSync(`${this.dir}/fills.jsonl`, JSON.stringify({ ...fill, venue: s.market.venue, question: s.market.question }) + "\n");
      }
    }

    // 2. History feeds slow signals only; refresh every 30 minutes.
    if (now - s.historyAt > 30 * 60_000) {
      s.history = await venue.getHistory(s.market, now - 7 * 86_400_000, now).catch(() => s.history);
      s.historyAt = now;
    }

    // 3. Forecast, risk, quote.
    const raw = await forecastMarket(s.market, book, s.recent, s.history, now, this.external);
    const ai = this.llm?.cached(s.market.id) ?? null;
    // The curve is a population prior for market-implied prices; skip it when the agent has a view.
    const cal = this.curve && !ai ? applyCalibration(this.curve, raw.fair) : raw.fair;
    // A tight live book is current evidence about this market, so it still bounds fair.
    const bid = book.bids[0]?.price;
    const ask = book.asks[0]?.price;
    const tight = bid !== undefined && ask !== undefined && ask - bid <= 0.1;
    const f = { ...raw, fair: tight ? Math.min(ask!, Math.max(bid!, cal)) : cal };
    s.forecast = f;

    const pos = this.pf.get(s.market.id, s.market.category);
    const exp = this.pf.exposureUsd(this.fairOf);
    const priceAt = (t: number) => s.history.filter((p) => p.ts <= t).at(-1)?.price;
    const hourAgo = priceAt(now - 3600_000);
    const sixAgo = priceAt(now - 6 * 3600_000);
    s.decision = decide(
      s.market,
      f,
      triageRules(assessRules(s.market), ai),
      this.tox.score(s.market.id, s.market.category),
      flowImbalance(s.recent, now),
      hourAgo === undefined ? null : raw.fair - hourAgo,
      { position: pos.shares, marketPnl: this.pf.pnl(s.market.id, f.fair), categoryUsd: exp.byCategory.get(s.market.category) ?? 0, grossUsd: exp.gross },
      now,
      DEFAULT_RISK,
      sixAgo === undefined ? null : raw.fair - sixAgo,
    );
    s.quote = s.decision.quote ? makeQuote(s.market, book, f, pos.shares, s.decision, undefined, cfg ? { maxSpreadCents: cfg.maxSpread, minSize: cfg.minSize } : undefined) : null;
    s.quoteBook = book;
    s.quotedAt = now;
    s.book = { bid: bid ?? null, ask: ask ?? null, spread: spread(book) };
  }

  // ------------------------------------------------------------ dashboard snapshot
  snapshot(now: number) {
    const rows = [...this.states.values()].map((s) => {
      const p = this.pf.positions.get(s.market.id);
      const ourSpread = s.quote?.bid && s.quote?.ask ? s.quote.ask.price - s.quote.bid.price : null;
      const rc = this.rewardOf(s.market);
      const a = this.llm?.cached(s.market.id);
      return {
        id: s.market.id,
        venue: s.market.venue,
        question: s.market.question,
        category: s.market.category,
        url: s.market.url,
        endTime: s.market.endTime,
        volume24h: s.market.volume24h,
        book: s.book,
        fair: s.forecast?.fair ?? null,
        sigma: s.forecast?.sigma ?? null,
        signals: s.forecast?.signals.map((x) => ({ name: x.name, p: x.p, weight: x.weight })) ?? [],
        quote: s.quote ? { bid: s.quote.bid, ask: s.quote.ask, spread: ourSpread } : null,
        improvesSpread: ourSpread !== null && s.book?.spread != null ? ourSpread < s.book.spread : null,
        decision: s.settled ? { quote: false, reasons: [`resolved ${s.settled.outcome === 1 ? "YES" : s.settled.outcome === 0 ? "NO" : s.settled.outcome}`] } : s.decision ? { quote: s.decision.quote, reasons: s.decision.reasons } : null,
        rewards: rc ? { daily: rc.daily, maxSpread: rc.maxSpread, share: s.rewardShare, accruedUsd: s.rewardsUsd } : null,
        position: p ? { shares: p.shares, pnl: p.settled ? 0 : this.pf.pnl(s.market.id, s.forecast?.fair ?? 0.5), fills: p.fills, volumeUsd: p.volumeUsd, edgeUsd: p.edgeUsd } : null,
        rules: triageRules(assessRules(s.market), a ?? null),
        ai: a ? { p: a.probability, confidence: a.confidence, insiderRisk: a.insider_risk, clarity: a.resolution_clarity, rationale: a.rationale, evidence: a.key_evidence } : null,
        settled: s.settled,
      };
    });
    const live = rows.filter((r) => !r.settled);
    const quoted = live.filter((r) => r.quote);
    const exp = this.pf.exposureUsd(this.fairOf);
    const unreal = [...this.pf.positions.values()].filter((p) => !p.settled).reduce((a, p) => a + this.pf.pnl(p.marketId, this.fairOf(p.marketId)), 0);
    const reasons: Record<string, number> = {};
    for (const r of live) {
      if (!r.decision || r.decision.quote) continue;
      const k = (r.decision.reasons.at(-1) ?? "other").split(/[:(\d]/)[0]!.trim();
      reasons[k] = (reasons[k] ?? 0) + 1;
    }
    const summary = {
      startedAt: this.startedAt,
      updatedAt: now,
      cycles: this.cycles,
      markets: live.length,
      settledMarkets: rows.length - live.length,
      quoting: quoted.length,
      improvingSpread: live.filter((r) => r.improvesSpread).length,
      medianVenueSpread: median(live.flatMap((r) => (r.book?.spread != null ? [r.book.spread] : []))),
      medianOurSpread: median(quoted.flatMap((r) => (r.quote?.spread != null ? [r.quote.spread] : []))),
      fills: [...this.pf.positions.values()].reduce((a, p) => a + p.fills, 0),
      volumeUsd: [...this.pf.positions.values()].reduce((a, p) => a + p.volumeUsd, 0),
      edgeUsd: [...this.pf.positions.values()].reduce((a, p) => a + p.edgeUsd, 0),
      realizedUsd: this.pf.realizedUsd,
      pnlUsd: unreal + this.pf.realizedUsd,
      rewardsUsd: [...this.states.values()].reduce((a, s) => a + s.rewardsUsd, 0),
      rewardsDailyAvailableUsd: live.reduce((a, r) => a + (r.rewards?.daily ?? 0), 0),
      rewardsDailyRunRateUsd: live.reduce((a, r) => a + (r.quote && r.rewards?.share ? r.rewards.daily * r.rewards.share : 0), 0),
      grossExposureUsd: exp.gross,
      markout5m: avg(this.markouts.filter((m) => m.horizonMs === 5 * 60_000).map((m) => m.markout)),
      markout30m: avg(this.markouts.filter((m) => m.horizonMs === 30 * 60_000).map((m) => m.markout)),
      pullReasons: reasons,
      llm: this.llm ? { ...this.llm.usage, triaged: live.filter((r) => r.ai).length, gated: live.filter((r) => r.rules.reasons.some((x) => x.startsWith("AI triage"))).length } : null,
    };
    writeFileSync(`${this.dir}/paper-state.json`, JSON.stringify({ summary, markets: rows, toxicity: this.tox.snapshot() }));
    return summary;
  }
}
