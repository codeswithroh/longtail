import { connection } from "next/server";
import { ArmChart, CalibrationChart, PnlHistogram } from "@/components/charts";
import { Card, Empty, Freshness, PageHeader, Pill, Stat } from "@/components/ui";
import { readData, type ArmSummary, type Backtest, type LlmEval } from "@/lib/data";
import { int, pct, tone, usd } from "@/lib/format";

const ARMS: { key: keyof Backtest["summary"]; label: string; blurb: string }[] = [
  { key: "naive", label: "Naive", blurb: "Fixed 2¢ half-spread around the last price, both sides, no limits." },
  { key: "guardedWithLive", label: "Risk engine + live mkts", blurb: "Full risk engine, but allowed to quote live-information markets." },
  { key: "guarded", label: "Longtail", blurb: "Full risk engine, slow-information markets only." },
];

function ArmCard({ label, blurb, s }: { label: string; blurb: string; s: ArmSummary }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-[13px] font-medium">{label}</div>
        <Pill tone={s.pnlUsd >= 0 ? "gain" : "loss"}>{s.pnlUsd >= 0 ? "net positive" : "net negative"}</Pill>
      </div>
      <p className="mt-1 text-[12px] leading-snug text-muted">{blurb}</p>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <Stat label="PnL after settlement" value={usd(s.pnlUsd, { signed: true })} tone={tone(s.pnlUsd)} sub={`${pct(s.returnOnPeakCapital, 1)} on peak capital`} />
        <Stat label="Edge at fill" value={usd(s.edgeUsd, { signed: true })} tone={tone(s.edgeUsd)} sub="vs. own fair value at fill time" />
        <Stat label="Markets traded" value={`${int(s.marketsTraded)}/${int(s.markets)}`} sub={`${int(s.fills)} fills · ${usd(s.volumeUsd)} volume`} />
        <Stat label="Worst market" value={usd(s.worstMarketUsd, { signed: true })} tone={tone(s.worstMarketUsd)} sub={`${pct(s.winRate)} of traded markets profitable`} />
      </div>
    </div>
  );
}

const WF_ARMS: { key: "naive" | "riskEngine" | "plusDriftGuard" | "plusCalibration"; label: string; blurb: string }[] = [
  { key: "naive", label: "Naive", blurb: "fixed 2¢ half-spread, no limits" },
  { key: "riskEngine", label: "Risk engine", blurb: "regime filter, toxicity, limits, reduce-only" },
  { key: "plusDriftGuard", label: "+ drift guard", blurb: "no bids into slides, no offers into rises" },
  { key: "plusCalibration", label: "+ calibration", blurb: "fair value mapped through the fitted curve" },
];

function WalkForward({ w }: { w: NonNullable<Backtest["walkForward"]> }) {
  const be = w.rewards.breakevenShare;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-5">
        <Card
          title="Out of sample: newer half only"
          note={`fit on ${int(w.trainMarkets)} older markets · tested on ${int(w.testMarkets)} resolved after ${w.splitAt.slice(0, 10)}`}
          className="lg:col-span-3"
        >
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-[12px]">
              <thead className="text-left text-[11px] uppercase tracking-[0.06em] text-muted">
                <tr>
                  <th className="px-4 pb-2 font-normal">Arm</th>
                  <th className="pb-2 text-right font-normal">Traded</th>
                  <th className="pb-2 text-right font-normal">Edge at fill</th>
                  <th className="pb-2 text-right font-normal">PnL settled</th>
                  <th className="pb-2 text-right font-normal">On capital</th>
                  <th className="pb-2 text-right font-normal">Worst mkt</th>
                  <th className="px-4 pb-2 text-right font-normal">Break-even reward share</th>
                </tr>
              </thead>
              <tbody>
                {WF_ARMS.map((a) => {
                  const s = w.arms[a.key];
                  return (
                    <tr key={a.key} className="border-t border-border align-top">
                      <td className="px-4 py-2">
                        <div>{a.label}</div>
                        <div className="text-[11px] text-muted">{a.blurb}</div>
                      </td>
                      <td className="num py-2 text-right text-muted">{int(s.marketsTraded)}</td>
                      <td className={`num py-2 text-right ${tone(s.edgeUsd)}`}>{usd(s.edgeUsd, { signed: true })}</td>
                      <td className={`num py-2 text-right ${tone(s.pnlUsd)}`}>{usd(s.pnlUsd, { signed: true })}</td>
                      <td className={`num py-2 text-right ${tone(s.returnOnPeakCapital)}`}>{pct(s.returnOnPeakCapital, 1)}</td>
                      <td className={`num py-2 text-right ${tone(s.worstMarketUsd)}`}>{usd(s.worstMarketUsd, { signed: true })}</td>
                      <td className="num px-4 py-2 text-right">{s.pnlUsd >= 0 ? <span className="text-gain">not needed</span> : pct(be[a.key], 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Break-even reward share: the fraction of available liquidity rewards a strategy must collect to cover its spread PnL, using today&rsquo;s reward
            configs ({pct(w.rewards.rewardedShare)} of addressable long-tail markets pay, {usd(w.rewards.meanDailyUsd)}/day on average) and the market-days
            each arm spent quoting.
          </p>
        </Card>
        <Card title="Long-shot bias, measured" note="fitted on the older half" className="lg:col-span-2">
          <CalibrationChart points={w.curve} />
          <div className="mt-3 grid grid-cols-2 gap-4">
            <Stat label="Brier, market price" value={w.brierMarket.toFixed(4)} sub="newer-half markets" />
            <Stat label="Brier, calibrated" value={w.brierCalibrated.toFixed(4)} tone={w.brierCalibrated < w.brierMarket ? "text-gain" : "text-loss"} sub="lower is better" />
          </div>
        </Card>
      </div>
    </div>
  );
}

function AgentEval({ e }: { e: LlmEval }) {
  const f = e.forecast;
  const rows = [
    { k: "Market price", v: f.brierMarket },
    { k: "Calibrated price", v: f.brierCalibrated },
    { k: "Claude alone", v: f.brierLlm },
    { k: "Claude + calibrated", v: f.brierBlend },
  ];
  const best = Math.min(...rows.map((r) => r.v));
  const examples = e.rows.filter((r) => r.flagged).sort((a, b) => a.pnlUsd - b.pnlUsd).slice(0, 4);
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card title="The AI agent, out of sample" note={`${e.model} · ${int(e.markets)} markets resolved after ${e.cutoff} · forecasts 7 days out, no web search`} className="lg:col-span-3">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.06em] text-muted">Triage: markets the agent refused</div>
            <div className="mt-2 grid grid-cols-2 gap-4">
              <Stat label={`flagged (${int(e.triage.flagged.markets)})`} value={usd(e.triage.flagged.pnlUsd, { signed: true })} tone={tone(e.triage.flagged.pnlUsd)} sub="replay PnL it avoided" />
              <Stat label={`kept (${int(e.triage.kept.markets)})`} value={usd(e.triage.kept.pnlUsd, { signed: true })} tone={tone(e.triage.kept.pnlUsd)} sub="replay PnL it traded" />
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              Refuses a market when insider risk &gt; {e.triage.thresholds.maxInsiderRisk} or resolution clarity &lt; {e.triage.thresholds.minResolutionClarity}.
            </p>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.06em] text-muted">Forecast skill (Brier, lower is better)</div>
            <table className="mt-2 w-full text-[12px]">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.k} className="border-t border-border">
                    <td className="py-1.5">{r.k}</td>
                    <td className={`num py-1.5 text-right ${r.v === best ? "text-gain" : "text-text"}`}>{r.v.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-muted">Small sample; treat as early evidence. Markets are restricted to those resolving after the model&rsquo;s training data so it cannot know the outcome.</p>
      </Card>
      <Card title="What it refused, and why" className="lg:col-span-2">
        <ul className="space-y-3">
          {examples.map((r) => (
            <li key={r.id} className="text-[12px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="line-clamp-1">{r.question}</span>
                <span className={`num shrink-0 ${tone(r.pnlUsd)}`}>{usd(r.pnlUsd, { signed: true })}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted">
                insider {r.insider_risk.toFixed(2)} · clarity {r.resolution_clarity.toFixed(2)} — <span className="line-clamp-2 inline">{r.rationale}</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export default async function BacktestPage() {
  await connection();
  const b = readData<Backtest>("backtest.json");
  if (!b || !b.data.summary) {
    return (
      <>
        <PageHeader title="Replay on resolved markets" lede="How the strategy would have done on markets that already settled." />
        <div className="mt-6">
          <Empty title="No backtest yet." command="pnpm backtest 26 40" />
        </div>
      </>
    );
  }
  const d = b.data;
  const ai = readData<LlmEval>("llm-eval.json")?.data ?? null;
  const traded = d.markets.filter((m) => m.fills > 0);
  const reasons = new Map<string, number>();
  for (const m of d.markets) for (const [k, v] of Object.entries(m.pulledReasons)) reasons.set(k, (reasons.get(k) ?? 0) + v);
  const reasonRows = [...reasons.entries()].sort((a, b) => b[1] - a[1]);
  const reasonTotal = reasonRows.reduce((a, [, v]) => a + v, 0) || 1;
  const byRegime = (["live", "slow"] as const).map((r) => {
    const ms = d.markets.filter((m) => m.regime === r);
    return { regime: r, n: ms.length, naive: ms.reduce((a, m) => a + m.naivePnlUsd, 0), withLive: ms.reduce((a, m) => a + m.withLivePnlUsd, 0), guarded: ms.reduce((a, m) => a + m.pnlUsd, 0) };
  });
  const worst = [...d.markets].sort((a, b) => a.naivePnlUsd - b.naivePnlUsd).slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Replay on resolved markets"
        lede={
          <>
            {int(d.universe.count)} Polymarket markets that resolved over the last {d.universe.weeks} weeks, lifetime volume {usd(d.universe.minVolume)}–
            {usd(d.universe.maxVolume)}, at most two per event. The strategy re-quotes every 15 minutes with only the information available at that
            moment, fills against the real taker prints that followed, and settles at the real outcome. Adverse selection shows up here or nowhere.
          </>
        }
        right={<Freshness at={d.generatedAt} label="backtest" />}
      />

      {d.walkForward && <WalkForward w={d.walkForward} />}
      {ai && <AgentEval e={ai} />}

      <h2 className="pt-2 text-[12px] font-medium uppercase tracking-[0.06em] text-muted">Full sample, first-generation risk engine</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        {ARMS.map((a) => (
          <ArmCard key={a.key} label={a.label} blurb={a.blurb} s={d.summary[a.key]} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="Edge vs. outcome, by arm" className="lg:col-span-3">
          <ArmChart arms={ARMS.map((a) => ({ name: a.label, pnl: Math.round(d.summary[a.key].pnlUsd), edge: Math.round(d.summary[a.key].edgeUsd) }))} />
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Edge at fill is the spread captured against our own fair value when the fill happened. PnL after settlement is what remains once every position
            is paid out at the real outcome. The gap between them is adverse selection: the cost of trading with people who knew more.
          </p>
        </Card>
        <Card title="Where the losses come from" note="naive PnL by information regime" className="lg:col-span-2">
          <table className="w-full text-[12px]">
            <thead className="text-left text-[11px] uppercase tracking-[0.06em] text-muted">
              <tr>
                <th className="pb-2 font-normal">Regime</th>
                <th className="pb-2 text-right font-normal">Mkts</th>
                <th className="pb-2 text-right font-normal">Naive</th>
                <th className="pb-2 text-right font-normal">Longtail</th>
              </tr>
            </thead>
            <tbody>
              {byRegime.map((r) => (
                <tr key={r.regime} className="border-t border-border">
                  <td className="py-2">{r.regime === "live" ? "Live-information" : "Slow-information"}</td>
                  <td className="num py-2 text-right text-muted">{int(r.n)}</td>
                  <td className={`num py-2 text-right ${tone(r.naive)}`}>{usd(r.naive, { signed: true })}</td>
                  <td className={`num py-2 text-right ${tone(r.guarded)}`}>{usd(r.guarded, { signed: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-5 text-[11px] uppercase tracking-[0.06em] text-muted">Why the risk engine stood aside</div>
          <ul className="mt-2 space-y-1.5">
            {reasonRows.slice(0, 7).map(([k, v]) => (
              <li key={k} className="grid grid-cols-[1fr_auto] items-center gap-3 text-[12px]">
                <div className="min-w-0">
                  <div className="truncate">{k}</div>
                  <div className="mt-1 h-1 rounded-full bg-raised">
                    <div className="h-1 rounded-full bg-warn" style={{ width: `${(v / reasonTotal) * 100}%` }} />
                  </div>
                </div>
                <span className="num text-muted">{pct(v / reasonTotal)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Per-market PnL, Longtail arm" note={`${int(traded.length)} markets with fills`}>
          {traded.length ? <PnlHistogram values={traded.map((m) => m.pnlUsd)} /> : <div className="py-16 text-center text-[12px] text-muted">No fills in this sample.</div>}
        </Card>
        <Card title="Worst markets for naive quoting" note="what the risk engine avoided">
          <table className="w-full text-[12px]">
            <thead className="text-left text-[11px] uppercase tracking-[0.06em] text-muted">
              <tr>
                <th className="pb-2 font-normal">Market</th>
                <th className="pb-2 text-right font-normal">Naive</th>
                <th className="pb-2 text-right font-normal">Longtail</th>
              </tr>
            </thead>
            <tbody>
              {worst.map((m) => (
                <tr key={m.marketId} className="border-t border-border align-top">
                  <td className="py-2 pr-3">
                    <div className="line-clamp-1">{m.question}</div>
                    <div className="mt-0.5 text-[11px] text-muted">
                      {m.category} · {m.regime} · resolved {m.outcome === 1 ? "YES" : "NO"}
                    </div>
                  </td>
                  <td className={`num py-2 text-right ${tone(m.naivePnlUsd)}`}>{usd(m.naivePnlUsd, { signed: true })}</td>
                  <td className={`num py-2 text-right ${tone(m.pnlUsd)}`}>{usd(m.pnlUsd, { signed: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Assumptions">
        <ul className="grid gap-2 text-[12px] leading-relaxed text-muted md:grid-cols-2">
          {d.assumptions.map((a) => (
            <li key={a} className="border-l-2 border-border pl-3">
              {a}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
