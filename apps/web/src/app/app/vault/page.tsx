import { Bot, CircleDot, Clock, Coins, Gauge, ShieldCheck, TrendingUp, Vault, Wallet, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { connection } from "next/server";
import { NavChart } from "@/components/charts";
import { CopyChip } from "@/components/app/copy-chip";
import { Chip, Kpi, Panel, PriceTrack, Ring } from "@/components/viz";
import { readData } from "@/lib/data";
import { ago, usd } from "@/lib/format";
import type { Hip4Run, NavReport } from "@/lib/hip4";
import { readVault, VAULT } from "@/lib/vault";

function FlowNode({ icon: Icon, title, value, sub, lit }: { icon: LucideIcon; title: string; value: string; sub: string; lit?: boolean }) {
  return (
    <div className={`relative z-10 flex min-w-0 flex-col items-center rounded-xl border p-4 text-center ${lit ? "border-accent/50 bg-accent/5" : "border-border bg-surface"}`}>
      <span className={`grid size-11 place-items-center rounded-full ${lit ? "bg-accent text-bg" : "bg-raised text-accent"}`}>
        <Icon size={20} aria-hidden />
      </span>
      <div className="mt-2.5 text-[13px] font-medium">{title}</div>
      <div className="num mt-1 text-[16px] text-text">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted">{sub}</div>
    </div>
  );
}

const GUARDS: { icon: LucideIcon; label: string }[] = [
  { icon: Gauge, label: "±5% max NAV move per report" },
  { icon: Clock, label: "10 min between reports" },
  { icon: ShieldCheck, label: "stale after 2 days → frozen" },
  { icon: TrendingUp, label: "10% fee above high-water mark" },
  { icon: CircleDot, label: "allow-listed venue accounts only" },
  { icon: Wallet, label: "withdrawals from idle cash" },
];

export default async function VaultPage() {
  await connection();
  const [v, navs, hip4] = await Promise.all([readVault(), readData<NavReport[]>("nav-reports.json"), readData<Hip4Run>("hip4-testnet.json")]);
  const reports = navs?.data ?? [];
  const h = hip4?.data;
  const resting = h?.lastOrders.filter((o) => o.status === "resting") ?? [];
  const byMarket = new Map<string, { q: string; yes?: number; no?: number }>();
  for (const o of h?.lastOrders ?? []) {
    const e = byMarket.get(o.marketId) ?? { q: o.question?.split(":")[0] ?? o.marketId };
    if (o.side === "bidYes") e.yes = o.price;
    else e.no = o.price;
    byMarket.set(o.marketId, e);
  }

  return (
    <div className="space-y-4">
      <Panel title="How capital flows" icon={Vault} action={<Chip tone={v ? "gain" : "warn"}>{v ? "live on HyperEVM testnet" : "RPC unreachable"}</Chip>}>
        <div className="relative grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="flow-line pointer-events-none absolute left-[12%] right-[12%] top-[38px] hidden h-px md:block" aria-hidden />
          <FlowNode icon={Wallet} title="LPs" value={v ? `${v.totalSupply.toFixed(0)}` : "—"} sub="ltUSDC shares" />
          <FlowNode icon={Vault} title="Vault" value={v ? usd(v.totalAssets) : "—"} sub={v ? `share price ${v.pricePerShare.toFixed(4)}` : "ERC-4626"} lit />
          <FlowNode icon={Bot} title="Keeper" value={v ? usd(v.deployedValue) : "—"} sub={v?.lastReportAt ? `NAV ${ago(v.lastReportAt)}` : "deployed"} />
          <FlowNode icon={Zap} title="Venues" value={`${resting.length} orders`} sub={h?.dryRun ? "dry run" : "Hyperliquid testnet"} />
        </div>
      </Panel>

      {v && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <Kpi icon={Coins} label="total assets (tUSDC)" value={usd(v.totalAssets)} />
          <Kpi icon={Zap} label="deployed to venues" value={usd(v.deployedValue)} accent="#4cc38a" />
          <Kpi icon={Wallet} label="idle, withdrawable" value={usd(v.idleAssets)} accent="#8a9ca1" />
          <Kpi icon={TrendingUp} label="share price" value={v.pricePerShare.toFixed(4)} delta={`${((v.pricePerShare - 1) * 100).toFixed(2)}%`} deltaTone={v.pricePerShare >= 1 ? "gain" : "loss"} accent="#e8b54a" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="NAV reports on-chain" icon={TrendingUp} className="lg:col-span-2" action={<Chip>{reports.length} reports</Chip>}>
          {reports.length > 0 ? (
            <NavChart rows={reports.map((r) => ({ t: r.t, v: r.deployedValue }))} />
          ) : (
            <div className="grid h-[220px] place-items-center text-[12px] text-muted">First report posts within the hour.</div>
          )}
        </Panel>
        <Panel title="Guardrails" icon={ShieldCheck}>
          {v && (
            <div className="mb-4 flex items-center gap-4">
              <Ring value={v.totalAssets ? v.deployedValue / v.totalAssets : 0} size={84} stroke={8}>
                <div className="num text-[15px]">{v.totalAssets ? Math.round((v.deployedValue / v.totalAssets) * 100) : 0}%</div>
              </Ring>
              <div className="text-[12px] text-muted">of assets deployed; the rest stays idle for withdrawals</div>
            </div>
          )}
          <ul className="space-y-2">
            {GUARDS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2.5 text-[12px]">
                <Icon size={14} className="shrink-0 text-gain" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Live quotes on Hyperliquid testnet" icon={Zap} className="lg:col-span-2" action={<Chip tone={h?.dryRun ? "muted" : "gain"}>{h ? `${h.dryRun ? "dry run" : "resting"} · ${ago(h.updatedAt)}` : "—"}</Chip>}>
          <ul className="divide-y divide-border">
            {[...byMarket.entries()].slice(0, 6).map(([id, m]) => (
              <li key={id} className="grid grid-cols-1 gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[1fr_220px_auto] sm:items-center sm:gap-4">
                <span className="truncate text-[13px]">{m.q}</span>
                <PriceTrack bid={null} ask={null} ourBid={m.yes ?? null} ourAsk={m.no != null ? 1 - m.no : null} fair={null} />
                <span className="num text-[12px]">
                  <span className="text-gain">{m.yes?.toFixed(3) ?? "—"}</span>
                  <span className="text-muted"> / </span>
                  <span className="text-loss">{m.no != null ? (1 - m.no).toFixed(3) : "—"}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] text-muted">Bid = buy YES · offer = buy NO at 1 − price. No inventory, nothing to liquidate.</p>
        </Panel>
        <Panel title="Contracts" icon={CircleDot}>
          <div className="space-y-2">
            <CopyChip label="LongtailVault" value={VAULT.vault} />
            <CopyChip label="tUSDC (test asset)" value={VAULT.asset} />
            <CopyChip label="Keeper" value={VAULT.keeper} />
            {reports.at(-1) && <CopyChip label="Last reportNav tx" value={reports.at(-1)!.tx} />}
          </div>
          <div className="mt-3 text-[11px] text-muted">chain {VAULT.chainId} · test tokens only</div>
        </Panel>
      </div>
    </div>
  );
}
