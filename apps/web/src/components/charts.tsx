"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const C = { grid: "#1d2527", axis: "#8a9ca1", accent: "#2cb0c8", primary: "#038093", gain: "#4cc38a", loss: "#f26d6d", warn: "#e8b54a", text: "#e5f5f9", surface: "#11191b" };
const tick = { fill: C.axis, fontSize: 11, fontFamily: "var(--font-plex-mono)" };
const tooltip = {
  contentStyle: { background: C.surface, border: `1px solid ${C.grid}`, borderRadius: 4, fontSize: 12, fontFamily: "var(--font-plex-mono)" },
  labelStyle: { color: C.axis },
  itemStyle: { color: C.text },
  cursor: { fill: "rgba(44,176,200,0.06)" },
};

/** 24h volume share by market-rank bucket. */
export function RankBuckets({ data }: { data: { label: string; markets: number; volumeShare: number }[] }) {
  const rows = data.map((d) => ({ ...d, pct: +(d.volumeShare * 100).toFixed(1) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={tick} tickFormatter={(v) => `${v}%`} stroke={C.grid} />
        <YAxis type="category" dataKey="label" tick={tick} width={84} stroke={C.grid} />
        <Tooltip {...tooltip} formatter={(v, _n, item) => [`${v}% of 24h volume`, `${(item.payload as { markets: number }).markets.toLocaleString()} markets`]} />
        <Bar dataKey="pct" isAnimationActive={false} label={{ position: "right", fill: C.text, fontSize: 11, fontFamily: "var(--font-plex-mono)", formatter: (v: unknown) => `${v}%` }}>
          {rows.map((r, i) => (
            <Cell key={r.label} fill={i === rows.length - 1 ? C.warn : C.accent} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Share of 24h volume held by the top x% of markets. */
export function ConcentrationChart({ data }: { data: { marketsPct: number; volumePct: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="marketsPct" type="number" domain={[0, 100]} tick={tick} tickFormatter={(v) => `${v}%`} stroke={C.grid} />
        <YAxis domain={[0, 100]} tick={tick} tickFormatter={(v) => `${v}%`} stroke={C.grid} />
        <Tooltip {...tooltip} formatter={(v) => [`${Number(v).toFixed(1)}% of volume`, "cumulative"]} labelFormatter={(l) => `top ${Number(l).toFixed(1)}% of markets`} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke={C.axis} strokeDasharray="3 3" />
        <Area dataKey="volumePct" stroke={C.accent} fill={C.accent} fillOpacity={0.12} strokeWidth={1.5} type="monotone" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SpreadHistogram({ live, slow }: { live: { label: string; share: number }[]; slow: { label: string; share: number }[] }) {
  const data = slow.map((b, i) => ({ label: b.label, slow: +(b.share * 100).toFixed(1), live: +((live[i]?.share ?? 0) * 100).toFixed(1) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }} barGap={2}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="label" tick={tick} stroke={C.grid} interval={0} />
        <YAxis tick={tick} tickFormatter={(v) => `${v}%`} stroke={C.grid} />
        <Tooltip {...tooltip} formatter={(v, n) => [`${v}% of markets`, n === "slow" ? "slow-information" : "live-information"]} />
        <Legend wrapperStyle={{ fontSize: 11, color: C.axis }} formatter={(v) => (v === "slow" ? "slow-information (addressable)" : "live-information (excluded)")} />
        <Bar dataKey="slow" fill={C.accent} isAnimationActive={false} />
        <Bar dataKey="live" fill="#3b4b4f" isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ArmChart({ arms }: { arms: { name: string; pnl: number; edge: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={arms} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="name" tick={tick} stroke={C.grid} />
        <YAxis tick={tick} tickFormatter={(v) => `$${v}`} stroke={C.grid} />
        <ReferenceLine y={0} stroke={C.axis} />
        <Tooltip {...tooltip} formatter={(v, n) => [`$${Number(v).toFixed(0)}`, n === "pnl" ? "PnL after settlement" : "edge at fill"]} />
        <Legend wrapperStyle={{ fontSize: 11, color: C.axis }} formatter={(v) => (v === "pnl" ? "PnL after settlement" : "spread edge at fill time")} />
        <Bar dataKey="edge" fill="#3b4b4f" isAnimationActive={false} />
        <Bar dataKey="pnl" isAnimationActive={false}>
          {arms.map((a) => (
            <Cell key={a.name} fill={a.pnl >= 0 ? C.gain : C.loss} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PnlHistogram({ values }: { values: number[] }) {
  const edges = [-Infinity, -50, -20, -5, 0, 5, 20, 50, Infinity];
  const bins = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1]!;
    const label = lo === -Infinity ? `<${hi}` : hi === Infinity ? `≥${lo}` : `${lo}..${hi}`;
    return { label, n: values.filter((v) => v >= lo && v < hi).length, neg: hi <= 0 };
  });
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={bins} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="label" tick={tick} stroke={C.grid} interval={0} />
        <YAxis tick={tick} allowDecimals={false} stroke={C.grid} />
        <Tooltip {...tooltip} formatter={(v) => [`${v} markets`, "count"]} labelFormatter={(l) => `PnL $${l}`} />
        <Bar dataKey="n" isAnimationActive={false}>
          {bins.map((b) => (
            <Cell key={b.label} fill={b.neg ? C.loss : C.gain} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Calibration curve: market price vs. how often YES actually happened (fitted on older markets). */
export function CalibrationChart({ points }: { points: { p: number; y: number; n: number }[] }) {
  const data = [{ p: 0, y: 0, n: 0 }, ...points, { p: 1, y: 1, n: 0 }].map((d) => ({ p: +(d.p * 100).toFixed(1), y: +(d.y * 100).toFixed(1), n: Math.round(d.n) }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
        <CartesianGrid stroke={C.grid} />
        <XAxis dataKey="p" type="number" domain={[0, 100]} tick={tick} tickFormatter={(v) => `${v}¢`} stroke={C.grid} />
        <YAxis domain={[0, 100]} tick={tick} tickFormatter={(v) => `${v}%`} stroke={C.grid} />
        <Tooltip {...tooltip} formatter={(v) => [`${v}% resolved YES`, "observed"]} labelFormatter={(l) => `priced at ${l}¢`} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke={C.axis} strokeDasharray="3 3" />
        <Line dataKey="y" stroke={C.accent} strokeWidth={1.5} dot={{ r: 2.5, fill: C.accent }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Paper PnL and estimated rewards over the run. */
export function RunChart({ rows }: { rows: { t: number; pnlUsd: number; rewardsUsd: number }[] }) {
  const data = rows.map((r) => ({ t: r.t, pnl: r.pnlUsd, rewards: r.rewardsUsd, net: +(r.pnlUsd + r.rewardsUsd).toFixed(2) }));
  // Short runs read better as time of day; longer ones as dates.
  const short = rows.length > 1 && rows.at(-1)!.t - rows[0]!.t < 36 * 3600_000;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tick={tick} stroke={C.grid} tickFormatter={(v) => new Date(v).toISOString().slice(short ? 11 : 5, short ? 16 : 10)} />
        <YAxis tick={tick} stroke={C.grid} tickFormatter={(v) => `$${v}`} />
        <ReferenceLine y={0} stroke={C.axis} />
        <Tooltip {...tooltip} labelFormatter={(l) => new Date(Number(l)).toISOString().replace("T", " ").slice(0, 16)} formatter={(v, n) => [`$${Number(v).toFixed(2)}`, n === "pnl" ? "trading PnL" : n === "rewards" ? "rewards (est.)" : "net"]} />
        <Legend wrapperStyle={{ fontSize: 11, color: C.axis }} formatter={(v) => (v === "pnl" ? "trading PnL (mark-to-fair)" : v === "rewards" ? "rewards (estimated)" : "net")} />
        <Line dataKey="pnl" stroke={C.loss} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        <Line dataKey="rewards" stroke={C.gain} dot={false} strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} />
        <Line dataKey="net" stroke={C.accent} dot={false} strokeWidth={2} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Tiny trend line for KPI tiles. */
export function Sparkline({ values, color = C.accent, height = 36 }: { values: number[]; color?: string; height?: number }) {
  const data = values.map((v, i) => ({ i, v }));
  const id = `spark-${color.replace("#", "")}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Area dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${id})`} type="monotone" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Net result of each strategy arm, as a horizontal bar race (naive → full engine). */
export function ArmBars({ arms, height = 200 }: { arms: { name: string; pnl: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={arms} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }}>
        <XAxis type="number" hide domain={["dataMin", "dataMax"]} />
        <YAxis type="category" dataKey="name" tick={tick} width={104} stroke="transparent" />
        <ReferenceLine x={0} stroke={C.axis} />
        <Tooltip {...tooltip} formatter={(v) => [`$${Number(v).toLocaleString("en-US")}`, "PnL after settlement"]} />
        <Bar
          dataKey="pnl"
          radius={3}
          isAnimationActive={false}
          label={{ position: "insideLeft", offset: 8, fill: C.text, fontSize: 11, fontFamily: "var(--font-plex-mono)", formatter: (v: unknown) => `${Number(v) >= 0 ? "+" : "−"}$${Math.abs(Number(v)).toLocaleString("en-US")}` }}
        >
          {arms.map((a) => (
            <Cell key={a.name} fill={a.pnl >= 0 ? C.gain : C.loss} fillOpacity={a.pnl >= 0 ? 1 : 0.75} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vault NAV over time from the keeper's reports. */
export function NavChart({ rows }: { rows: { t: number; v: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <defs>
          <linearGradient id="nav-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={C.accent} stopOpacity={0.3} />
            <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tick={tick} stroke={C.grid} tickFormatter={(v) => new Date(v).toISOString().slice(11, 16)} />
        <YAxis tick={tick} stroke={C.grid} domain={["auto", "auto"]} tickFormatter={(v) => `$${Number(v).toFixed(1)}`} width={60} />
        <Tooltip {...tooltip} labelFormatter={(l) => new Date(Number(l)).toISOString().replace("T", " ").slice(0, 16)} formatter={(v) => [`$${Number(v).toFixed(2)}`, "deployed value"]} />
        <Area dataKey="v" stroke={C.accent} strokeWidth={2} fill="url(#nav-fill)" type="stepAfter" isAnimationActive={false} dot={{ r: 2.5, fill: C.accent }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Brier scores as bars (lower is better); the best one is lit. */
export function BrierBars({ rows }: { rows: { k: string; v: number }[] }) {
  const best = Math.min(...rows.map((r) => r.v));
  const lo = Math.min(...rows.map((r) => r.v)) * 0.97;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={rows} margin={{ top: 16, right: 4, bottom: 0, left: 4 }}>
        <XAxis dataKey="k" tick={{ ...tick, fontSize: 10 }} stroke={C.grid} interval={0} />
        <YAxis hide domain={[lo, "dataMax"]} />
        <Tooltip {...tooltip} formatter={(v) => [Number(v).toFixed(4), "Brier (lower is better)"]} />
        <Bar dataKey="v" radius={[3, 3, 0, 0]} isAnimationActive={false} label={{ position: "top", fill: C.axis, fontSize: 10, fontFamily: "var(--font-plex-mono)", formatter: (v: unknown) => Number(v).toFixed(4) }}>
          {rows.map((r) => (
            <Cell key={r.k} fill={r.v === best ? C.gain : "#3b4b4f"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
