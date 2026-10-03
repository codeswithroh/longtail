import { describe, expect, it } from "vitest";
import type { Book, Market, Trade } from "@longtail/core";
import { combine, microprice } from "../src/forecast.ts";
import { simulateFills, Portfolio } from "../src/paper.ts";
import { makeQuote, DEFAULT_QUOTE } from "../src/quoter.ts";
import { decide, DEFAULT_RISK } from "../src/risk.ts";
import { assessRules, infoRegime } from "../src/rules.ts";
import { replayMarket } from "../src/replay.ts";

const NOW = Date.UTC(2026, 9, 1);
const HOUR = 3600_000;

const market = (over: Partial<Market> = {}): Market => ({
  venue: "polymarket",
  id: "yes1",
  groupId: "c1",
  question: "Will the EU adopt the AI Liability Directive by December 31, 2026?",
  rules: "This market resolves YES if the AI Liability Directive is formally adopted and published in the Official Journal of the European Union by Dec 31, 2026.",
  resolutionSource: "https://eur-lex.europa.eu",
  category: "Politics",
  endTime: NOW + 30 * 24 * HOUR,
  tickSize: 0.01,
  minSize: 5,
  bestBid: 0.3,
  bestAsk: 0.46,
  volume24h: 120,
  liquidity: 900,
  acceptingOrders: true,
  url: "",
  ...over,
});

const book = (bid: number, ask: number, size = 100): Book => ({ marketId: "yes1", ts: NOW, bids: [{ price: bid, size }], asks: [{ price: ask, size }] });
const trade = (price: number, side: "buy" | "sell", size = 50, dt = 60_000): Trade => ({ marketId: "yes1", ts: NOW + dt, price, side, size });
const flat = { position: 0, marketPnl: 0, categoryUsd: 0, grossUsd: 0 };

describe("forecast", () => {
  it("microprice leans toward the thinner side", () => {
    const b: Book = { marketId: "x", ts: 0, bids: [{ price: 0.4, size: 300 }], asks: [{ price: 0.5, size: 100 }] };
    expect(microprice(b)).toBeCloseTo(0.475, 3);
  });
  it("ignores books too wide to be informative", () => {
    expect(microprice(book(0.1, 0.9))).toBeNull();
  });
  it("disagreement between signals widens sigma", () => {
    const agree = combine([{ name: "a", p: 0.4, weight: 1 }, { name: "b", p: 0.41, weight: 1 }], 500, 0.1);
    const split = combine([{ name: "a", p: 0.2, weight: 1 }, { name: "b", p: 0.6, weight: 1 }], 500, 0.1);
    expect(split.sigma).toBeGreaterThan(agree.sigma);
  });
});

describe("rules and regime", () => {
  it("classifies in-play and weather markets as live", () => {
    expect(infoRegime(market({ question: "Will the highest temperature in Wellington be 16°C on October 1?", category: "Weather" }))).toBe("live");
    expect(infoRegime(market({ question: "Set Handicap: Carlos Alcaraz (-1.5) vs Alex Michelsen (+1.5)", category: "Sports" }))).toBe("live");
    expect(infoRegime(market())).toBe("slow");
  });
  it("scores insider-decidable, vague markets as risky", () => {
    const risky = market({ question: "Will Elon Musk announce a new company before November?", rules: "Resolves at the discretion of the market creator based on credible reporting.", resolutionSource: "" });
    expect(assessRules(risky).score).toBeGreaterThan(DEFAULT_RISK.maxRuleScore);
    expect(assessRules(market()).score).toBeLessThan(DEFAULT_RISK.maxRuleScore);
  });
});

describe("risk", () => {
  const f = { fair: 0.38, sigma: 0.03, signals: [] };
  const ok = { score: 0.1, reasons: [] };
  it("pulls live markets, near-expiry markets and news shocks", () => {
    expect(decide(market({ category: "Weather" }), f, ok, 0, 0, null, flat, NOW).quote).toBe(false);
    expect(decide(market({ endTime: NOW + 10 * HOUR }), f, ok, 0, 0, null, flat, NOW).quote).toBe(false);
    expect(decide(market(), f, ok, 0, 0, 0.2, flat, NOW).quote).toBe(false);
    expect(decide(market(), f, ok, 0, 0, 0.01, flat, NOW).quote).toBe(true);
  });
  it("goes reduce-only inside the pre-resolution window", () => {
    const d = decide(market({ endTime: NOW + 48 * HOUR }), f, ok, 0, 0, null, { ...flat, position: 100 }, NOW);
    expect(d.allowBid).toBe(false);
    expect(d.allowAsk).toBe(true);
  });
  it("stops at the toxicity limit", () => {
    expect(decide(market(), f, ok, DEFAULT_RISK.maxToxicity * 1.1, 0, null, flat, NOW).quote).toBe(false);
  });
});

describe("quoting", () => {
  const f = { fair: 0.38, sigma: 0.03, signals: [] };
  const go = { quote: true, allowBid: true, allowAsk: true, sizeScale: 1, extraHalfSpread: 0, reasons: [] };
  it("quotes inside a wide book on tick, around fair", () => {
    const q = makeQuote(market(), book(0.3, 0.46), f, 0, go);
    expect(q.bid!.price).toBeLessThan(0.38);
    expect(q.ask!.price).toBeGreaterThan(0.38);
    expect(Math.round(q.bid!.price * 100)).toBeCloseTo(q.bid!.price * 100, 6);
  });
  it("never crosses the venue (post-only)", () => {
    const q = makeQuote(market(), book(0.37, 0.39), { ...f, sigma: 0.001 }, 0, { ...go, extraHalfSpread: 0 }, { ...DEFAULT_QUOTE, minHalfSpread: 0 });
    expect(q.bid!.price).toBeLessThan(0.39);
    expect(q.ask!.price).toBeGreaterThan(0.37);
  });
  it("skews away from inventory", () => {
    const flatQ = makeQuote(market(), book(0.2, 0.6), f, 0, go);
    const longQ = makeQuote(market(), book(0.2, 0.6), f, 400, go);
    expect(longQ.reservation).toBeLessThan(flatQ.reservation);
  });
});

describe("paper fills", () => {
  const q = { marketId: "yes1", bid: { price: 0.35, size: 40 }, ask: { price: 0.41, size: 40 }, fair: 0.38, reservation: 0.38, halfSpread: 0.03 };
  it("fills an improving quote on prints at or through it, capped by print size", () => {
    const fills = simulateFills(q, book(0.3, 0.46), [trade(0.33, "sell", 25), trade(0.3, "sell", 100)], "Politics", NOW);
    expect(fills.map((x) => x.size)).toEqual([25, 15]);
    expect(fills.every((x) => x.dir === 1 && x.price === 0.35)).toBe(true);
  });
  it("back of queue at the venue's own best: only prints strictly through fill", () => {
    const atBest = book(0.35, 0.41);
    expect(simulateFills(q, atBest, [trade(0.35, "sell"), trade(0.41, "buy")], "Politics", NOW)).toHaveLength(0);
    expect(simulateFills(q, atBest, [trade(0.34, "sell")], "Politics", NOW)).toHaveLength(1);
  });
  it("ignores prints before the quote existed", () => {
    expect(simulateFills(q, book(0.3, 0.46), [trade(0.2, "sell", 10, -1000)], "Politics", NOW)).toHaveLength(0);
  });
  it("settles PnL at the outcome", () => {
    const pf = new Portfolio();
    pf.apply({ marketId: "m", category: "c", ts: 0, dir: 1, price: 0.4, size: 100 }, 0.42);
    pf.settle("m", 1);
    expect(pf.realizedUsd).toBeCloseTo(60, 6);
  });
});

describe("replay", () => {
  it("does not trade on information from the future", () => {
    // A market that drifts up; prints only after the last step must not produce fills.
    const m = market({ endTime: NOW + 20 * 24 * HOUR });
    const trades: Trade[] = [{ marketId: "yes1", ts: NOW, price: 0.4, side: "buy", size: 50 }];
    const r = replayMarket({ market: m, outcome: 1, resolvedAt: NOW + 2 * HOUR, trades, history: [{ ts: NOW, price: 0.4 }] });
    expect(r.fills).toBe(0);
  });
});

import { orderScore, qMin, rewardShare } from "../src/rewards.ts";

describe("liquidity rewards", () => {
  it("matches Polymarket's worked example", () => {
    // mid 0.50, v = 3c: 100 bid @0.49 + 200 bid @0.48 + 100 ask(NO side) @0.51 on side one
    const qOne = orderScore(3, 1) * 100 + orderScore(3, 2) * 200 + orderScore(3, 1) * 100;
    expect(qOne).toBeCloseTo(((2 / 3) ** 2) * 200 + ((1 / 3) ** 2) * 200, 6);
    expect(orderScore(3, 3)).toBe(0);
  });
  it("needs two sides outside [0.10, 0.90]", () => {
    expect(qMin(100, 0, 0.05)).toBe(0);
    expect(qMin(90, 0, 0.5)).toBe(30);
  });
  it("splits with the rest of the book, ignoring orders under min size", () => {
    const cfg = { daily: 10, maxSpread: 4, minSize: 20 };
    const quote = { marketId: "m", bid: { price: 0.48, size: 50 }, ask: { price: 0.52, size: 50 }, fair: 0.5, reservation: 0.5, halfSpread: 0.02 };
    const thin = { marketId: "m", ts: 0, bids: [{ price: 0.4, size: 500 }, { price: 0.49, size: 5 }], asks: [{ price: 0.6, size: 500 }] };
    const r = rewardShare(quote, thin, cfg);
    expect(r.share).toBeGreaterThan(0.99); // venue orders sit outside the 4c band; the 5-share bid is below min size
  });
});

import { applyCalibration, brier, fitCalibration } from "../src/calibration.ts";

describe("calibration", () => {
  it("learns a long-shot bias and stays monotone", () => {
    // Markets priced ~0.15 resolve YES only 5% of the time; ~0.85 resolve YES 95%.
    const samples = [
      ...Array.from({ length: 400 }, (_, i) => ({ p: 0.15, y: i < 20 ? 1 : 0 })),
      ...Array.from({ length: 400 }, (_, i) => ({ p: 0.85, y: i < 380 ? 1 : 0 })),
    ];
    const c = fitCalibration(samples);
    expect(applyCalibration(c, 0.15)).toBeLessThan(0.08);
    expect(applyCalibration(c, 0.85)).toBeGreaterThan(0.9);
    for (let p = 0.05; p < 1; p += 0.1) expect(applyCalibration(c, p + 0.05)).toBeGreaterThanOrEqual(applyCalibration(c, p) - 1e-12);
  });
  it("shrinks sparse bins toward the diagonal", () => {
    const c = fitCalibration([{ p: 0.5, y: 1 }]);
    expect(applyCalibration(c, 0.5)).toBeGreaterThan(0.5);
    expect(applyCalibration(c, 0.5)).toBeLessThan(0.55);
  });
  it("scores Brier", () => {
    expect(brier([{ p: 1, y: 1 }, { p: 0, y: 0 }])).toBe(0);
    expect(brier([{ p: 0.5, y: 1 }])).toBe(0.25);
  });
});

describe("drift guard", () => {
  const f = { fair: 0.3, sigma: 0.02, signals: [] };
  const m = market();
  it("stops bidding into a slide and offering into a rise", () => {
    const flatEx = { position: 0, marketPnl: 0, categoryUsd: 0, grossUsd: 0 };
    const slide = decide(m, f, { score: 0, reasons: [] }, 0, 0, null, flatEx, NOW, DEFAULT_RISK, -0.1);
    expect(slide.allowBid).toBe(false);
    expect(slide.allowAsk).toBe(true);
    const rise = decide(m, f, { score: 0, reasons: [] }, 0, 0, null, flatEx, NOW, DEFAULT_RISK, 0.1);
    expect(rise.allowAsk).toBe(false);
  });
});

describe("price-threshold markets", () => {
  it("are live-information", () => {
    expect(infoRegime(market({ question: "Will Amazon.com, Inc. (AMZN) hit (LOW) $232 in October?", category: "Finance" }))).toBe("live");
    expect(infoRegime(market({ question: "Will Gold close above $4,000 on Friday?", category: "Finance" }))).toBe("live");
    expect(infoRegime(market({ question: "Will Revolut's valuation reach $115B by October 31?", category: "Business" }))).toBe("slow");
  });
});

import { atRiskUsd } from "../src/paper.ts";

describe("risk sizing", () => {
  it("values a short long-shot by what it can lose, not its mark", () => {
    expect(atRiskUsd(-1000, 0.05)).toBeCloseTo(-950, 6);
    expect(atRiskUsd(1000, 0.05)).toBeCloseTo(50, 6);
  });
  it("stops adding to a short long-shot once worst-case loss hits the cap", () => {
    const f = { fair: 0.05, sigma: 0.01, signals: [] };
    const d = decide(market(), f, { score: 0, reasons: [] }, 0, 0, null, { position: -500, marketPnl: 0, categoryUsd: 0, grossUsd: 0 }, NOW);
    expect(d.allowAsk).toBe(false);
  });
});

describe("live paper-trading lessons", () => {
  // These three markets caused all of the first 45h of live paper losses.
  it("excludes reality TV, mention markets and company-decided outcomes", () => {
    expect(infoRegime(market({ question: "Will Drew Campbell come in third-place on Big Brother season 28?", category: "Culture" }))).toBe("live");
    expect(infoRegime(market({ question: 'Will Trump say "Ice Cream" in October?', category: "Politics" }))).toBe("live");
    const codex = market({ question: "Will there be exactly 2 Codex weekly usage limit resets in the week of Oct 5?", category: "AI" });
    expect(assessRules(codex).score).toBeGreaterThan(DEFAULT_RISK.maxRuleScore);
    expect(infoRegime(market({ question: "Will Claude go down 8-10 times in October?", category: "AI" }))).toBe("live");
  });
});
