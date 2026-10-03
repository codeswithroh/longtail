import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Book, Market, Trade } from "@longtail/core";
import type { ExternalForecaster } from "./forecast.ts";

const ForecastSchema = z.object({
  probability: z.number().min(0).max(1).describe("Probability the market resolves YES"),
  confidence: z.number().min(0).max(1).describe("How much weight this forecast deserves relative to the market price"),
  resolution_clarity: z.number().min(0).max(1).describe("1 = rules are mechanical and unambiguous, 0 = discretionary or vague"),
  insider_risk: z.number().min(0).max(1).describe("Likelihood that a small group knows or decides the outcome before the public"),
  key_evidence: z.array(z.string()).max(5),
  rationale: z.string(),
});
export type LlmForecast = z.infer<typeof ForecastSchema>;

// Frozen so the prefix caches across thousands of calls; per-market data goes in the user turn.
const SYSTEM = `You are a forecasting analyst pricing binary prediction markets for a market maker.

For each market you get the question, the exact resolution rules, the end date, and the current order book and recent trades. Your job is to estimate the probability that the market resolves YES under its own rules (not under a looser reading of the question).

Method:
1. Read the resolution rules carefully. Note what counts, what doesn't, and the deadline.
2. Search for the most recent, decision-relevant news. Prefer primary sources (official announcements, filings, schedules, polls) over commentary.
3. Start from a sensible base rate for this kind of event, then adjust for the specific evidence.
4. Treat the market price as informative but not authoritative: thin long-tail markets are often stale or set by a single trader. Say when you disagree with it and why.
5. Be calibrated. Avoid 0 and 1; reserve values below 0.03 or above 0.97 for outcomes that are effectively settled.

Also assess two risks for the market maker:
- resolution_clarity: whether the rules settle mechanically from a named public source, or leave room for judgment.
- insider_risk: whether a small group (a committee, a company, one person) knows or decides the outcome before the public. Awards decided by juries, product announcements, personnel decisions and "will X say Y" markets are high; scheduled public statistics and elections are low.

confidence is how much a market maker should trust your probability over the current price: low when evidence is thin or the question is outside what news can inform, high when you found specific, recent, primary evidence.`;

export interface LlmForecasterOptions {
  model?: string;
  effort?: "low" | "medium" | "high";
  maxSearches?: number;
  /** Re-use a forecast for this long before paying for a new one. */
  ttlMs?: number;
  cacheFile?: string;
}

interface CacheEntry {
  at: number;
  forecast: LlmForecast;
}

function describeBook(book: Book): string {
  const side = (ls: Book["bids"]) => ls.slice(0, 3).map((l) => `${l.price.toFixed(3)} x ${Math.round(l.size)}`).join(", ") || "none";
  return `bids: ${side(book.bids)} | asks: ${side(book.asks)}`;
}

function describeTrades(trades: Trade[]): string {
  return (
    trades
      .slice(-8)
      .map((t) => `${new Date(t.ts).toISOString().slice(0, 16)}Z ${t.side} ${Math.round(t.size)} @ ${t.price.toFixed(3)}`)
      .join("\n") || "no recent trades"
  );
}

/**
 * Claude-backed forecaster with web search. Plugs into forecastMarket() as an external
 * signal; returns null (and the engine falls back to market data alone) on any failure.
 */
export class LlmForecaster implements ExternalForecaster {
  readonly name = "llm";
  private client = new Anthropic();
  private cache = new Map<string, CacheEntry>();
  private opts: Required<LlmForecasterOptions>;
  readonly last = new Map<string, LlmForecast>();
  usage = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, searches: 0 };

  constructor(opts: LlmForecasterOptions = {}) {
    this.opts = {
      model: opts.model ?? process.env.LONGTAIL_LLM_MODEL ?? "claude-opus-5-5",
      effort: opts.effort ?? (process.env.LONGTAIL_LLM_EFFORT as LlmForecasterOptions["effort"]) ?? "medium",
      maxSearches: opts.maxSearches ?? 3,
      ttlMs: opts.ttlMs ?? 6 * 3600_000,
      cacheFile: opts.cacheFile ?? "data/llm-cache.json",
    };
    if (existsSync(this.opts.cacheFile)) {
      for (const [k, v] of Object.entries(JSON.parse(readFileSync(this.opts.cacheFile, "utf8")) as Record<string, CacheEntry>)) this.cache.set(k, v);
    }
  }

  static available(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.LONGTAIL_LLM === "1");
  }

  private persist() {
    mkdirSync(dirname(this.opts.cacheFile), { recursive: true });
    writeFileSync(this.opts.cacheFile, JSON.stringify(Object.fromEntries(this.cache)));
  }

  /** Last forecast for a market if still fresh, without calling the API. */
  cached(marketId: string): LlmForecast | null {
    const hit = this.cache.get(marketId);
    return hit && Date.now() - hit.at < this.opts.ttlMs ? hit.forecast : null;
  }

  async analyze(market: Market, book: Book, recent: Trade[]): Promise<LlmForecast | null> {
    const hit = this.cache.get(market.id);
    if (hit && Date.now() - hit.at < this.opts.ttlMs) return hit.forecast;

    const user = [
      `Question: ${market.question}`,
      `Resolution rules:\n${market.rules || "(none published)"}`,
      `Resolution source: ${market.resolutionSource || "(not specified)"}`,
      `Market ends: ${market.endTime ? new Date(market.endTime).toISOString() : "unknown"}`,
      `Today: ${new Date().toISOString().slice(0, 10)}`,
      `Order book: ${describeBook(book)}`,
      `Recent trades:\n${describeTrades(recent)}`,
    ].join("\n\n");

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: user }];
    try {
      // Web search can pause a long turn; resume a few times before giving up.
      for (let turn = 0; turn < 4; turn++) {
        const res = await this.client.beta.messages.parse({
          model: this.opts.model,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }],
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: this.opts.maxSearches }],
          output_config: { effort: this.opts.effort, format: betaZodOutputFormat(ForecastSchema) },
          messages,
        });
        this.usage.calls++;
        this.usage.inputTokens += res.usage.input_tokens;
        this.usage.outputTokens += res.usage.output_tokens;
        this.usage.cacheReadTokens += res.usage.cache_read_input_tokens ?? 0;
        this.usage.searches += res.usage.server_tool_use?.web_search_requests ?? 0;

        if (res.stop_reason === "pause_turn") {
          messages.push({ role: "assistant", content: res.content });
          continue;
        }
        if (res.stop_reason === "refusal" || !res.parsed_output) return null;
        const forecast = res.parsed_output;
        this.cache.set(market.id, { at: Date.now(), forecast });
        this.last.set(market.id, forecast);
        this.persist();
        return forecast;
      }
      return null;
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) await new Promise((r) => setTimeout(r, 5_000));
      else if (!(err instanceof Anthropic.APIError)) throw err;
      return null;
    }
  }

  async forecast(market: Market, ctx: { book: Book; recent: Trade[] }) {
    const f = await this.analyze(market, ctx.book, ctx.recent);
    return f ? { p: f.probability, confidence: f.confidence } : null;
  }
}

/** Thresholds above which the agent's triage disqualifies a market outright. */
export const TRIAGE = { maxInsiderRisk: 0.3, minResolutionClarity: 0.6 };

/** Fold the agent's triage into the rule assessment the risk engine already understands. */
export function triageRules(base: { score: number; reasons: string[] }, ai: LlmForecast | null) {
  if (!ai) return base;
  const reasons = [...base.reasons];
  let score = base.score;
  if (ai.insider_risk > TRIAGE.maxInsiderRisk) {
    score = Math.max(score, 1);
    reasons.push(`AI triage: insider risk ${ai.insider_risk.toFixed(2)}`);
  }
  if (ai.resolution_clarity < TRIAGE.minResolutionClarity) {
    score = Math.max(score, 1);
    reasons.push(`AI triage: unclear resolution ${ai.resolution_clarity.toFixed(2)}`);
  }
  return { score, reasons };
}
