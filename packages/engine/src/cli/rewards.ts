// Snapshot Polymarket's current liquidity-reward configs into data/pm-rewards.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { getJson } from "@longtail/core";

interface Row {
  condition_id: string;
  rewards_max_spread: number;
  rewards_min_size: number;
  total_daily_rate: number;
}
const out: Record<string, { daily: number; maxSpread: number; minSize: number }> = {};
for (let cursor = ""; ; ) {
  const page = await getJson<{ data: Row[]; next_cursor?: string }>(`https://clob.polymarket.com/rewards/markets/current?next_cursor=${cursor}`, { retries: 4 });
  for (const r of page.data) out[r.condition_id] = { daily: r.total_daily_rate ?? 0, maxSpread: r.rewards_max_spread, minSize: r.rewards_min_size };
  cursor = page.next_cursor ?? "";
  if (!cursor || cursor === "LTE=" || page.data.length === 0) break;
}
mkdirSync("data", { recursive: true });
writeFileSync("data/pm-rewards.json", JSON.stringify(out));
const daily = Object.values(out).reduce((a, r) => a + r.daily, 0);
console.log(`${Object.keys(out).length} markets pay rewards, $${daily.toFixed(0)}/day in total`);
