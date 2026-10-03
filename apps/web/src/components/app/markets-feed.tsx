"use client";
import clsx from "clsx";
import { ArrowRight, Bot, Clock, Coins, ExternalLink, Search, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PaperMarket, PaperState } from "@/lib/data";
import { cents, prob, usd } from "@/lib/format";
import { Chip, PriceTrack } from "../viz";

type Filter = "quoting" | "aside" | "all";
type VenueFilter = "all" | "polymarket" | "hip4";

const SIGNAL_LABEL: Record<string, string> = {
  microprice: "order book",
  trade_vwap: "recent trades",
  last_print: "last trade",
  history_ewma: "price history",
  llm: "Claude",
};

const venueLabel = (v: PaperMarket["venue"]) => (v === "hip4" ? "Hyperliquid" : "Polymarket");
const venueColor = (v: PaperMarket["venue"]) => (v === "hip4" ? "#4cc38a" : "#2cb0c8");

function daysLeft(end: number | null) {
  if (!end) return null;
  const d = Math.round((end - Date.now()) / 86_400_000);
  return d <= 0 ? "today" : `${d}d`;
}

function AiBadge({ m }: { m: PaperMarket }) {
  if (!m.ai) return <Chip icon={Bot}>pending</Chip>;
  const risky = m.ai.insiderRisk > 0.3 || m.ai.clarity < 0.6;
  return (
    <Chip tone={risky ? "warn" : "gain"} icon={risky ? ShieldAlert : ShieldCheck}>
      {risky ? "AI refused" : "AI cleared"}
    </Chip>
  );
}

function Card({ m, onOpen }: { m: PaperMarket; onOpen: () => void }) {
  const quoting = m.decision?.quote;
  return (
    <button
      onClick={onOpen}
      className="group flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4 text-left transition-colors duration-150 hover:border-accent/40 hover:bg-raised/40"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
          <span className="size-1.5 rounded-full" style={{ background: venueColor(m.venue) }} />
          {venueLabel(m.venue)}
        </span>
        <span className="truncate text-[11px] text-muted">· {m.category}</span>
        <span className="ml-auto">{quoting ? <Chip tone="accent">quoting</Chip> : <Chip tone="warn">aside</Chip>}</span>
      </div>
      <div className="mt-2.5 line-clamp-2 min-h-[2.6em] text-[14px] leading-snug text-text">{m.question}</div>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="num text-[26px] leading-none">{m.fair != null ? `${Math.round(m.fair * 100)}%` : "—"}</div>
          <div className="mt-1 text-[11px] text-muted">fair chance</div>
        </div>
        {m.book?.spread != null && (
          <div className="num flex items-center gap-1.5 text-[13px]">
            <span className="text-muted">{cents(m.book.spread, 0)}</span>
            {m.quote?.spread != null && (
              <>
                <ArrowRight size={13} className="text-muted" aria-hidden />
                <span className={m.improvesSpread ? "text-accent" : "text-text"}>{cents(m.quote.spread, 0)}</span>
              </>
            )}
          </div>
        )}
      </div>
      <div className="mt-3">
        <PriceTrack bid={m.book?.bid ?? null} ask={m.book?.ask ?? null} ourBid={m.quote?.bid?.price ?? null} ourAsk={m.quote?.ask?.price ?? null} fair={m.fair} />
        <div className="num mt-0.5 flex justify-between text-[10px] text-muted">
          <span>0</span>
          <span>1</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
        <AiBadge m={m} />
        {m.rewards && <Chip icon={Coins}>{usd(m.rewards.daily)}/d pool</Chip>}
        {daysLeft(m.endTime) && <Chip icon={Clock}>{daysLeft(m.endTime)}</Chip>}
        {m.position && m.position.fills > 0 && <Chip tone={m.position.pnl >= 0 ? "gain" : "loss"}>{usd(m.position.pnl, { signed: true })}</Chip>}
      </div>
    </button>
  );
}

function Meter({ label, value, good }: { label: string; value: number; good: boolean }) {
  return (
    <div>
      <div className="flex justify-between text-[12px]">
        <span className="text-muted">{label}</span>
        <span className={clsx("num", good ? "text-gain" : "text-warn")}>{value.toFixed(2)}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-raised">
        <div className={clsx("h-1.5 rounded-full", good ? "bg-gain" : "bg-warn")} style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

function Sheet({ m, onClose }: { m: PaperMarket; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const maxW = Math.max(...m.signals.map((s) => s.weight), 0.01);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 md:items-stretch md:justify-end" onClick={onClose} role="dialog" aria-modal aria-label={m.question}>
      <div className="sheet-in max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 md:max-h-none md:w-[440px] md:rounded-none md:border-y-0 md:border-r-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span className="size-1.5 rounded-full" style={{ background: venueColor(m.venue) }} />
              {venueLabel(m.venue)} · {m.category}
            </div>
            <h2 className="mt-1.5 text-[16px] font-medium leading-snug">{m.question}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-text" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {[
            ["fair", prob(m.fair)],
            ["venue", m.book ? `${prob(m.book.bid)}–${prob(m.book.ask)}` : "—"],
            ["ours", m.quote ? `${m.quote.bid ? prob(m.quote.bid.price) : "—"}–${m.quote.ask ? prob(m.quote.ask.price) : "—"}` : "—"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-raised p-2.5">
              <div className="text-[10px] uppercase tracking-[0.06em] text-muted">{k}</div>
              <div className="num mt-1 text-[13px]">{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <PriceTrack bid={m.book?.bid ?? null} ask={m.book?.ask ?? null} ourBid={m.quote?.bid?.price ?? null} ourAsk={m.quote?.ask?.price ?? null} fair={m.fair} />
        </div>

        <h3 className="mt-6 text-[12px] font-medium text-muted">Fair value built from</h3>
        <ul className="mt-2 space-y-2">
          {m.signals.map((s) => (
            <li key={s.name} className="grid grid-cols-[110px_1fr_48px] items-center gap-3 text-[12px]">
              <span className="truncate text-muted">{SIGNAL_LABEL[s.name] ?? s.name}</span>
              <div className="h-1.5 rounded-full bg-raised">
                <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(s.weight / maxW) * 100}%` }} />
              </div>
              <span className="num text-right">{s.p.toFixed(3)}</span>
            </li>
          ))}
        </ul>

        {m.ai && (
          <>
            <h3 className="mt-6 flex items-center gap-1.5 text-[12px] font-medium text-muted">
              <Bot size={14} className="text-accent" aria-hidden /> Claude&apos;s view
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-4">
              <Meter label="insider risk" value={m.ai.insiderRisk} good={m.ai.insiderRisk <= 0.3} />
              <Meter label="rule clarity" value={m.ai.clarity} good={m.ai.clarity >= 0.6} />
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-text/90">{m.ai.rationale}</p>
          </>
        )}

        {m.decision && m.decision.reasons.length > 0 && (
          <>
            <h3 className="mt-6 text-[12px] font-medium text-muted">Risk engine</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {m.decision.reasons.map((r) => (
                <Chip key={r} tone={m.decision!.quote ? "muted" : "warn"}>{r}</Chip>
              ))}
            </div>
          </>
        )}

        <a href={m.url} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline">
          open on {venueLabel(m.venue)} <ExternalLink size={13} aria-hidden />
        </a>
      </div>
    </div>
  );
}

export function MarketsFeed({ initial }: { initial: PaperState }) {
  const [state, setState] = useState(initial);
  const [filter, setFilter] = useState<Filter>("quoting");
  const [venue, setVenue] = useState<VenueFilter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<PaperMarket | null>(null);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/paper", { cache: "no-store" });
        if (r.ok) setState(await r.json());
      } catch {
        /* keep the last good state */
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const counts = useMemo(() => {
    const quoting = state.markets.filter((m) => m.decision?.quote).length;
    return { quoting, aside: state.markets.length - quoting, all: state.markets.length };
  }, [state]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.markets
      .filter((m) => (filter === "all" ? true : filter === "quoting" ? m.decision?.quote : !m.decision?.quote))
      .filter((m) => venue === "all" || m.venue === venue)
      .filter((m) => !needle || m.question.toLowerCase().includes(needle) || m.category.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.improvesSpread) - Number(a.improvesSpread) || (b.rewards?.daily ?? 0) - (a.rewards?.daily ?? 0));
  }, [state, filter, venue, q]);

  return (
    <div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div role="tablist" className="inline-flex rounded-lg border border-border bg-surface p-1">
          {(["quoting", "aside", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={clsx("flex-1 rounded-md px-3 py-1.5 text-[12px] capitalize transition-colors duration-150 md:flex-none", filter === f ? "bg-raised text-text" : "text-muted hover:text-text")}
            >
              {f} <span className="num ml-1 text-muted">{counts[f]}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(["all", "polymarket", "hip4"] as VenueFilter[]).map((v) => (
            <button
              key={v}
              onClick={() => setVenue(v)}
              className={clsx("rounded-full border px-3 py-1 text-[12px] transition-colors duration-150", venue === v ? "border-accent/50 bg-accent/10 text-text" : "border-border text-muted hover:text-text")}
            >
              {v === "all" ? "All venues" : v === "hip4" ? "Hyperliquid" : "Polymarket"}
            </button>
          ))}
        </div>
        <label className="relative md:ml-auto md:w-64">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search markets"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-[13px] text-text placeholder:text-muted focus:border-accent/50 focus:outline-none"
          />
        </label>
      </div>

      {rows.length === 0 ? (
        <div className="py-24 text-center text-[13px] text-muted">No markets match.</div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((m) => (
            <Card key={m.id} m={m} onOpen={() => setOpen(m)} />
          ))}
        </div>
      )}
      {open && <Sheet m={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
