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
  // A company decides these outright (limit resets, launches, pricing, product changes).
  /\b(reset|resets|rate limit|usage limit|price (cut|increase)|discontinue|rebrand)\b/i,
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

// Matched against the venue's topic tag. Sports and esports settle from public game feeds;
// weather and price markets settle from public data streams.
const LIVE_CATEGORIES = /\b(sports|nfl|cfb|ncaa|nhl|nba|mlb|wnba|mls|soccer|football|basketball|baseball|hockey|ucl|uel|uecl|epl|la liga|serie a|bundesliga|ligue 1|tennis|atp|wta|golf|pga|f1|formula 1|nascar|mma|ufc|boxing|cricket|ipl|esports|vct|valorant|val|lol|league of legends|cs2|counter-strike|dota|ppa|pickleball|weather|temperature|up or down|bitcoin|ethereum|solana|xrp|dogecoin|bnb|hype)\b/i;
const LIVE_QUESTION = [
  /\bup or down\b/i,
  // Mention markets settle on live speech or posts; someone watching the stream always wins.
  /\b(say|says|said|mention|mentions|tweet|tweets|post|posts)\b/i,
  // Reality TV: producers and live-feed viewers know the outcome before the market.
  /\b(big brother|survivor|bachelor|bachelorette|love island|the voice|american idol|dancing with the stars|masterchef|traitors|contestant|evicted|eliminated|finale)\b/i,
  // Outages and uptime settle from public status pages in real time.
  /\b(go(es)? down|outage|downtime|status page)\b/i,
  /\b(highest|lowest) temperature\b/i,
  /\b(handicap|spread|over\/under|o\/u|total (points|goals|games|rounds|kills|maps))\b/i,
  /\b(map|game|set|half|quarter|inning|round) \d\b/i,
  /\bvs\.?\b/i,
  /\bprice of (bitcoin|ethereum|solana|btc|eth|sol)\b.*\b(at|on)\b/i,
  /\b(above|below|between) \$?[\d,.]+k?\b.*\b(on|at) [A-Z][a-z]+ \d{1,2}\b/i,
  // Price thresholds on traded assets settle from a live feed.
  /\bhit \((low|high)\)/i,
  /\b(close|closes|trade|trades|settle|settles|finish|finishes) (above|below|at|over|under) \$[\d,.]+/i,
  /\((?:[A-Z]{1,5})\)/,
];

export function infoRegime(m: Market): InfoRegime {
  if (LIVE_CATEGORIES.test(m.category)) return "live";
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
    // Disqualifying on its own: no spread compensates for trading against the decider.
    score += 0.5;
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
