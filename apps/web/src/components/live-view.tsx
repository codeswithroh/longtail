"use client";
import NumberFlow, { type Format } from "@number-flow/react";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import type { PaperMarket, PaperState } from "@/lib/data";
import { ago, cents, pct, prob, tone, usd } from "@/lib/format";
import { Card, Pill } from "./ui";

type Filter = "quoting" | "aside" | "all";

const money: Format = { style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 2 };

function Big({ label, value, format, sub, signed, toneValue }: { label: string; value: number; format?: Format; sub?: string; signed?: boolean; toneValue?: number }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className={clsx("num mt-1 whitespace-nowrap text-[22px] leading-none", toneValue === undefined ? "text-text" : tone(toneValue))}>
        <NumberFlow value={value} locales="en-US" format={{ ...format, signDisplay: signed ? "exceptZero" : "auto" }} />
      </div>
      {sub && <div className="mt-1.5 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

function Spread({ m }: { m: PaperMarket }) {
  const venue = m.book?.spread;
  const ours = m.quote?.spread;
  return (
    <div className="num flex items-center justify-end gap-1.5">
      <span className="text-muted">{cents(venue, 0)}</span>
      {ours != null && (
        <>
          <span className="text-muted" aria-hidden>
            →
          </span>
          <span className={m.improvesSpread ? "text-accent" : "text-text"}>{cents(ours, 0)}</span>
        </>
      )}
    </div>
  );
}

function Row({ m, i }: { m: PaperMarket; i: number }) {
  const quoting = m.decision?.quote;
  const reason = m.decision?.reasons.at(-1);
  return (
    <tr className="row-in border-t border-border align-top hover:bg-raised/50" style={{ animationDelay: `${Math.min(i, 20) * 15}ms` }}>
      <td className="max-w-[380px] py-2 pr-3">
        <a href={m.url} target="_blank" rel="noreferrer" className="line-clamp-1 hover:text-accent">
          {m.question}
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <span>{m.venue === "hip4" ? "HIP-4" : "Polymarket"}</span>·<span>{m.category}</span>
          {m.endTime && <span>· ends {new Date(m.endTime).toISOString().slice(0, 10)}</span>}
        </div>
      </td>
      <td className="num py-2 text-right text-muted">
        {prob(m.book?.bid)} / {prob(m.book?.ask)}
      </td>
      <td className="py-2 text-right">
        <Spread m={m} />
      </td>
      <td className="num py-2 text-right">
        {m.quote ? (
          <>
            <span className="text-gain">{m.quote.bid ? prob(m.quote.bid.price) : "—"}</span>
            <span className="text-muted"> / </span>
            <span className="text-loss">{m.quote.ask ? prob(m.quote.ask.price) : "—"}</span>
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="num py-2 text-right" title={m.signals.map((s) => `${s.name} ${s.p.toFixed(3)} (w ${s.weight.toFixed(2)})`).join("\n")}>
        {prob(m.fair)}
        <span className="text-muted"> ±{m.sigma != null ? (m.sigma * 100).toFixed(1) : "—"}</span>
      </td>
      <td className="num py-2 text-right" title={m.ai ? `${m.ai.rationale}\n\n${m.ai.evidence.join("\n")}` : "not yet analyzed"}>
        {m.ai ? (
          <>
            {prob(m.ai.p)}
            <div className={clsx("text-[11px]", m.ai.insiderRisk > 0.3 || m.ai.clarity < 0.6 ? "text-warn" : "text-muted")}>
              ins {m.ai.insiderRisk.toFixed(2)} · clr {m.ai.clarity.toFixed(2)}
            </div>
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="py-2 pl-3">
        {quoting ? <Pill tone="accent">quoting</Pill> : <Pill tone="warn">aside</Pill>}
        {reason && <div className="mt-1 line-clamp-1 max-w-[220px] text-[11px] text-muted">{reason}</div>}
      </td>
      <td className="num py-2 text-right" title={m.rewards ? `$${m.rewards.daily.toFixed(0)}/day pool, ${m.rewards.maxSpread}¢ band` : "no reward program"}>
        {m.rewards ? (m.rewards.share != null ? pct(m.rewards.share) : "—") : <span className="text-muted">n/a</span>}
      </td>
      <td className="num py-2 text-right">{m.position && m.position.shares !== 0 ? Math.round(m.position.shares) : <span className="text-muted">0</span>}</td>
      <td className={clsx("num py-2 text-right", tone(m.position?.pnl))}>{m.position ? usd(m.position.pnl, { signed: true }) : "—"}</td>
    </tr>
  );
}

export function LiveView({ initial }: { initial: PaperState }) {
  const [state, setState] = useState(initial);
  const [filter, setFilter] = useState<Filter>("quoting");
  const [error, setError] = useState(false);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/paper", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        setState(await r.json());
        setError(false);
      } catch {
        setError(true);
      }
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  const s = state.summary;
  const rows = useMemo(() => {
    const xs = state.markets.filter((m) => (filter === "all" ? true : filter === "quoting" ? m.decision?.quote : !m.decision?.quote));
    return xs.sort((a, b) => Number(b.improvesSpread) - Number(a.improvesSpread) || (b.position?.fills ?? 0) - (a.position?.fills ?? 0));
  }, [state, filter]);
  const stale = Date.now() - s.updatedAt > 5 * 60_000;
  const reasons = Object.entries(s.pullReasons).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted">
        <span className={clsx("inline-flex items-center gap-1.5", stale || error ? "text-warn" : "text-gain")}>
          <span className={clsx("size-1.5 rounded-full", stale || error ? "bg-warn" : "live-dot bg-gain")} />
          {error ? "connection lost, retrying" : stale ? `engine idle · last update ${ago(s.updatedAt)}` : `live · updated ${ago(s.updatedAt)}`}
        </span>
        <span>· running since {new Date(s.startedAt).toISOString().replace("T", " ").slice(0, 16)} UTC</span>
        <span>· cycle {s.cycles}</span>
        <span>· AI agent {s.llm ? `on: ${s.llm.triaged ?? 0} markets analyzed, ${s.llm.gated ?? 0} refused` : "off"}</span>
        {s.settledMarkets ? <span>· {s.settledMarkets} markets resolved and settled</span> : null}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-md border border-border bg-surface p-5 md:grid-cols-4 xl:grid-cols-7">
        <Big label="Markets quoted" value={s.quoting} sub={`of ${s.markets} watched`} />
        <Big label="Tightening the book" value={s.improvingSpread} sub={`median ${cents(s.medianVenueSpread, 0)} → ${cents(s.medianOurSpread, 0)}`} />
        <Big label="Fills" value={s.fills} sub={`${usd(s.volumeUsd)} volume`} />
        <Big label="Edge at fill" value={s.edgeUsd} format={money} signed toneValue={s.edgeUsd} sub="vs. fair value" />
        <Big label="Mark-to-fair PnL" value={s.pnlUsd} format={money} signed toneValue={s.pnlUsd} sub={`gross exposure ${usd(s.grossExposureUsd)}`} />
        <Big
          label="Rewards (est.)"
          value={s.rewardsUsd ?? 0}
          format={money}
          toneValue={s.rewardsUsd ?? 0}
          sub={`run-rate ${usd(s.rewardsDailyRunRateUsd)}/day of ${usd(s.rewardsDailyAvailableUsd)}`}
        />
        <Big
          label="Markout 30m"
          value={s.markout30m == null ? 0 : s.markout30m * 100}
          format={{ maximumFractionDigits: 2, minimumFractionDigits: 2 }}
          signed
          toneValue={s.markout30m ?? 0}
          sub={s.markout30m == null ? "no resolved markouts yet" : "¢ per share, + = good fills"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_260px]">
        <Card
          title="Order books"
          note={
            <div role="tablist" className="flex gap-1">
              {(["quoting", "aside", "all"] as Filter[]).map((f) => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={clsx("rounded-sm px-2 py-0.5 text-[11px] transition-colors duration-150", filter === f ? "bg-raised text-text" : "text-muted hover:text-text")}
                >
                  {f}
                </button>
              ))}
            </div>
          }
        >
          {rows.length === 0 ? (
            <div className="py-12 text-center text-[12px] text-muted">{filter === "quoting" ? "The risk engine is standing aside on every market right now." : "Nothing here."}</div>
          ) : (
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full min-w-[1140px] text-[12px]">
                <thead className="text-left text-[11px] uppercase tracking-[0.06em] text-muted">
                  <tr>
                    <th className="px-4 pb-2 font-normal">Market</th>
                    <th className="pb-2 text-right font-normal">Venue bid / ask</th>
                    <th className="pb-2 text-right font-normal">Spread venue → ours</th>
                    <th className="pb-2 text-right font-normal">Our bid / ask</th>
                    <th className="pb-2 text-right font-normal">Fair ±σ¢</th>
                    <th className="pb-2 text-right font-normal">AI view</th>
                    <th className="pb-2 pl-3 font-normal">Risk engine</th>
                    <th className="pb-2 text-right font-normal">Reward share</th>
                    <th className="pb-2 text-right font-normal">Pos</th>
                    <th className="px-4 pb-2 text-right font-normal">PnL</th>
                  </tr>
                </thead>
                <tbody className="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4">
                  {rows.map((m, i) => (
                    <Row key={m.id} m={m} i={i} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Standing aside because">
          {reasons.length === 0 ? (
            <div className="text-[12px] text-muted">Quoting everything it watches.</div>
          ) : (
            <ul className="space-y-2">
              {reasons.map(([k, v]) => (
                <li key={k} className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className="text-text">{k}</span>
                  <span className="num text-muted">{v}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-[11px] leading-relaxed text-muted">
            Every market is re-checked each cycle. Hover a fair value to see the signals behind it.
          </p>
        </Card>
      </div>
    </div>
  );
}
