import type { Market } from "@longtail/core";
import type { Forecast } from "./forecast.ts";
import { infoRegime, type RuleAssessment } from "./rules.ts";
import { atRiskUsd } from "./paper.ts";

export interface RiskConfig {
  /** Max |YES shares × fair| per market, USD. */
  maxMarketUsd: number;
  maxCategoryUsd: number;
  maxGrossUsd: number;
  /** Stop quoting a market after this realized + unrealized loss, USD. */
  maxMarketLossUsd: number;
  /** Pull all quotes this many hours before scheduled resolution. */
  pullBeforeEndHours: number;
  /** Inside this window only trades that reduce inventory are allowed. */
  reduceOnlyHours: number;
  /** Quote live-information markets (in-play sports, weather, price-at-expiry). Off by default. */
  allowLive: boolean;
  /** Don't quote markets ending further out than this (capital lock-up). */
  maxDaysToEnd: number;
  maxRuleScore: number;
  /** Toxicity (EWMA adverse markout, prob points) at which we stop quoting. */
  maxToxicity: number;
  /** A move of this many sigmas within the last hour counts as a news shock. */
  shockSigmas: number;
  /** A 6h trend of this many sigmas blocks the side that would trade into it (0 = off). */
  driftSigmas: number;
  /** Avoid the tails, where a binary is mostly a jump bet. */
  minFair: number;
  maxFair: number;
}

export const DEFAULT_RISK: RiskConfig = {
  maxMarketUsd: 150,
  maxCategoryUsd: 1_000,
  maxGrossUsd: 5_000,
  maxMarketLossUsd: 40,
  pullBeforeEndHours: 24,
  reduceOnlyHours: 72,
  allowLive: false,
  maxDaysToEnd: 120,
  maxRuleScore: 0.45,
  maxToxicity: 0.04,
  shockSigmas: 4,
  driftSigmas: 3,
  minFair: 0.04,
  maxFair: 0.96,
};

export interface Exposure {
  /** Signed YES shares held in this market. */
  position: number;
  marketPnl: number;
  categoryUsd: number;
  grossUsd: number;
}

export interface RiskDecision {
  quote: boolean;
  allowBid: boolean;
  allowAsk: boolean;
  /** Multiplies base quote size, 0..1. */
  sizeScale: number;
  /** Added to half-spread, prob points. */
  extraHalfSpread: number;
  reasons: string[];
}

export function decide(
  m: Market,
  f: Forecast,
  rules: RuleAssessment,
  toxicity: number,
  imbalance: number,
  lastHourMove: number | null,
  ex: Exposure,
  now: number,
  cfg: RiskConfig = DEFAULT_RISK,
  drift6h: number | null = null,
): RiskDecision {
  const reasons: string[] = [];
  const hoursToEnd = m.endTime === null ? Infinity : (m.endTime - now) / 3600_000;
  const stop = (r: string): RiskDecision => ({ quote: false, allowBid: false, allowAsk: false, sizeScale: 0, extraHalfSpread: 0, reasons: [...reasons, r] });

  if (!m.acceptingOrders) return stop("venue not accepting orders");
  if (!cfg.allowLive && infoRegime(m) === "live") return stop("live-information market");
  if (hoursToEnd < cfg.pullBeforeEndHours) return stop(`resolves in ${hoursToEnd.toFixed(1)}h`);
  if (m.endTime === null) return stop("no end date (capital lock-up)");
  if (hoursToEnd > cfg.maxDaysToEnd * 24) return stop(`ends in ${(hoursToEnd / 24).toFixed(0)}d (capital lock-up)`);
  if (rules.score > cfg.maxRuleScore) return stop(`resolution risk ${rules.score.toFixed(2)}: ${rules.reasons.join("; ")}`);
  if (toxicity > cfg.maxToxicity) return stop(`toxic flow (adverse markout ${(toxicity * 100).toFixed(1)}c)`);
  if (ex.marketPnl < -cfg.maxMarketLossUsd) return stop(`market loss limit ($${ex.marketPnl.toFixed(0)})`);
  if (f.fair < cfg.minFair || f.fair > cfg.maxFair) return stop(`fair ${f.fair.toFixed(3)} in the tails`);
  if (lastHourMove !== null && Math.abs(lastHourMove) > cfg.shockSigmas * Math.max(f.sigma, 0.01)) {
    return stop(`news shock: moved ${(lastHourMove * 100).toFixed(1)}c in the last hour`);
  }

  let sizeScale = 1;
  let extra = 0;
  let allowBid = true;
  let allowAsk = true;

  const posUsd = atRiskUsd(ex.position, f.fair);
  if (posUsd >= cfg.maxMarketUsd) {
    allowBid = false;
    reasons.push("long limit: offer only");
  }
  if (posUsd <= -cfg.maxMarketUsd) {
    allowAsk = false;
    reasons.push("short limit: bid only");
  }
  if (ex.categoryUsd >= cfg.maxCategoryUsd || ex.grossUsd >= cfg.maxGrossUsd) {
    // At the cap only trades that reduce exposure are allowed.
    if (ex.position >= 0) allowBid = false;
    if (ex.position <= 0) allowAsk = false;
    reasons.push("portfolio cap: reduce-only");
  }

  // Don't catch a falling knife: a sustained slide means our bid keeps getting filled
  // by sellers who know more; a sustained rise does the same to our offer.
  if (cfg.driftSigmas > 0 && drift6h !== null) {
    const band = cfg.driftSigmas * Math.max(f.sigma, 0.01);
    if (drift6h < -band && ex.position >= 0) {
      allowBid = false;
      reasons.push(`sliding ${(drift6h * 100).toFixed(1)}c/6h: no bid`);
    }
    if (drift6h > band && ex.position <= 0) {
      allowAsk = false;
      reasons.push(`rising ${(drift6h * 100).toFixed(1)}c/6h: no offer`);
    }
  }

  // Ambiguity and toxicity cost money even below the hard limits, so price them in.
  extra += 0.03 * rules.score + 0.5 * toxicity;
  sizeScale *= 1 - Math.min(0.7, rules.score + toxicity / cfg.maxToxicity / 2);

  // Lean away from one-sided taker flow: don't keep feeding the side that's being hit.
  if (Math.abs(imbalance) > 0.6) {
    extra += 0.01;
    reasons.push(`one-sided flow ${(imbalance * 100).toFixed(0)}%`);
  }
  if (hoursToEnd < cfg.reduceOnlyHours) {
    // Informed flow concentrates before resolution: only unwind from here on.
    if (ex.position >= 0) allowBid = false;
    if (ex.position <= 0) allowAsk = false;
    extra += 0.01;
    reasons.push("near resolution: reduce-only");
  }

  return { quote: allowBid || allowAsk, allowBid, allowAsk, sizeScale: Math.max(0, sizeScale), extraHalfSpread: extra, reasons };
}
