// Replay the strategy against resolved long-tail Polymarket markets, sampled evenly
// across the last N weeks so the sample isn't dominated by whatever resolved today.
// Usage: node packages/engine/src/cli/backtest.ts [weeks=26] [perWeek=25] [minVol=1000] [maxVol=150000]
import { mkdirSync, writeFileSync } from "node:fs";
import { mapLimit, Polymarket, type ResolvedMarket } from "@longtail/core";
import { infoRegime } from "../rules.ts";
import { replayMarket, summarize, type ReplayInput } from "../replay.ts";
import { DEFAULT_RISK } from "../risk.ts";

const [weeks = "26", perWeek = "25", minVol = "1000", maxVol = "150000"] = process.argv.slice(2);
const pm = new Polymarket();
const DAY = 86_400_000;
const now = Date.now();

const windows = Array.from({ length: Number(weeks) }, (_, i) => ({ endFrom: now - (i + 1) * 7 * DAY, endTo: now - i * 7 * DAY }));
const perWindow = await mapLimit(windows, 3, (w) =>
  pm.listResolved(Number(perWeek) * 4, Number(minVol), Number(maxVol), w).catch(() => [] as ResolvedMarket[]),
);
const all = perWindow.flatMap((xs) => xs.filter((r) => r.startedAt !== null && r.resolvedAt - r.startedAt > 7 * DAY).slice(0, Number(perWeek)));
const live = all.filter((r) => infoRegime(r.market) === "live").length;
console.log(`sampled ${all.length} resolved markets over ${weeks} weeks ($${minVol}-$${maxVol} lifetime volume, >7 days listed); ${live} live-information`);

let done = 0;
const inputs = (
  await mapLimit(all, 6, async (r): Promise<ReplayInput | null> => {
    try {
      const start = r.startedAt ?? r.resolvedAt - 30 * DAY;
      const [trades, history] = await Promise.all([pm.getTrades(r.market, 0, 3000), pm.getHistory(r.market, start, r.resolvedAt)]);
      if (++done % 50 === 0) console.log(`  fetched ${done}/${all.length}`);
      return trades.length ? { market: r.market, outcome: r.outcome, resolvedAt: r.resolvedAt, trades, history } : null;
    } catch {
      return null;
    }
  })
).filter((x): x is ReplayInput => x !== null);
console.log(`with trade history: ${inputs.length}`);

const arms = {
  guarded: inputs.map((i) => replayMarket(i)),
  guardedWithLive: inputs.map((i) => replayMarket(i, { risk: { ...DEFAULT_RISK, allowLive: true } })),
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
console.log("wrote data/backtest.json");
