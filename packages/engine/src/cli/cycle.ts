// One engine cycle for scheduled runners: load state, quote, save, exit.
// Usage: node packages/engine/src/cli/cycle.ts [--llm]
import { existsSync, readFileSync } from "node:fs";
import type { Market } from "@longtail/core";
import { LiveEngine } from "../live/engine.ts";

const engine = new LiveEngine({ llm: process.argv.includes("--llm"), llmPerCycle: 6 });
engine.load();
if (existsSync("data/universe.json")) engine.setUniverse(JSON.parse(readFileSync("data/universe.json", "utf8")) as Market[]);
const s = await engine.cycle();
engine.appendTimeline(s);
engine.save();
console.log(JSON.stringify({ cycle: s.cycles, quoting: s.quoting, markets: s.markets, fills: s.fills, pnlUsd: s.pnlUsd, rewardsUsd: s.rewardsUsd, llm: s.llm }));
