import type { Market } from "@longtail/core";

/**
 * Resolution-risk score in [0, 1]. High means the market is a bad place to provide
 * liquidity: vague or discretionary resolution, or an outcome a small group of
 * insiders can know (or decide) before everyone else.
 */
export interface RuleAssessment {
  score: number;
  reasons: string[];
}

const VAGUE = [
  /\bsubstantial(ly)?\b/i,
  /\bsignificant(ly)?\b/i,
  /\bcredible (report|source)/i,
  /\bconsensus of\b/i,
  /\bat (the|its) (sole )?discretion\b/i,
  /\bwidely reported\b/i,
  /\bofficially (announce|confirm)/i,
  /\bmay be (resolved|clarified)\b/i,
  /\bin the spirit of\b/i,
];

// Outcomes a handful of people control or learn first. Liquidity here mostly pays insiders.
const INSIDER = [
  /\b(say|says|mention|tweet|post)s?\b.*\b(during|in|on)\b/i,
  /\bannounce\b/i,
  /\b(sign|hire|fire|appoint|nominate|resign)s?\b/i,
  /\b(release|launch) date\b/i,
  /\b(trailer|album|song|episode)\b/i,
  /\bwins? (the )?([\w'\- ]+ )?(award|oscar|grammy|emmy|nobel|medal|prize|ballon d'or|mvp|trophy)\b/i,
  /\b(named|selected|chosen) (as )?(the )?([\w ]+ )?(person of the year|ceo|coach|host|pick)\b/i,
  /\b(acquire|merger|lawsuit|settle)s?\b/i,
];

// Settled mechanically from a public price or official statistic.
const OBJECTIVE_SOURCE = /(chainlink|pyth|binance|coinbase|hypercore|bls\.gov|federalreserve|official (score|result)|espn|nba\.com|nfl\.com|fifa|uefa|mlb\.com)/i;

/**
 * "live": the outcome is driven by data that streams in real time (a match in play,
 * today's temperature, a price at expiry). Someone watching the feed always beats a
 * resting quote, so these markets are off-limits. "slow": information arrives as
 * discrete news, where a forecasting model plus wide quotes can hold its own.
 */
export type InfoRegime = "live" | "slow";

const LIVE_CATEGORIES = /^(sports|tennis|soccer|football|basketball|baseball|hockey|nba|nfl|mlb|nhl|mma|ufc|boxing|cricket|golf|f1|formula 1|esports|cs2|counter-strike|league of legends|dota|valorant|weather|temperature)$/i;
const LIVE_QUESTION = [
  /\bup or down\b/i,
  /\b(highest|lowest) temperature\b/i,
  /\b(handicap|spread|over\/under|o\/u|total (points|goals|games|rounds|kills|maps))\b/i,
  /\b(map|game|set|half|quarter|inning|round) \d\b/i,
  /\bvs\.?\b/i,
  /\bprice of (bitcoin|ethereum|solana|btc|eth|sol)\b.*\b(at|on)\b/i,
  /\b(above|below|between) \$?[\d,.]+k?\b.*\b(on|at) [A-Z][a-z]+ \d{1,2}\b/i,
];

export function infoRegime(m: Market): InfoRegime {
  if (LIVE_CATEGORIES.test(m.category.trim())) return "live";
  if (m.venue === "hip4" && /≥|touches/.test(m.question)) return "live";
  return LIVE_QUESTION.some((r) => r.test(m.question)) ? "live" : "slow";
}

export function assessRules(m: Market): RuleAssessment {
  const text = `${m.question}\n${m.rules}`;
  const reasons: string[] = [];
  let score = 0;

  const vague = VAGUE.filter((r) => r.test(text));
  if (vague.length) {
    score += Math.min(0.4, 0.15 * vague.length);
    reasons.push(`vague terms: ${vague.map((r) => r.source.replace(/\\b|\(|\)|\?/g, "")).join(", ")}`);
  }
  const insider = INSIDER.filter((r) => r.test(m.question));
  if (insider.length) {
    score += 0.35;
    reasons.push("outcome knowable or decidable by insiders");
  }
  const objective = OBJECTIVE_SOURCE.test(`${m.resolutionSource} ${m.rules}`);
  if (objective) {
    score -= 0.2;
    reasons.push("objective resolution source");
  } else if (!m.resolutionSource) {
    score += 0.1;
    reasons.push("no explicit resolution source");
  }
  if (m.rules.length < 80) {
    score += 0.15;
    reasons.push("rules too short to be unambiguous");
  }
  return { score: Math.max(0, Math.min(1, score)), reasons };
}
