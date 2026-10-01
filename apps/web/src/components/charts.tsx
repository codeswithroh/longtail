"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
