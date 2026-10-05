// Run Longtail's quoting engine with real orders on Hyperliquid HIP-4 *testnet*.
// Testnet USDC has no value. Without funds (or with --dry-run) nothing is sent.
// Usage: node packages/engine/src/cli/hip4-testnet.ts [markets=12] [cycleSec=60] [--dry-run] [--once]
import { mkdirSync, writeFileSync } from "node:fs";
import { Hip4, HL_TESTNET_INFO, mapLimit, spread, type Market } from "@longtail/core";
import { forecastMarket } from "../forecast.ts";
import { makeQuote } from "../quoter.ts";
import { decide, DEFAULT_RISK } from "../risk.ts";
import { assessRules } from "../rules.ts";
import { Hip4Executor, type PlacedOrder } from "../live/hip4-executor.ts";

const args = process.argv.slice(2);
const [nArg = "12", cycleArg = "60"] = args.filter((a) => /^\d+$/.test(a));
const pk = process.env.KEEPER_PRIVATE_KEY as `0x${string}` | undefined;
if (!pk) throw new Error("KEEPER_PRIVATE_KEY is not set");

const venue = new Hip4(HL_TESTNET_INFO);
// Size to the account: each quoted market commits up to two orders of SIDE_USD (Hyperliquid's
// minimum notional is $10). USDC held in our own resting orders counts, since each cycle cancels first.
const SIDE_USD = 11;
const exec0 = new Hip4Executor({ privateKey: pk, testnet: true, maxSideUsd: SIDE_USD, dryRun: true });
const balance = await exec0.usdcBalance(true).catch(() => 0);
const dryRun = args.includes("--dry-run") || balance < 2 * SIDE_USD;
const maxMarkets = dryRun ? Number(nArg) : Math.min(Number(nArg), Math.floor((balance * 0.95) / (2 * SIDE_USD)));
const exec = new Hip4Executor({ privateKey: pk, testnet: true, maxSideUsd: SIDE_USD, minOrderUsd: 10, dryRun });
console.log(`keeper ${exec.address} · testnet spot USDC ${balance.toFixed(2)} · ${dryRun ? "DRY RUN (no orders sent)" : `placing testnet orders on up to ${maxMarkets} markets`}`);

// Testnet books are thin and mostly price binaries; pick live ones with a book on at least one side.
const all = await venue.listMarkets();
const withBooks = (
  await mapLimit(all.slice(0, 200), 8, async (m) => {
    const b = await venue.getBook(m).catch(() => null);
    return b && (b.bids.length || b.asks.length) ? m : null;
  })
).filter((m): m is Market => m !== null);
// Testnet outcomes often carry no end date; treat them as a month out so lock-up limits apply sanely.
const universe = withBooks.slice(0, Number(nArg)).map((m) => ({ ...m, endTime: m.endTime ?? Date.now() + 30 * 86_400_000 }));
console.log(`${all.length} testnet outcome markets, ${withBooks.length} with a book, quoting ${universe.length}`);

mkdirSync("data", { recursive: true });
const startedAt = Date.now();
const log: { t: number; placed: PlacedOrder[]; cancelled: number }[] = [];
let cycles = 0;

for (;;) {
  const now = Date.now();
  const cancelled = await exec.cancelAll().catch(() => 0);
  const placed: PlacedOrder[] = [];
  for (const m of universe) {
    if (new Set(placed.filter((p) => p.status === "resting" || p.status === "dry-run").map((p) => p.marketId)).size >= maxMarkets) break;
    const [book, trades] = await Promise.all([venue.getBook(m), venue.getTrades(m)]);
    const f = await forecastMarket(m, book, trades, [], now);
    // Testnet demo: the regime filter is off because testnet only lists price binaries.
    const d = decide({ ...m, acceptingOrders: true }, f, assessRules(m), 0, 0, null, { position: 0, marketPnl: 0, categoryUsd: 0, grossUsd: 0 }, now, { ...DEFAULT_RISK, allowLive: true, minFair: 0.02, maxFair: 0.98 });
    if (!d.quote) continue;
    const q = makeQuote(m, book, f, 0, d, { baseUsd: 20, minHalfSpread: 0.01, sigmaMult: 1, skewPer100Usd: 0.02 });
    const orders = exec.ordersFor(m.id, q).map((o) => ({ ...o, question: m.question, venueSpread: spread(book) }));
    placed.push(...(await exec.place(orders).catch((e) => orders.map((o) => ({ ...o, status: `error: ${String(e).slice(0, 80)}` })))));
  }
  cycles++;
  log.push({ t: now, placed, cancelled });
  // Each CI cycle is a fresh process, so report every fill since the keeper first traded, not since this run.
  const fills = dryRun ? [] : await exec.fills(0).catch(() => []);
  const bal = dryRun ? balance : await exec.usdcBalance(true).catch(() => balance);
  writeFileSync(
    "data/hip4-testnet.json",
    JSON.stringify({ address: exec.address, network: "hyperliquid-testnet", dryRun, startedAt, updatedAt: Date.now(), cycles, usdc: bal, markets: universe.map((m) => ({ id: m.id, question: m.question })), lastOrders: placed, fills, recent: log.slice(-20) }, null, 2),
  );
  const ok = placed.filter((p) => p.status === "resting" || p.status === "dry-run").length;
  console.log(`[${new Date().toISOString().slice(11, 19)}] cycle ${cycles}: ${ok}/${placed.length} orders ${dryRun ? "simulated" : "resting"}, cancelled ${cancelled}, fills ${fills.length}`);
  if (args.includes("--once")) break;
  await new Promise((r) => setTimeout(r, Number(cycleArg) * 1000));
}
