// Out-of-sample test of the Claude agent on markets that resolved after the model's
// training cutoff. No web search (it would leak outcomes); the agent sees only what a
// trader saw 7 days before resolution: rules, end date and the market price then.
// Usage: node packages/engine/src/cli/eval-llm.ts [maxMarkets=250] [cutoff=2026-07-15]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { mapLimit } from "@longtail/core";
import { applyCalibration, brier, type CalibrationCurve } from "../calibration.ts";
import { replayMarket, type ReplayInput } from "../replay.ts";
import { infoRegime } from "../rules.ts";
import { TRIAGE } from "../llm.ts";

const [maxArg = "250", cutoffArg = "2026-07-15"] = process.argv.slice(2);
const DAY = 86_400_000;
const cutoff = Date.parse(cutoffArg);
const MODEL = process.env.LONGTAIL_LLM_MODEL ?? "claude-opus-5-5";

const Schema = z.object({
  probability: z.number().min(0).max(1),
  insider_risk: z.number().min(0).max(1),
  resolution_clarity: z.number().min(0).max(1),
  rationale: z.string(),
});

const SYSTEM = `You are a forecasting analyst pricing binary prediction markets for a market maker. You will be told the date the forecast is made. Use only what could have been known on that date; do not use knowledge of later events. Estimate the probability the market resolves YES under its own rules, starting from a base rate and adjusting for the specifics. Treat the market price as informative but not authoritative; thin markets are often stale.

Also assess, for the market maker:
- resolution_clarity: 1 if the rules settle mechanically from a named public source, 0 if they leave room for judgment.
- insider_risk: how likely a small group (a committee, a company, one person) knows or decides the outcome before the public. Jury awards, product announcements, personnel decisions and "will X say Y" markets are high; scheduled public statistics and elections are low.

Be calibrated. Avoid 0 and 1.`;

const inputs = JSON.parse(readFileSync("data/backtest-inputs.json", "utf8")) as ReplayInput[];
const curve = existsSync("data/calibration.json") ? (JSON.parse(readFileSync("data/calibration.json", "utf8")) as CalibrationCurve) : null;
const sample = inputs
  .filter((i) => i.resolvedAt >= cutoff && infoRegime(i.market) === "slow")
  .map((i) => ({ i, asOf: i.resolvedAt - 7 * DAY, price: i.history.filter((p) => p.ts <= i.resolvedAt - 7 * DAY).at(-1)?.price }))
  .filter((x) => x.price !== undefined && x.price > 0.01 && x.price < 0.99)
  .slice(0, Number(maxArg));
console.log(`${sample.length} slow-information markets resolved after ${cutoffArg} with a price 7 days out`);

const client = new Anthropic();
let cost = { input: 0, output: 0, cacheRead: 0 };
let done = 0;
const results = await mapLimit(sample, 6, async ({ i, asOf, price }) => {
  const user = [
    `Forecast date: ${new Date(asOf).toISOString().slice(0, 10)}`,
    `Question: ${i.market.question}`,
    `Resolution rules:\n${i.market.rules || "(none published)"}`,
    `Market ends: ${i.market.endTime ? new Date(i.market.endTime).toISOString().slice(0, 10) : "unknown"}`,
    `Market price on the forecast date: ${price!.toFixed(3)}`,
  ].join("\n\n");
  try {
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }],
      output_config: { effort: "low", format: betaZodOutputFormat(Schema) },
      messages: [{ role: "user", content: user }],
    });
    cost.input += res.usage.input_tokens;
    cost.output += res.usage.output_tokens;
    cost.cacheRead += res.usage.cache_read_input_tokens ?? 0;
    if (++done % 25 === 0) console.log(`  ${done}/${sample.length}`);
    if (res.stop_reason === "refusal" || !res.parsed_output) return null;
    return { id: i.market.id, question: i.market.question, outcome: i.outcome, price: price!, ...res.parsed_output };
  } catch (e) {
    console.log(`  failed: ${String(e).slice(0, 120)}`);
    return null;
  }
});
const ok = results.filter((r): r is NonNullable<typeof r> => r !== null);

// Forecast skill on the same markets.
const score = (f: (r: (typeof ok)[number]) => number) => brier(ok.map((r) => ({ p: f(r), y: r.outcome })));
const brierMarket = score((r) => r.price);
const brierCalibrated = score((r) => applyCalibration(curve, r.price));
const brierLlm = score((r) => r.probability);
const brierBlend = score((r) => 0.5 * r.probability + 0.5 * applyCalibration(curve, r.price));

// Triage: did the markets the agent flags actually cost the strategy money?
const byId = new Map(sample.map((x) => [x.i.market.id, x.i]));
const flagged = (r: (typeof ok)[number]) => r.insider_risk > TRIAGE.maxInsiderRisk || r.resolution_clarity < TRIAGE.minResolutionClarity;
const pnlOf = (r: (typeof ok)[number]) => replayMarket(byId.get(r.id)!, { calibration: curve }).pnlUsd;
const withPnl = ok.map((r) => ({ ...r, flagged: flagged(r), pnlUsd: pnlOf(r) }));
const sum = (xs: typeof withPnl) => xs.reduce((a, r) => a + r.pnlUsd, 0);
const flaggedRows = withPnl.filter((r) => r.flagged);
const keptRows = withPnl.filter((r) => !r.flagged);

const report = {
  generatedAt: new Date().toISOString(),
  model: MODEL,
  cutoff: cutoffArg,
  markets: ok.length,
  forecast: { brierMarket, brierCalibrated, brierLlm, brierBlend },
  triage: {
    thresholds: TRIAGE,
    flagged: { markets: flaggedRows.length, pnlUsd: sum(flaggedRows) },
    kept: { markets: keptRows.length, pnlUsd: sum(keptRows) },
  },
  usage: cost,
  rows: withPnl,
};
writeFileSync("data/llm-eval.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
