"use client";
import clsx from "clsx";
import { ArrowRight, Bot, BookOpen, Check, CircleSlash, ExternalLink, Loader2, Radar, ScanSearch, ShieldAlert, ShieldCheck, Target, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Chip, Panel, PriceTrack, Ring } from "../viz";

interface Level {
  price: number;
  size: number;
}
interface Result {
  market: { id: string; question: string; url: string; category: string; endTime: number | null; rules: string; volume24h: number };
  regime: "live" | "slow";
  book: { bid: number | null; ask: number | null; spread: number | null; bids: Level[]; asks: Level[] };
  trades: number;
  signals: { name: string; p: number; weight: number }[];
  fair: number;
  sigma: number;
  calibratedFrom: number | null;
  rules: { score: number; reasons: string[] };
  ai: { probability: number; confidence: number; resolution_clarity: number; insider_risk: number; key_evidence: string[]; rationale: string } | null;
  aiNote: string | null;
  decision: { quote: boolean; reasons: string[]; sizeScale: number };
  quote: { bid: Level | null; ask: Level | null; spread: number | null } | null;
  improves: boolean | null;
}
type Choices = { choices: { id: string; question: string }[] };

const SIGNAL_LABEL: Record<string, string> = { microprice: "order book", trade_vwap: "recent trades", last_print: "last trade", history_ewma: "price history", llm: "Claude" };
const STEPS = [
  { icon: BookOpen, label: "Reading the order book and trades" },
  { icon: Target, label: "Pricing fair value" },
  { icon: Radar, label: "Checking rules and information regime" },
  { icon: Bot, label: "Claude researching the market" },
  { icon: ShieldCheck, label: "Risk engine deciding" },
];
const cents = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)}¢`);

function Progress({ ai }: { ai: boolean }) {
  const steps = ai ? STEPS : STEPS.filter((s) => s.icon !== Bot);
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), ai ? 5000 : 900);
    return () => clearInterval(id);
  }, [ai, steps.length]);
  return (
    <ol className="space-y-2.5">
      {steps.map(({ icon: Icon, label }, k) => (
        <li key={label} className={clsx("flex items-center gap-3 text-[13px] transition-opacity duration-300", k > i ? "opacity-35" : "opacity-100")}>
          <span className={clsx("grid size-7 place-items-center rounded-full", k < i ? "bg-gain/15 text-gain" : k === i ? "bg-accent/15 text-accent" : "bg-raised text-muted")}>
            {k < i ? <Check size={14} /> : k === i ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function Ladder({ bids, asks }: { bids: Level[]; asks: Level[] }) {
  const max = Math.max(...[...bids, ...asks].map((l) => l.size * l.price), 1);
  const row = (l: Level, side: "bid" | "ask") => (
    <div key={`${side}${l.price}`} className="relative grid grid-cols-2 py-1 text-[12px]">
      <div className={clsx("absolute inset-y-0 right-0 rounded-sm", side === "bid" ? "bg-gain/10" : "bg-loss/10")} style={{ width: `${((l.size * l.price) / max) * 100}%` }} />
      <span className={clsx("num relative pl-2", side === "bid" ? "text-gain" : "text-loss")}>{l.price.toFixed(3)}</span>
      <span className="num relative pr-2 text-right text-muted">${(l.size * l.price).toFixed(0)}</span>
    </div>
  );
  return (
    <div>
      {[...asks].reverse().map((l) => row(l, "ask"))}
      <div className="my-1 border-t border-dashed border-border" />
      {bids.map((l) => row(l, "bid"))}
      {!bids.length && !asks.length && <div className="py-6 text-center text-[12px] text-muted">Empty book</div>}
    </div>
  );
}

function Verdict({ r }: { r: Result }) {
  const top = r.decision.reasons.at(-1);
  return (
    <section className={clsx("rounded-2xl border p-5 md:p-6", r.decision.quote ? "border-gain/30 bg-gain/[0.05]" : "border-warn/30 bg-warn/[0.05]")}>
      <div className="flex flex-wrap items-start gap-4">
        <span className={clsx("grid size-12 place-items-center rounded-xl", r.decision.quote ? "bg-gain/15 text-gain" : "bg-warn/15 text-warn")}>
          {r.decision.quote ? <Zap size={22} /> : <CircleSlash size={22} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className={clsx("text-[20px] font-semibold", r.decision.quote ? "text-gain" : "text-warn")}>{r.decision.quote ? "Longtail would quote this market" : "Longtail would stand aside"}</div>
          {top && <div className="mt-1 text-[13px] text-muted">{r.decision.quote ? "Risk adjustment: " : "Because: "}{top}</div>}
        </div>
        {r.quote && (
          <div className="num text-right">
            <div className="text-[20px]">
              <span className="text-gain">{r.quote.bid?.price.toFixed(3) ?? "—"}</span>
              <span className="text-muted"> / </span>
              <span className="text-loss">{r.quote.ask?.price.toFixed(3) ?? "—"}</span>
            </div>
            <div className="text-[12px] text-muted">
              spread {cents(r.book.spread)} → <span className={r.improves ? "text-accent" : "text-text"}>{cents(r.quote.spread)}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function AnalyzeView({ examples }: { examples: { url: string; question: string }[] }) {
  const [q, setQ] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [choices, setChoices] = useState<Choices["choices"] | null>(null);

  async function run(query: string, marketId?: string) {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setChoices(null);
    try {
      const r = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: query, marketId, ai: useAi }) });
      const j = (await r.json()) as Result & Choices & { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Analysis failed");
      if (j.choices) setChoices(j.choices);
      else setResult(j);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-surface p-5 md:p-6">
        <h2 className="text-[18px] font-semibold tracking-tight">Run the engine on any market</h2>
        <p className="mt-1 text-[13px] text-muted">Paste a Polymarket link. You get the same pricing, rule checks, AI triage and risk decision the live engine makes every five minutes.</p>
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            run(q);
          }}
        >
          <label className="relative flex-1">
            <ScanSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="https://polymarket.com/event/…"
              aria-label="Polymarket link or slug"
              className="w-full rounded-xl border border-border bg-bg/50 py-3 pl-10 pr-3 text-[14px] text-text placeholder:text-muted focus:border-accent/50 focus:outline-none focus-visible:outline-none"
            />
          </label>
          <button disabled={loading || !q.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-[14px] font-medium text-bg hover:bg-[#4cc4da] disabled:opacity-40">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />} Analyze
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} className="accent-[#2cb0c8]" />
            Ask Claude (web research, ~20–40s)
          </label>
        </div>
        {examples.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="text-[12px] text-muted">Try:</span>
            {examples.map((x) => (
              <button
                key={x.url}
                onClick={() => {
                  setQ(x.url);
                  run(x.url);
                }}
                disabled={loading}
                className="max-w-[260px] truncate rounded-full border border-border px-3 py-1 text-[12px] text-muted hover:border-accent/40 hover:text-text disabled:opacity-50"
              >
                {x.question}
              </button>
            ))}
          </div>
        )}
      </section>

      {loading && (
        <section className="rounded-2xl border border-border bg-surface p-5 md:p-6">
          <Progress ai={useAi} />
        </section>
      )}
      {error && (
        <div className="rounded-xl border border-loss/30 bg-loss/5 p-4 text-[13px] text-loss" role="alert">
          {error}
        </div>
      )}
      {choices && (
        <Panel title="This event has several markets. Pick one" icon={ScanSearch}>
          <ul className="divide-y divide-border">
            {choices.map((c) => (
              <li key={c.id}>
                <button onClick={() => run(q, c.id)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-[13px] hover:text-accent">
                  <span className="min-w-0 truncate">{c.question}</span>
                  <ArrowRight size={14} className="shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {result && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 flex-1 text-[17px] font-medium leading-snug">{result.market.question}</h2>
            <Chip>{result.market.category}</Chip>
            <Chip tone={result.regime === "slow" ? "accent" : "warn"}>{result.regime === "slow" ? "slow information" : "live information"}</Chip>
            {result.market.endTime && <Chip>ends {new Date(result.market.endTime).toISOString().slice(0, 10)}</Chip>}
            <a href={result.market.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline">
              Polymarket <ExternalLink size={12} />
            </a>
          </div>

          <Verdict r={result} />

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Fair value" icon={Target}>
              <div className="flex items-center gap-5">
                <Ring value={result.fair} size={108}>
                  <div>
                    <div className="num text-[22px] leading-none">{Math.round(result.fair * 100)}%</div>
                    <div className="mt-1 text-[10px] text-muted">±{(result.sigma * 100).toFixed(1)}¢</div>
                  </div>
                </Ring>
                <ul className="flex-1 space-y-2">
                  {result.signals.map((s) => (
                    <li key={s.name} className="text-[12px]">
                      <div className="flex justify-between">
                        <span className="text-muted">{SIGNAL_LABEL[s.name] ?? s.name}</span>
                        <span className="num">{s.p.toFixed(3)}</span>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-raised">
                        <div className="h-1 rounded-full bg-accent" style={{ width: `${Math.min(1, s.weight) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              {result.calibratedFrom != null && <div className="mt-4 text-[12px] text-muted">Long-shot calibration moved fair from {result.calibratedFrom.toFixed(3)} to {result.fair.toFixed(3)}.</div>}
              <div className="mt-4">
                <PriceTrack bid={result.book.bid} ask={result.book.ask} ourBid={result.quote?.bid?.price ?? null} ourAsk={result.quote?.ask?.price ?? null} fair={result.fair} />
                <div className="num mt-0.5 flex justify-between text-[10px] text-muted">
                  <span>0</span>
                  <span>1</span>
                </div>
              </div>
            </Panel>

            <Panel title="Claude's triage" icon={Bot}>
              {result.ai ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { k: "insider risk", v: result.ai.insider_risk, good: result.ai.insider_risk <= 0.3 },
                      { k: "rule clarity", v: result.ai.resolution_clarity, good: result.ai.resolution_clarity >= 0.6 },
                    ].map((m) => (
                      <div key={m.k}>
                        <div className="flex justify-between text-[12px]">
                          <span className="text-muted">{m.k}</span>
                          <span className={clsx("num", m.good ? "text-gain" : "text-warn")}>{m.v.toFixed(2)}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-raised">
                          <div className={clsx("h-1.5 rounded-full", m.good ? "bg-gain" : "bg-warn")} style={{ width: `${m.v * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="num mt-4 text-[13px]">
                    Claude says <span className="text-accent">{Math.round(result.ai.probability * 100)}%</span>
                    <span className="text-muted"> · confidence {result.ai.confidence.toFixed(2)}</span>
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-text/90">{result.ai.rationale}</p>
                  {result.ai.key_evidence.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {result.ai.key_evidence.map((x) => (
                        <li key={x} className="flex gap-2 text-[12px] text-muted">
                          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
                          {x}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <div className="py-6 text-center text-[12px] text-muted">{result.aiNote ?? "Claude was not asked for this run."}</div>
              )}
            </Panel>

            <Panel title="Order book" icon={BookOpen} action={<Chip>{result.trades} trades / 7d</Chip>}>
              <Ladder bids={result.book.bids} asks={result.book.asks} />
            </Panel>
          </div>

          <Panel title="Risk checks" icon={result.decision.quote ? ShieldCheck : ShieldAlert}>
            <div className="flex flex-wrap gap-2">
              {result.rules.reasons.length === 0 && result.decision.reasons.length === 0 && <Chip tone="gain" icon={Check}>all checks passed</Chip>}
              {[...result.rules.reasons, ...result.decision.reasons.filter((x) => !result.rules.reasons.includes(x))].map((x) => (
                <Chip key={x} tone={result.decision.quote ? "muted" : "warn"}>
                  {x}
                </Chip>
              ))}
            </div>
            {result.market.rules && (
              <details className="mt-4 text-[12px] text-muted">
                <summary className="cursor-pointer text-text">Resolution rules</summary>
                <p className="mt-2 whitespace-pre-line leading-relaxed">{result.market.rules}</p>
              </details>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
