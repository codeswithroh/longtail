import { Ban, Bot, ChartNoAxesColumn, Coins, FlaskConical, Layers, Scale, ShieldCheck, Target } from "lucide-react";
import { connection } from "next/server";
import { ArmBars, BrierBars, CalibrationChart, PnlHistogram, RankBuckets } from "@/components/charts";
import { Chip, Kpi, Panel, RankList, SplitBar } from "@/components/viz";
import { readData, type Backtest, type Census, type LlmEval } from "@/lib/data";
import { int, pct, reasonLabel, usd } from "@/lib/format";

export default async function ResearchPage() {
  await connection();
  const [b, e, c] = await Promise.all([readData<Backtest>("backtest.json"), readData<LlmEval>("llm-eval.json"), readData<Census>("census.json")]);
  const w = b?.data.walkForward;
  const ai = e?.data;
  const census = c?.data;
  const pm = census?.polymarket;
  const kalshi = census?.kalshi && "markets" in census.kalshi ? census.kalshi : null;
  const hip4 = census?.hip4 && "markets" in census.hip4 ? census.hip4 : null;
  const top = census?.charts.rankBuckets[0];

  const reasons = new Map<string, number>();
  for (const m of b?.data.markets ?? [])
    for (const [k, v] of Object.entries(m.pulledReasons)) {
      const family = reasonLabel(k);
      reasons.set(family, (reasons.get(family) ?? 0) + v);
    }
  const reasonRows = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const reasonTotal = reasonRows.reduce((a, [, v]) => a + v, 0) || 1;
  const traded = b?.data.markets.filter((m) => m.fills > 0) ?? [];

  return (
    <div className="space-y-4">
      {pm && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <Kpi icon={Layers} label="open Polymarket markets" value={int(pm.all.markets)} />
          <Kpi icon={ChartNoAxesColumn} label={`of volume in the top ${int(top?.markets)}`} value={pct(top?.volumeShare)} accent="#e8b54a" />
          <Kpi icon={Target} label="median depth within 2¢, long tail" value={usd(pm.addressableLongTail.depthWithin2cMedianUsd, { digits: 0 })} accent="#f26d6d" />
          <Kpi icon={Coins} label="rewards/day on the long tail" value={usd(census?.rewards?.addressableLongTail.dailyUsd)} accent="#4cc38a" />
        </div>
      )}

      {w && (
        <div className="grid gap-4 lg:grid-cols-5">
          <Panel title="Walk-forward PnL, out of sample" icon={FlaskConical} className="lg:col-span-3" action={<Chip>{int(w.testMarkets)} markets</Chip>}>
            <ArmBars
              arms={[
                { name: "Naive", pnl: Math.round(w.arms.naive.pnlUsd) },
                { name: "Risk engine", pnl: Math.round(w.arms.riskEngine.pnlUsd) },
                { name: "+ drift guard", pnl: Math.round(w.arms.plusDriftGuard.pnlUsd) },
                { name: "+ calibration", pnl: Math.round(w.arms.plusCalibration.pnlUsd) },
              ]}
            />
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(["naive", "riskEngine", "plusDriftGuard", "plusCalibration"] as const).map((k) => {
                const s = w.arms[k];
                return (
                  <div key={k} className="rounded-lg bg-raised p-2.5 text-center">
                    <div className={`num text-[15px] ${s.returnOnPeakCapital >= 0 ? "text-gain" : "text-loss"}`}>{pct(s.returnOnPeakCapital, 1)}</div>
                    <div className="mt-0.5 text-[10px] text-muted">on capital</div>
                  </div>
                );
              })}
            </div>
          </Panel>
          <Panel title="Long-shot bias" icon={Scale} className="lg:col-span-2" action={<Chip tone="gain">Brier {w.brierMarket.toFixed(4)} → {w.brierCalibrated.toFixed(4)}</Chip>}>
            <CalibrationChart points={w.curve} />
          </Panel>
        </div>
      )}

      {ai && (
        <div className="grid gap-4 lg:grid-cols-5">
          <Panel title="Forecast skill" icon={Bot} className="lg:col-span-3" action={<Chip>{int(ai.markets)} unseen markets</Chip>}>
            <BrierBars
              rows={[
                { k: "Market", v: ai.forecast.brierMarket },
                { k: "Calibrated", v: ai.forecast.brierCalibrated },
                { k: "Claude", v: ai.forecast.brierLlm },
                { k: "Claude + calibrated", v: ai.forecast.brierBlend },
              ]}
            />
          </Panel>
          <Panel title="AI triage pays" icon={ShieldCheck} className="lg:col-span-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-loss/30 bg-loss/5 p-3">
                <Ban size={16} className="text-loss" aria-hidden />
                <div className="num mt-2 text-[22px] text-loss">{usd(ai.triage.flagged.pnlUsd, { signed: true })}</div>
                <div className="mt-0.5 text-[11px] text-muted">avoided · {ai.triage.flagged.markets} refused</div>
              </div>
              <div className="rounded-lg border border-gain/30 bg-gain/5 p-3">
                <ShieldCheck size={16} className="text-gain" aria-hidden />
                <div className="num mt-2 text-[22px] text-gain">{usd(ai.triage.kept.pnlUsd, { signed: true })}</div>
                <div className="mt-0.5 text-[11px] text-muted">earned · {ai.triage.kept.markets} kept</div>
              </div>
            </div>
            <div className="mt-4">
              <SplitBar
                parts={[
                  { label: "kept", value: ai.triage.kept.markets, color: "#4cc38a" },
                  { label: "refused", value: ai.triage.flagged.markets, color: "#f26d6d" },
                ]}
              />
            </div>
          </Panel>
        </div>
      )}

      {census && pm && (
        <div className="grid gap-4 lg:grid-cols-5">
          <Panel title="Where the volume goes" icon={ChartNoAxesColumn} className="lg:col-span-3">
            <RankBuckets data={census.charts.rankBuckets} />
          </Panel>
          <Panel title="Markets that traded $0 in 24h" icon={Layers} className="lg:col-span-2">
            <RankList
              color="#e8b54a"
              format={(v) => `${v.toFixed(0)}%`}
              rows={[
                { label: `Polymarket · ${int(pm.all.markets)}`, value: pm.all.zeroDaily * 100 },
                ...(kalshi ? [{ label: `Kalshi · ${int(kalshi.markets)}`, value: kalshi.zeroDaily * 100 }] : []),
              ]}
            />
            {hip4 && (
              <div className="mt-5 flex items-center justify-between rounded-lg bg-raised p-3 text-[12px]">
                <span className="text-muted">Hyperliquid HIP-4 median spread</span>
                <span className="num text-warn">{(hip4.spreadMedian * 100).toFixed(0)}¢</span>
              </div>
            )}
          </Panel>
        </div>
      )}

      {b && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Why the engine stood aside" icon={Ban}>
            <RankList rows={reasonRows.map(([label, v]) => ({ label, value: Math.round((v / reasonTotal) * 100) }))} color="#e8b54a" format={(v) => `${v}%`} />
          </Panel>
          <Panel title="Per-market PnL" icon={ChartNoAxesColumn} action={<Chip>{int(traded.length)} traded</Chip>}>
            <PnlHistogram values={traded.map((m) => m.pnlUsd)} />
          </Panel>
        </div>
      )}
    </div>
  );
}
