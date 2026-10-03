// Visual building blocks for the app: panels, KPI tiles, rings, split bars and price tracks.
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function Panel({ title, icon: Icon, action, children, className, pad = true }: { title?: string; icon?: LucideIcon; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={clsx("min-w-0 rounded-xl border border-border bg-surface", className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5">
          <h2 className="flex items-center gap-2 text-[13px] font-medium text-text">
            {Icon && <Icon size={15} className="text-accent" aria-hidden />}
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className={clsx(pad && "p-4")}>{children}</div>
    </section>
  );
}

export function Kpi({ icon: Icon, label, value, delta, deltaTone, children, accent }: { icon: LucideIcon; label: string; value: ReactNode; delta?: ReactNode; deltaTone?: "gain" | "loss" | "muted"; children?: ReactNode; accent?: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="grid size-8 place-items-center rounded-lg" style={{ background: `${accent ?? "#2cb0c8"}1f`, color: accent ?? "#2cb0c8" }}>
          <Icon size={16} aria-hidden />
        </span>
        {delta != null && (
          <span className={clsx("num rounded-full px-2 py-0.5 text-[11px]", deltaTone === "gain" ? "bg-gain/10 text-gain" : deltaTone === "loss" ? "bg-loss/10 text-loss" : "bg-raised text-muted")}>{delta}</span>
        )}
      </div>
      <div className="num mt-3 truncate text-[24px] leading-none text-text">{value}</div>
      <div className="mt-1.5 text-[12px] text-muted">{label}</div>
      {children && <div className="-mx-1 mt-3">{children}</div>}
    </div>
  );
}

/** Circular progress ring with a centered label. */
export function Ring({ value, size = 96, stroke = 9, color = "#2cb0c8", track = "#1d2527", children }: { value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

/** One bar split into colored segments, with a legend. */
export function SplitBar({ parts, height = 10 }: { parts: { label: string; value: number; color: string }[]; height?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div>
      <div className="flex w-full gap-0.5 overflow-hidden rounded-full" style={{ height }}>
        {parts.map((p) => (
          <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5 text-muted">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            {p.label}
            <span className="num text-text">{p.value.toLocaleString("en-US")}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Ranked horizontal bars (label left, value right). */
export function RankList({ rows, color = "#2cb0c8", format = (v: number) => v.toLocaleString("en-US") }: { rows: { label: string; value: number }[]; color?: string; format?: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-[12px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-text">{r.label}</span>
            <span className="num shrink-0 text-muted">{format(r.value)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-raised">
            <div className="h-1.5 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A 0–1 probability track: the venue's bid/ask band in grey, our quote in teal, fair value as a dot.
 * Reads at a glance whether we tighten the book.
 */
export function PriceTrack({ bid, ask, ourBid, ourAsk, fair }: { bid: number | null; ask: number | null; ourBid: number | null; ourAsk: number | null; fair: number | null }) {
  const pct = (x: number) => `${Math.max(0, Math.min(1, x)) * 100}%`;
  return (
    <div className="relative h-5" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      {bid != null && ask != null && <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-[#3b4b4f]" style={{ left: pct(bid), width: `calc(${pct(ask - bid)} + 2px)` }} />}
      {ourBid != null && ourAsk != null && <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent" style={{ left: pct(ourBid), width: `calc(${pct(ourAsk - ourBid)} + 2px)` }} />}
      {ourBid != null && <div className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded bg-gain" style={{ left: pct(ourBid) }} />}
      {ourAsk != null && <div className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded bg-loss" style={{ left: pct(ourAsk) }} />}
      {fair != null && <div className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-text" style={{ left: pct(fair) }} />}
    </div>
  );
}

export function Chip({ children, tone = "muted", icon: Icon }: { children: ReactNode; tone?: "muted" | "gain" | "loss" | "warn" | "accent"; icon?: LucideIcon }) {
  const map = {
    muted: "bg-raised text-muted",
    gain: "bg-gain/10 text-gain",
    loss: "bg-loss/10 text-loss",
    warn: "bg-warn/10 text-warn",
    accent: "bg-accent/10 text-accent",
  };
  return (
    <span className={clsx("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] leading-4", map[tone])}>
      {Icon && <Icon size={12} aria-hidden />}
      {children}
    </span>
  );
}

export function LiveDot({ ok = true }: { ok?: boolean }) {
  return <span className={clsx("inline-block size-1.5 rounded-full", ok ? "live-dot bg-gain" : "bg-warn")} aria-hidden />;
}
