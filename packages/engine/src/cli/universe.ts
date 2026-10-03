// Pick the markets the live engine watches: reward-paying, slow-information, clean rules,
// some trading but too little for professional makers. Writes data/universe.json.
// Usage: node packages/engine/src/cli/universe.ts [polymarket=150] [hip4=20]
import { mkdirSync, writeFileSync } from "node:fs";
import { getJson, Hip4, Polymarket, type Market } from "@longtail/core";
import { DEFAULT_RISK } from "../risk.ts";
import { assessRules, infoRegime } from "../rules.ts";

const [nPm = "150", nHl = "20"] = process.argv.slice(2);
const now = Date.now();
mkdirSync("data", { recursive: true });

interface Row {
  condition_id: string;
  rewards_max_spread: number;
  rewards_min_size: number;
  total_daily_rate: number;
}
const rewards: Record<string, { daily: number; maxSpread: number; minSize: number }> = {};
for (let cursor = ""; ; ) {
  const page = await getJson<{ data: Row[]; next_cursor?: string }>(`https://clob.polymarket.com/rewards/markets/current?next_cursor=${cursor}`, { retries: 4 });
  for (const r of page.data) rewards[r.condition_id] = { daily: r.total_daily_rate ?? 0, maxSpread: r.rewards_max_spread, minSize: r.rewards_min_size };
  cursor = page.next_cursor ?? "";
  if (!cursor || cursor === "LTE=" || page.data.length === 0) break;
}
writeFileSync("data/pm-rewards.json", JSON.stringify(rewards));
console.log(`${Object.keys(rewards).length} reward programs`);

const eligible = (m: Market) =>
  m.acceptingOrders &&
  infoRegime(m) === "slow" &&
  assessRules(m).score <= DEFAULT_RISK.maxRuleScore &&
  m.endTime !== null &&
  m.endTime - now > 3 * 86_400_000 &&
  m.endTime - now < DEFAULT_RISK.maxDaysToEnd * 86_400_000;

const pm = new Polymarket();
const candidates = await pm.getByConditionIds(Object.keys(rewards));
console.log(`${candidates.length} open reward-paying markets`);
const ranked = candidates
  .filter((m) => eligible(m) && m.volume24h >= 20 && m.volume24h < 2_000 && (m.bestAsk ?? 1) - (m.bestBid ?? 0) >= 0.02)
  .sort((a, b) => (rewards[b.groupId]?.daily ?? 0) - (rewards[a.groupId]?.daily ?? 0) || b.volume24h - a.volume24h);
const perEvent = new Map<string, number>();
const picked: Market[] = [];
for (const m of ranked) {
  const k = m.eventId ?? m.groupId;
  if ((perEvent.get(k) ?? 0) >= 2) continue;
  perEvent.set(k, (perEvent.get(k) ?? 0) + 1);
  picked.push(m);
  if (picked.length >= Number(nPm)) break;
}
const hm = (await new Hip4().listMarkets().catch(() => [])).filter((m) => eligible({ ...m, endTime: m.endTime ?? now + 30 * 86_400_000 }));
const universe = [...picked, ...hm.slice(0, Number(nHl))];
writeFileSync("data/universe.json", JSON.stringify(universe));
console.log(`universe: ${picked.length} Polymarket + ${Math.min(hm.length, Number(nHl))} HIP-4 markets`);
