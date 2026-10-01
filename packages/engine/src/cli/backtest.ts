// Replay the strategy against resolved long-tail Polymarket markets, sampled evenly
// across the last N weeks so the sample isn't dominated by whatever resolved today.
// Usage: node packages/engine/src/cli/backtest.ts [weeks=26] [perWeek=25] [minVol=1000] [maxVol=150000]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mapLimit, Polymarket, type ResolvedMarket } from "@longtail/core";
import { infoRegime } from "../rules.ts";
import { replayMarket, summarize, type ReplayInput } from "../replay.ts";
import { applyCalibration, brier, fitCalibration } from "../calibration.ts";
import { DEFAULT_RISK } from "../risk.ts";

const [weeks = "26", perWeek = "25", minVol = "1000", maxVol = "150000"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const pm = new Polymarket();
const DAY = 86_400_000;
const now = Date.now();

const CACHE = "data/backtest-inputs.json";
let inputs: ReplayInput[];
let live = 0;
if (process.argv.includes("--cached") && existsSync(CACHE)) {
  inputs = JSON.parse(readFileSync(CACHE, "utf8")) as ReplayInput[];
  live = inputs.filter((i) => infoRegime(i.market) === "live").length;
  console.log(`loaded ${inputs.length} cached markets`);
} else {
  const windows = Array.from({ length: Number(weeks) }, (_, i) => ({ endFrom: now - (i + 1) * 7 * DAY, endTo: now - i * 7 * DAY }));
  const perWindow = await mapLimit(windows, 3, (w) =>
    pm.listResolved(Number(perWeek) * 4, Number(minVol), Number(maxVol), w).catch((e) => (console.log(`  window failed: ${String(e).slice(0, 80)}`), [] as ResolvedMarket[])),
  );
  // At most 2 outcomes per event, so one multi-outcome event can't dominate the sample.
  const perEvent = new Map<string, number>();
  const all = perWindow.flatMap((xs) =>
    xs
      .filter((r) => r.startedAt !== null && r.resolvedAt - r.startedAt > 7 * DAY)
      .filter((r) => {
        const k = r.market.eventId ?? r.market.groupId;
        const n = perEvent.get(k) ?? 0;
        perEvent.set(k, n + 1);
        return n < 2;
      })
      .slice(0, Number(perWeek)),
  );
  live = all.filter((r) => infoRegime(r.market) === "live").length;
  console.log(`sampled ${all.length} resolved markets over ${weeks} weeks ($${minVol}-$${maxVol} lifetime volume, >7 days listed); ${live} live-information`);

  let done = 0;
  inputs = (
    await mapLimit(all, 6, async (r): Promise<ReplayInput | null> => {
      try {
        const start = r.startedAt ?? r.resolvedAt - 30 * DAY;
        const [trades, history] = await Promise.all([pm.getTrades(r.market, 0, 3000), pm.getHistory(r.market, start, r.resolvedAt)]);
        if (++done % 50 === 0) console.log(`  fetched ${done}/${all.length}`);
        return trades.length ? { market: r.market, outcome: r.outcome, resolvedAt: r.resolvedAt, trades, history } : null;
      } catch (e) {
        console.log(`  fetch failed: ${String(e).slice(0, 100)}`);
        return null;
      }
    })
  ).filter((x): x is ReplayInput => x !== null);
  console.log(`with trade history: ${inputs.length}`);

  mkdirSync("data", { recursive: true });
  writeFileSync(CACHE, JSON.stringify(inputs));
}

// ---------------------------------------------------------------- walk-forward
// Fit anything learned (the calibration curve) on the older half, judge every arm on the newer half.
const byTime = [...inputs].sort((x, y) => x.resolvedAt - y.resolvedAt);
const train = byTime.slice(0, Math.floor(byTime.length / 2));
const test = byTime.slice(Math.floor(byTime.length / 2));

/** Up to 12 evenly spaced hourly prices per market, ending a day before resolution, weighted 1/n. */
function priceSamples(xs: ReplayInput[]) {
  return xs.flatMap((i) => {
    const h = i.history.filter((p) => p.ts < i.resolvedAt - DAY);
    if (h.length === 0) return [];
    const step = Math.max(1, Math.floor(h.length / 12));
    const picked = h.filter((_, k) => k % step === 0).slice(0, 12);
    return picked.map((p) => ({ p: p.price, y: i.outcome, w: 1 / picked.length }));
  });
}
const curve = fitCalibration(priceSamples(train.filter((i) => infoRegime(i.market) === "slow")));
const testSamples = priceSamples(test.filter((i) => infoRegime(i.market) === "slow"));
const calibrationReport = {
  trainMarkets: train.length,
  testMarkets: test.length,
  splitAt: new Date(test[0]?.resolvedAt ?? 0).toISOString(),
  curve: curve.points,
  brierMarket: brier(testSamples),
  brierCalibrated: brier(testSamples.map((s) => ({ p: applyCalibration(curve, s.p), y: s.y }))),
};
console.log(`calibration: Brier ${calibrationReport.brierMarket.toFixed(4)} -> ${calibrationReport.brierCalibrated.toFixed(4)} on ${testSamples.length} test samples`);

// The live engine uses a curve fitted on everything that has resolved so far.
writeFileSync("data/calibration.json", JSON.stringify(fitCalibration(priceSamples(inputs.filter((i) => infoRegime(i.market) === "slow")))));

const noDrift = { ...DEFAULT_RISK, driftSigmas: 0 };
const walk = {
  naive: test.map((i) => replayMarket(i, { naive: true })),
  riskEngine: test.map((i) => replayMarket(i, { risk: noDrift })),
  plusDriftGuard: test.map((i) => replayMarket(i)),
  plusCalibration: test.map((i) => replayMarket(i, { calibration: curve })),
};
const walkSummary = Object.fromEntries(Object.entries(walk).map(([k, v]) => [k, summarize(v)]));

// Reward break-even: what share of the available rewards turns each arm's spread PnL to zero?
const census = existsSync("data/census.json") ? (JSON.parse(readFileSync("data/census.json", "utf8")) as { rewards?: { addressableLongTail: { markets: number; dailyUsd: number } } ; polymarket: { addressableLongTail: { markets: number } } }) : null;
const rewardedShare = census?.rewards ? census.rewards.addressableLongTail.markets / Math.max(1, census.polymarket.addressableLongTail.markets) : null;
const meanDaily = census?.rewards ? census.rewards.addressableLongTail.dailyUsd / Math.max(1, census.rewards.addressableLongTail.markets) : null;
const breakeven = (s: ReturnType<typeof summarize>) =>
  rewardedShare && meanDaily && s.marketDaysQuoted > 0 && s.pnlUsd < 0 ? -s.pnlUsd / (s.marketDaysQuoted * rewardedShare * meanDaily) : 0;

const arms = {
  guarded: inputs.map((i) => replayMarket(i, { risk: noDrift })),
  guardedWithLive: inputs.map((i) => replayMarket(i, { risk: { ...noDrift, allowLive: true } })),
  naive: inputs.map((i) => replayMarket(i, { naive: true })),
};
const report = {
  generatedAt: new Date().toISOString(),
  universe: { count: inputs.length, live, weeks: Number(weeks), minVolume: Number(minVol), maxVolume: Number(maxVol) },
  assumptions: [
    "re-quote every 15 minutes using only information available at that time",
    "back-of-queue fills: only on real taker prints strictly through our price, capped at print size",
    "settled at the real resolved outcome",
    "naive arm: fixed 2c half-spread around the last price, no inventory skew, no risk limits",
  ],
  summary: Object.fromEntries(Object.entries(arms).map(([k, v]) => [k, summarize(v)])),
  walkForward: {
    ...calibrationReport,
    arms: walkSummary,
    rewards: { rewardedShare, meanDailyUsd: meanDaily, breakevenShare: Object.fromEntries(Object.entries(walkSummary).map(([k, v]) => [k, breakeven(v)])) },
  },
  markets: arms.guarded.map((g, i) => ({ ...g, regime: infoRegime(inputs[i]!.market), naivePnlUsd: arms.naive[i]!.pnlUsd, withLivePnlUsd: arms.guardedWithLive[i]!.pnlUsd })),
};
mkdirSync("data", { recursive: true });
writeFileSync("data/backtest.json", JSON.stringify(report, null, 2));
for (const [k, s] of Object.entries(report.summary)) {
  console.log(
    `${k.padEnd(16)} traded ${s.marketsTraded}/${s.markets}, ${s.fills} fills, vol $${s.volumeUsd.toFixed(0)}, edge $${s.edgeUsd.toFixed(0)}, ` +
      `PnL $${s.pnlUsd.toFixed(0)} (${(s.returnOnPeakCapital * 100).toFixed(1)}% on peak capital), win ${(s.winRate * 100).toFixed(0)}%, worst $${s.worstMarketUsd.toFixed(0)}`,
  );
}
for (const [k, v] of Object.entries(walkSummary)) {
  console.log(
    `test/${k.padEnd(16)} traded ${v.marketsTraded}/${v.markets}, edge $${v.edgeUsd.toFixed(0)}, PnL $${v.pnlUsd.toFixed(0)} (${(v.returnOnPeakCapital * 100).toFixed(1)}%), worst $${v.worstMarketUsd.toFixed(0)}, ` +
      `${v.marketDaysQuoted.toFixed(0)} mkt-days, break-even reward share ${(breakeven(v) * 100).toFixed(1)}%`,
  );
}
console.log("wrote data/backtest.json");
