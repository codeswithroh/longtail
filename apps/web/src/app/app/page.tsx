import { Activity, ArrowRight, Bot, Coins, Radar, ShieldAlert, Vault, Zap } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { RunChart, Sparkline } from "@/components/charts";
import { Chip, Kpi, Panel, PriceTrack, RankList, Ring, SplitBar } from "@/components/viz";
import { readData, readTimeline, type PaperState } from "@/lib/data";
import { cents, reasonLabel, usd } from "@/lib/format";
import { readVault } from "@/lib/vault";
import type { Hip4Run } from "@/lib/hip4";

export default async function Overview() {
  await connection();
  const [paper, timeline, vault, hip4] = await Promise.all([readData<PaperState>("paper-state.json"), readTimeline(200), readVault(), readData<Hip4Run>("hip4-testnet.json")]);
  if (!paper) return <div className="py-24 text-center text-muted">The engine hasn&apos;t published yet.</div>;
  const s = paper.data.summary;
  const ms = paper.data.markets;
  const series = (k: "quoting" | "pnlUsd" | "rewardsUsd") => timeline.map((r) => r[k]);
  const ai = s.llm;
  const triaged = ai?.triaged ?? 0;
  const gated = ai?.gated ?? 0;
  const families = new Map<string, number>();
  for (const [k, v] of Object.entries(s.pullReasons)) families.set(reasonLabel(k), (families.get(reasonLabel(k)) ?? 0) + v);
  const reasons = [...families.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }));
  const tightest = ms
    .filter((m) => m.decision?.quote && m.improvesSpread && m.book?.spread != null && m.quote?.spread != null)
    .sort((a, b) => b.book!.spread! - b.quote!.spread! - (a.book!.spread! - a.quote!.spread!))
    .slice(0, 5);
  const resting = hip4?.data.lastOrders.filter((o) => o.status === "resting").length ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Kpi icon={Radar} label={`markets quoted of ${s.markets}`} value={s.quoting} delta={`${s.improvingSpread} tighter`} deltaTone="gain">
          <Sparkline values={series("quoting")} />
        </Kpi>
        <Kpi icon={Coins} label="rewards earned (est.)" value={usd(s.rewardsUsd, { digits: 2 })} delta={`${usd(s.rewardsDailyRunRateUsd)}/day`} deltaTone="gain" accent="#4cc38a">
          <Sparkline values={series("rewardsUsd")} color="#4cc38a" />
        </Kpi>
        <Kpi icon={Activity} label="trading PnL, mark-to-fair" value={usd(s.pnlUsd, { signed: true, digits: 2 })} delta={`${s.fills} fills`} deltaTone="muted" accent={s.pnlUsd >= 0 ? "#4cc38a" : "#f26d6d"}>
          <Sparkline values={series("pnlUsd")} color={s.pnlUsd >= 0 ? "#4cc38a" : "#f26d6d"} />
        </Kpi>
        <Kpi icon={Vault} label="vault share price" value={vault ? vault.pricePerShare.toFixed(4) : "—"} delta={vault ? usd(vault.totalAssets) : undefined} deltaTone="muted" accent="#e8b54a">
          <div className="px-1">
            {vault && (
              <SplitBar
                height={6}
                parts={[
                  { label: "deployed", value: Math.round(vault.deployedValue), color: "#2cb0c8" },
                  { label: "idle", value: Math.round(vault.idleAssets), color: "#3b4b4f" },
                ]}
              />
            )}
          </div>
        </Kpi>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Run so far" icon={Activity} className="lg:col-span-2" action={<Chip>cycle {s.cycles}</Chip>}>
          {timeline.length > 1 ? <RunChart rows={timeline} /> : <div className="grid h-[200px] place-items-center text-[12px] text-muted">Fills in as the engine cycles.</div>}
        </Panel>
        <Panel title="AI triage" icon={Bot} action={<Chip tone="accent">Claude</Chip>}>
          <div className="flex items-center gap-5">
            <Ring value={triaged ? (triaged - gated) / triaged : 0} size={112} color="#2cb0c8">
              <div>
                <div className="num text-[22px] leading-none">{triaged - gated}</div>
                <div className="mt-1 text-[10px] text-muted">cleared</div>
              </div>
            </Ring>
            <div className="space-y-3 text-[12px]">
              <div>
                <div className="num text-[18px] text-text">{triaged}</div>
                <div className="text-muted">markets analyzed</div>
              </div>
              <div>
                <div className="num text-[18px] text-warn">{gated}</div>
                <div className="text-muted">refused: insider or vague rules</div>
              </div>
            </div>
          </div>
          <div className="mt-5">
            <SplitBar
              parts={[
                { label: "quoting", value: s.quoting, color: "#2cb0c8" },
                { label: "standing aside", value: s.markets - s.quoting, color: "#e8b54a" },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Tightest books right now"
          icon={Zap}
          className="lg:col-span-2"
          action={
            <Link href="/app/markets" className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline">
              all markets <ArrowRight size={13} aria-hidden />
            </Link>
          }
        >
          <ul className="divide-y divide-border">
            {tightest.map((m) => (
              <li key={m.id} className="grid grid-cols-1 gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[1fr_200px_auto] sm:items-center sm:gap-4">
                <div className="min-w-0">
                  <div className="truncate text-[13px]">{m.question}</div>
                  <div className="mt-0.5 text-[11px] text-muted">{m.venue === "hip4" ? "Hyperliquid" : "Polymarket"} · {m.category}</div>
                </div>
                <PriceTrack bid={m.book?.bid ?? null} ask={m.book?.ask ?? null} ourBid={m.quote?.bid?.price ?? null} ourAsk={m.quote?.ask?.price ?? null} fair={m.fair} />
                <div className="num flex items-center gap-1.5 text-[12px]">
                  <span className="text-muted line-through decoration-muted/50">{cents(m.book?.spread, 0)}</span>
                  <ArrowRight size={12} className="text-muted" aria-hidden />
                  <span className="text-accent">{cents(m.quote?.spread, 0)}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-4 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-[#3b4b4f]" />venue spread</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-1 w-5 rounded-full bg-accent" />our quote</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-text" />fair value</span>
          </div>
        </Panel>
        <Panel title="Why it stands aside" icon={ShieldAlert}>
          <RankList rows={reasons} color="#e8b54a" />
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Hyperliquid HIP-4 testnet" icon={Zap} action={<Chip tone={hip4?.data.dryRun ? "muted" : "gain"}>{hip4?.data.dryRun ? "dry run" : "live orders"}</Chip>}>
          <div className="flex items-center gap-5">
            <Ring value={hip4 ? Math.min(1, (hip4.data.usdc ? hip4.data.lastOrders.filter((o) => o.status === "resting").reduce((a, o) => a + o.price * o.size, 0) / hip4.data.usdc : 0)) : 0} size={92} stroke={8} color="#4cc38a">
              <div>
                <div className="num text-[18px] leading-none">{resting}</div>
                <div className="mt-1 text-[10px] text-muted">resting</div>
              </div>
            </Ring>
            <div className="grid flex-1 grid-cols-2 gap-3 text-[12px]">
              <div>
                <div className="num text-[18px]">{usd(hip4?.data.usdc ?? 0)}</div>
                <div className="text-muted">testnet USDC</div>
              </div>
              <div>
                <div className="num text-[18px]">{hip4?.data.cycles ?? 0}</div>
                <div className="text-muted">cycles</div>
              </div>
            </div>
          </div>
        </Panel>
        <Panel
          title="Vault on HyperEVM"
          icon={Vault}
          action={
            <Link href="/app/vault" className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline">
              open <ArrowRight size={13} aria-hidden />
            </Link>
          }
        >
          {vault ? (
            <div className="grid grid-cols-3 gap-3 text-[12px]">
              <div>
                <div className="num text-[18px]">{usd(vault.totalAssets)}</div>
                <div className="text-muted">total assets</div>
              </div>
              <div>
                <div className="num text-[18px]">{vault.pricePerShare.toFixed(4)}</div>
                <div className="text-muted">share price</div>
              </div>
              <div>
                <div className={`num text-[18px] ${vault.isStale ? "text-warn" : "text-gain"}`}>{vault.isStale ? "stale" : "fresh"}</div>
                <div className="text-muted">NAV</div>
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-muted">Testnet RPC unreachable.</div>
          )}
        </Panel>
      </div>
    </div>
  );
}
