import clsx from "clsx";
import type { ReactNode } from "react";

/** The Longtail mark: a power-law decay drawn as bars, with the tail lit. */
export function Mark({ size = 20 }: { size?: number }) {
  const bars = [16, 9, 6, 4.5, 3.5, 3, 2.6, 2.3];
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      {bars.map((h, i) => (
        <rect key={i} x={1 + i * 2.3} y={18 - h} width={1.5} height={h} rx={0.4} fill={i < 2 ? "#3b4b4f" : "#2cb0c8"} />
      ))}
    </svg>
  );
}

export function PageHeader({ title, lede, right }: { title: string; lede: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{lede}</p>
      </div>
      {right}
    </header>
  );
}

export function Card({ title, note, children, className }: { title?: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("min-w-0 rounded-md border border-border bg-surface", className)}>
      {title && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
          <h2 className="text-[12px] font-medium uppercase tracking-[0.06em] text-muted">{title}</h2>
          {note && <div className="text-[11px] text-muted">{note}</div>}
        </div>
      )}
      {/* Wide tables scroll inside the card instead of widening the page on phones. */}
      <div className="overflow-x-auto p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className={clsx("num mt-1 whitespace-nowrap text-[22px] leading-none", tone ?? "text-text")}>{value}</div>
      {sub && <div className="mt-1.5 text-[12px] leading-snug text-muted">{sub}</div>}
    </div>
  );
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "gain" | "loss" | "warn" | "accent" }) {
  const map = {
    muted: "border-border text-muted",
    gain: "border-gain/40 text-gain",
    loss: "border-loss/40 text-loss",
    warn: "border-warn/40 text-warn",
    accent: "border-accent/40 text-accent",
  };
  return <span className={clsx("inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border px-1.5 py-px text-[11px] leading-4", map[tone])}>{children}</span>;
}

export function Empty({ title, command }: { title: string; command: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-6 py-12 text-center">
      <div className="text-[13px] text-text">{title}</div>
      <div className="mt-2 text-[12px] text-muted">Generate it from the repo root:</div>
      <code className="num mt-2 inline-block rounded-sm bg-raised px-2 py-1 text-[12px] text-accent">{command}</code>
    </div>
  );
}

export function Freshness({ at, label = "data" }: { at: Date | string | number; label?: string }) {
  const d = new Date(at);
  return (
    <div className="num text-[11px] text-muted" title={d.toISOString()}>
      {label} · {d.toISOString().replace("T", " ").slice(0, 16)} UTC
    </div>
  );
}
