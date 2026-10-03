import { ArrowRight, ArrowUpRight, Ban, Bot, Code, Radar, ShieldCheck, Target, Vault, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { ArmBars, CalibrationChart, RankBuckets } from "@/components/charts";
import { TailViz } from "@/components/landing/tail-viz";
import { Mark } from "@/components/ui";
import { LiveDot } from "@/components/viz";
import { readData, type Backtest, type Census, type LlmEval, type PaperState } from "@/lib/data";
import { int, pct, usd } from "@/lib/format";
import { readVault } from "@/lib/vault";

const REPO = "https://github.com/codeswithroh/longtail";

function Cta({ className = "" }: { className?: string }) {
  return (
    <Link href="/app" className={`inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-[14px] font-medium text-bg transition-colors duration-150 hover:bg-[#4cc4da] ${className}`}>
      Launch app <ArrowRight size={16} aria-hidden />
    </Link>
  );
}

function Section({ id, eyebrow, title, lede, children }: { id: string; eyebrow: string; title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 py-[clamp(72px,10vw,128px)]">
      <div className="max-w-2xl">
        <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-accent">{eyebrow}</div>
        <h2 className="mt-3 text-[clamp(26px,3.4vw,40px)] font-semibold leading-[1.12] tracking-tight">{title}</h2>
        {lede && <p className="mt-4 text-[16px] leading-relaxed text-muted">{lede}</p>}
      </div>
      <div className="mt-10">{children}</div>
    </section>
  );
}

function BigStat({ value, label, tone = "text-text" }: { value: string; label: string; tone?: string }) {
  return (
    <div className="border-l border-border pl-5">
      <div className={`num text-[clamp(30px,4vw,48px)] leading-none ${tone}`}>{value}</div>
      <div className="mt-3 max-w-[22ch] text-[14px] leading-snug text-muted">{label}</div>
    </div>
  );
}

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Radar, title: "Classify", body: "Separates slow-information markets from live ones where a resting quote gets picked off." },
  { icon: Target, title: "Price", body: "Blends book, trades and history, then corrects the long-shot bias with a fitted calibration curve." },
  { icon: Bot, title: "Triage", body: "A Claude agent reads each market's rules and refuses insider-prone or ambiguous ones." },
  { icon: ShieldCheck, title: "Risk", body: "Toxicity markouts, drift guard, worst-case sizing, reduce-only before resolution." },
  { icon: Zap, title: "Quote", body: "Post-only, two-sided quotes on Polymarket and Hyperliquid HIP-4, every five minutes." },
];

export default async function Landing() {
  await connection();
  const [c, b, e, p, v] = await Promise.all([readData<Census>("census.json"), readData<Backtest>("backtest.json"), readData<LlmEval>("llm-eval.json"), readData<PaperState>("paper-state.json"), readVault()]);
  const census = c?.data;
  const pm = census?.polymarket;
  const top = census?.charts.rankBuckets[0];
  const w = b?.data.walkForward;
  const ai = e?.data;
  const s = p?.data.summary;
  const fresh = s ? Date.now() - s.updatedAt < 12 * 60_000 : false;

  return (
    <div className="relative overflow-x-clip">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[720px] bg-[radial-gradient(60%_50%_at_50%_0%,rgba(44,176,200,0.16),transparent)]" aria-hidden />

      <header className="sticky top-0 z-30 border-b border-border/60 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 md:px-8">
          <Link href="/" className="flex items-center gap-2">
            <Mark size={22} />
            <span className="text-[16px] font-semibold tracking-tight">Longtail</span>
          </Link>
          <nav aria-label="Site" className="hidden items-center gap-7 text-[14px] text-muted md:flex">
            <a href="#problem" className="hover:text-text">Problem</a>
            <a href="#how" className="hover:text-text">How it works</a>
            <a href="#evidence" className="hover:text-text">Evidence</a>
            <a href="#vault" className="hover:text-text">Vault</a>
          </nav>
          <div className="flex items-center gap-2">
            <a href={REPO} target="_blank" rel="noreferrer" className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-[14px] text-muted hover:text-text sm:inline-flex">
              <Code size={16} aria-hidden /> GitHub
            </a>
            <Link href="/app" className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[14px] font-medium text-bg hover:bg-[#4cc4da]">
              Launch app <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-[1200px] px-5 md:px-8">
        {/* Hero */}
        <section className="grid items-center gap-12 pb-16 pt-14 md:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[12px] text-muted">
              <LiveDot ok={fresh} />
              {s ? `Quoting ${s.quoting} markets right now` : "Live engine"}
            </span>
            <h1 className="mt-6 text-[clamp(36px,5.4vw,62px)] font-semibold leading-[1.04] tracking-tight">
              Every market deserves a <span className="text-accent">market maker.</span>
            </h1>
            <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-muted">
              Creating a prediction market is free. Making it tradeable isn&apos;t. Longtail is an AI-agent liquidity network that prices, quotes and risk-manages the
              long tail nobody else makes.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Cta />
              <a href="#evidence" className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-3 text-[14px] text-text hover:bg-surface">
                See the evidence
              </a>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface/70 p-5 shadow-[0_0_80px_-20px_rgba(44,176,200,0.25)] md:p-6">
            <div className="mb-4 flex items-center justify-between text-[12px]">
              <span className="text-muted">24h volume by market rank · {pm ? int(pm.all.markets) : "186,561"} markets</span>
              <span className="num text-accent">Polymarket</span>
            </div>
            <TailViz topShare={top?.volumeShare} />
            <div className="mt-5 grid grid-cols-3 gap-2">
              {[
                ["markets quoted", s ? String(s.quoting) : "—"],
                ["rewards/day", s ? usd(s.rewardsDailyRunRateUsd) : "—"],
                ["vault share", v ? v.pricePerShare.toFixed(4) : "—"],
              ].map(([k, val]) => (
                <div key={k} className="rounded-lg bg-raised px-3 py-2.5">
                  <div className="num text-[16px]">{val}</div>
                  <div className="mt-0.5 text-[11px] text-muted">{k}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Venues strip */}
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 border-y border-border/60 py-6 text-[14px] text-muted">
          <span className="text-[12px] uppercase tracking-[0.12em]">Runs on</span>
          <span className="text-text/80">Polymarket</span>
          <span className="text-text/80">Hyperliquid HIP-4</span>
          <span className="text-text/80">HyperEVM</span>
          <span className="text-text/80">Kalshi data</span>
          <span className="text-text/80">Claude</span>
        </div>

        {/* Problem */}
        <Section id="problem" eyebrow="The problem" title="Listing is cheap. Liquidity isn't." lede="A census of every open market shows the same power law on every venue: a handful of headline markets take all the volume, and everything else waits for a counterparty that never comes.">
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
            <BigStat value={pm ? int(pm.all.markets) : "186,561"} label="open Polymarket markets with an order book" />
            <BigStat value={pct(top?.volumeShare ?? 0.61)} label={`of 24h volume in the top ${int(top?.markets ?? 186)} markets`} tone="text-warn" />
            <BigStat value={pm ? usd(pm.addressableLongTail.depthWithin2cMedianUsd, { digits: 0 }) : "$4"} label="median depth within 2¢ on the long tail" tone="text-loss" />
            <BigStat value={census?.rewards ? `${usd(census.rewards.addressableLongTail.dailyUsd)}` : "$29.2k"} label="per day in maker rewards already on offer there" tone="text-gain" />
          </div>
          {census && (
            <div className="mt-12 rounded-2xl border border-border bg-surface p-5 md:p-6">
              <div className="mb-3 text-[13px] text-muted">Share of 24h volume by market rank</div>
              <RankBuckets data={census.charts.rankBuckets} />
            </div>
          )}
        </Section>

        {/* How it works */}
        <Section id="how" eyebrow="How it works" title="Knowing when not to quote is the product." lede="Naive market making on thin markets loses to adverse selection. Longtail's engine decides, market by market and every five minutes, whether a quote is safe to post.">
          <ol className="grid gap-3 md:grid-cols-5">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="relative rounded-xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <span className="grid size-10 place-items-center rounded-lg bg-accent/10 text-accent">
                    <Icon size={19} aria-hidden />
                  </span>
                  <span className="num text-[12px] text-muted">0{i + 1}</span>
                </div>
                <div className="mt-4 text-[15px] font-medium">{title}</div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* Evidence */}
        <Section id="evidence" eyebrow="Evidence" title="Tested on markets that already resolved." lede="Walk-forward replay: calibration fitted on older markets, every strategy scored on newer ones, fills only on real taker prints, settled at the real outcome.">
          <div className="grid gap-4 lg:grid-cols-6">
            {w && (
              <div className="rounded-2xl border border-border bg-surface p-5 md:p-6 lg:col-span-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-[15px] font-medium">PnL after settlement, {int(w.testMarkets)} unseen markets</div>
                  <div className="num text-[13px]">
                    <span className="text-loss">{pct(w.arms.naive.returnOnPeakCapital, 1)}</span>
                    <span className="text-muted"> → </span>
                    <span className="text-gain">{w.arms.plusCalibration.returnOnPeakCapital >= 0 ? "+" : ""}{pct(w.arms.plusCalibration.returnOnPeakCapital, 1)}</span>
                  </div>
                </div>
                <div className="mt-4">
                  <ArmBars
                    height={190}
                    arms={[
                      { name: "Naive", pnl: Math.round(w.arms.naive.pnlUsd) },
                      { name: "Risk engine", pnl: Math.round(w.arms.riskEngine.pnlUsd) },
                      { name: "+ drift guard", pnl: Math.round(w.arms.plusDriftGuard.pnlUsd) },
                      { name: "+ calibration", pnl: Math.round(w.arms.plusCalibration.pnlUsd) },
                    ]}
                  />
                </div>
              </div>
            )}
            {w && (
              <div className="rounded-2xl border border-border bg-surface p-5 md:p-6 lg:col-span-2">
                <div className="text-[15px] font-medium">Long-shot bias, corrected</div>
                <div className="num mt-1 text-[13px] text-muted">
                  Brier {w.brierMarket.toFixed(4)} → <span className="text-gain">{w.brierCalibrated.toFixed(4)}</span>
                </div>
                <div className="mt-3">
                  <CalibrationChart points={w.curve} />
                </div>
              </div>
            )}
            {ai && (
              <div className="grid gap-4 sm:grid-cols-2 lg:col-span-6 lg:grid-cols-3">
                <div className="rounded-2xl border border-border bg-surface p-6">
                  <Bot size={20} className="text-accent" aria-hidden />
                  <div className="mt-4 text-[15px] font-medium">Claude, out of sample</div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{int(ai.markets)} markets that resolved after its training cutoff. Blended with the calibrated price it beats the market.</p>
                  <div className="num mt-4 text-[13px]">
                    Brier {ai.forecast.brierMarket.toFixed(4)} → <span className="text-gain">{ai.forecast.brierBlend.toFixed(4)}</span>
                  </div>
                </div>
                <div className="rounded-2xl border border-loss/25 bg-loss/[0.04] p-6">
                  <Ban size={20} className="text-loss" aria-hidden />
                  <div className="num mt-4 text-[32px] leading-none text-loss">{usd(ai.triage.flagged.pnlUsd, { signed: true })}</div>
                  <p className="mt-3 text-[13px] text-muted">lost by the {ai.triage.flagged.markets} markets the agent refused to quote</p>
                </div>
                <div className="rounded-2xl border border-gain/25 bg-gain/[0.04] p-6">
                  <ShieldCheck size={20} className="text-gain" aria-hidden />
                  <div className="num mt-4 text-[32px] leading-none text-gain">{usd(ai.triage.kept.pnlUsd, { signed: true })}</div>
                  <p className="mt-3 text-[13px] text-muted">earned by the {ai.triage.kept.markets} markets it cleared</p>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* Vault */}
        <Section id="vault" eyebrow="On-chain" title="Pooled capital with a leash." lede="LPs fund an ERC-4626 vault. The keeper deploys to venue accounts and reports NAV on-chain, each report pinned to the hash of the published positions and bounded so a faulty keeper can only move NAV slowly.">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { icon: Vault, k: "Vault total assets", val: v ? usd(v.totalAssets) : "—", sub: "HyperEVM testnet · chain 998" },
              { icon: Zap, k: "Live testnet quotes", val: "Hyperliquid HIP-4", sub: "bid YES + bid NO: no inventory, no liquidation" },
              { icon: ShieldCheck, k: "Guardrails", val: "±5% · 10 min · 2 days", sub: "max NAV move · report interval · staleness freeze" },
            ].map(({ icon: Icon, k, val, sub }) => (
              <div key={k} className="rounded-2xl border border-border bg-surface p-6">
                <Icon size={20} className="text-accent" aria-hidden />
                <div className="mt-4 text-[13px] text-muted">{k}</div>
                <div className="num mt-1 text-[20px]">{val}</div>
                <div className="mt-2 text-[12px] text-muted">{sub}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Final CTA */}
        <section className="mb-20 overflow-hidden rounded-2xl border border-accent/30 bg-[radial-gradient(80%_120%_at_50%_0%,rgba(44,176,200,0.18),transparent)] px-6 py-14 text-center md:py-20">
          <h2 className="mx-auto max-w-2xl text-[clamp(26px,3.4vw,40px)] font-semibold leading-tight tracking-tight">Watch the engine quote the long tail, live.</h2>
          <p className="mx-auto mt-4 max-w-xl text-[16px] text-muted">Every market, every decision and every on-chain report, updated every five minutes.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Cta />
            <a href={REPO} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-3 text-[14px] hover:bg-surface">
              Read the code <ArrowUpRight size={15} aria-hidden />
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-5 py-8 text-[13px] text-muted md:px-8">
          <span className="flex items-center gap-2">
            <Mark size={18} /> Longtail · built for the Crypto World&apos;s Fair, Oct 2026
          </span>
          <span>Paper trading and testnet only. Not investment advice.</span>
        </div>
      </footer>
    </div>
  );
}
