// Live paper trading in a loop. Resumes from data/engine-state.json if present.
// Usage: node packages/engine/src/cli/paper.ts [cycleSec=60] [--fresh]
import { existsSync, readFileSync } from "node:fs";
import type { Market } from "@longtail/core";
import { LiveEngine } from "../live/engine.ts";

const cycleMs = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 60) * 1000;
const engine = new LiveEngine({ llm: true, llmPerCycle: 8 });
if (process.argv.includes("--fresh") || !engine.load()) console.log("starting a fresh run");
if (!existsSync("data/universe.json")) throw new Error("run `pnpm universe` first");
engine.setUniverse(JSON.parse(readFileSync("data/universe.json", "utf8")) as Market[]);

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));
while (!stopping) {
  const t0 = Date.now();
  const s = await engine.cycle();
  engine.appendTimeline(s);
  engine.save();
  console.log(
    `[${new Date().toISOString().slice(11, 19)}] cycle ${s.cycles}: quoting ${s.quoting}/${s.markets} (+${s.settledMarkets} settled), fills ${s.fills}, ` +
      `PnL $${s.pnlUsd.toFixed(2)}, rewards $${s.rewardsUsd.toFixed(2)} (~$${s.rewardsDailyRunRateUsd.toFixed(0)}/day), ` +
      `AI ${s.llm ? `${s.llm.triaged} triaged, ${s.llm.gated} gated` : "off"} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
  );
  await new Promise((r) => setTimeout(r, Math.max(0, cycleMs - (Date.now() - t0))));
}
engine.save();
