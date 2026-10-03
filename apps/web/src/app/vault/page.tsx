import { connection } from "next/server";
import { Card, PageHeader, Pill, Stat } from "@/components/ui";
import { readData } from "@/lib/data";
import { ago, usd } from "@/lib/format";
import { readVault, VAULT } from "@/lib/vault";

interface NavReport {
  t: number;
  deployedValue: number;
  paperReturn: number;
  snapshotHash: string;
  tx: string;
  status: string;
}

interface Hip4Run {
  dryRun: boolean;
  updatedAt: number;
  cycles: number;
  usdc: number;
  markets: { id: string; question: string }[];
  lastOrders: { marketId: string; side: string; price: number; size: number; status: string; question?: string }[];
  fills: unknown[];
}

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

function Addr({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 py-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="num break-all text-text">{value}</dd>
    </div>
  );
}

const PARAMS = [
  { k: "Asset", v: "USDC (6 decimals), ERC-4626 shares ltUSDC" },
  { k: "Max NAV move per report", v: "5% of total assets" },
  { k: "Min time between reports", v: "10 minutes" },
  { k: "NAV goes stale after", v: "2 days → deposits and withdrawals freeze" },
  { k: "Performance fee", v: "10% of gains above the high-water mark" },
  { k: "Withdrawals", v: "served from idle USDC; deployed capital returns via the keeper" },
  { k: "Inflation-attack guard", v: "virtual-share offset of 10⁶" },
  { k: "Venue accounts", v: "owner allow-list; keeper can only send funds there" },
];

const TESTS = [
  "deposit and redeem round-trip at par",
  "capital moves only to allow-listed venue accounts, only by the keeper",
  "withdrawals capped at idle USDC",
  "NAV reports rate-limited and bounded to ±5%",
  "stale NAV freezes deposits and withdrawals",
  "performance fee only above the high-water mark",
  "recall returns principal and reduces deployed value",
  "first-depositor inflation attack is unprofitable",
  "deposit cap enforced",
];

function Node({ title, body, accent }: { title: string; body: string; accent?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2.5 ${accent ? "border-accent/50 bg-raised" : "border-border bg-surface"}`}>
      <div className="text-[12px] font-medium">{title}</div>
      <div className="mt-0.5 text-[11px] leading-snug text-muted">{body}</div>
    </div>
  );
}

const Arrow = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center justify-center px-1 text-center text-[10px] text-muted">
    <span className="num">{label}</span>
    <span aria-hidden className="text-accent">
      ⟶
    </span>
  </div>
);

export default async function VaultPage() {
  await connection();
  const [v, navs, hip4] = await Promise.all([readVault(), readData<NavReport[]>("nav-reports.json"), readData<Hip4Run>("hip4-testnet.json")]);
  const reports = (navs?.data ?? []).slice(-8).reverse();
  const orders = hip4?.data.lastOrders ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Vault: pooled liquidity, on-chain accountability"
        lede="LPs deposit USDC into an ERC-4626 vault. The keeper deploys capital to venue accounts, quotes the long tail, and reports NAV on-chain with a link to the full position snapshot. A buggy or compromised keeper can only move NAV slowly, and the owner can pause in the meantime."
        right={<Pill tone={v ? "accent" : "warn"}>{v ? `live on ${VAULT.network}` : "testnet RPC unreachable"}</Pill>}
      />

      <Card title="On-chain now" note={`${VAULT.network} · chain ${VAULT.chainId} · read live from the RPC`}>
        {v ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
              <Stat label="Total assets" value={`${usd(v.totalAssets)}`} sub="tUSDC (test token)" />
              <Stat label="Deployed" value={usd(v.deployedValue)} sub="at the keeper's venue account" />
              <Stat label="Idle" value={usd(v.idleAssets)} sub="available for withdrawals" />
              <Stat label="Price per share" value={v.pricePerShare.toFixed(4)} sub="tUSDC per ltUSDC" />
              <Stat label="Last NAV report" value={v.lastReportAt ? ago(v.lastReportAt) : "—"} sub={v.isStale ? "stale: deposits frozen" : "fresh"} tone={v.isStale ? "text-warn" : undefined} />
              <Stat label="Snapshot hash" value={<span className="text-[13px]">{short(v.lastSnapshotHash)}</span>} sub="keccak256 of paper-state.json" />
            </div>
            <dl className="divide-y divide-border text-[12px]">
              <Addr label="Vault" value={VAULT.vault} />
              <Addr label="Asset (tUSDC)" value={VAULT.asset} />
              <Addr label="Keeper" value={VAULT.keeper} />
              <Addr label="RPC" value={VAULT.rpc} />
            </dl>
          </div>
        ) : (
          <div className="py-8 text-center text-[12px] text-muted">Couldn&apos;t reach the HyperEVM testnet RPC just now.</div>
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-muted">
          The keeper mirrors the paper portfolio&apos;s return (net PnL plus estimated rewards, on its $5k risk budget) into the vault every hour, each report pinned to the hash of the state file it was computed from. Every report must pass the contract&apos;s ±5% and 10-minute limits. Test tokens only.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="NAV reports" note="keeper → reportNav()">
          {reports.length ? (
            <table className="w-full text-[12px]">
              <thead className="text-left text-[11px] text-muted">
                <tr>
                  <th className="pb-2 font-normal">when</th>
                  <th className="pb-2 text-right font-normal">deployed value</th>
                  <th className="pb-2 text-right font-normal">paper return</th>
                  <th className="pb-2 pl-4 font-normal">tx</th>
                </tr>
              </thead>
              <tbody className="num divide-y divide-border">
                {reports.map((r) => (
                  <tr key={r.tx}>
                    <td className="py-1.5 text-muted">{ago(r.t)}</td>
                    <td className="py-1.5 text-right">{usd(r.deployedValue)}</td>
                    <td className={`py-1.5 text-right ${r.paperReturn >= 0 ? "text-gain" : "text-loss"}`}>{(r.paperReturn * 100).toFixed(2)}%</td>
                    <td className="py-1.5 pl-4 text-muted" title={r.tx}>{short(r.tx)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-8 text-center text-[12px] text-muted">The first report posts within the hour.</div>
          )}
        </Card>
        <Card title="Hyperliquid HIP-4 testnet" note={hip4 ? `${hip4.data.dryRun ? "dry run" : "live testnet orders"} · ${ago(hip4.data.updatedAt)}` : undefined}>
          {hip4 ? (
            <>
              <p className="mb-3 text-[12px] leading-relaxed text-muted">
                The same engine quotes HIP-4 outcome books: a bid buys YES, an offer buys NO at 1 − price, so a two-sided quote needs no inventory and can&apos;t be liquidated.{" "}
                {hip4.data.dryRun ? "Orders are built and signed but not sent until the keeper holds testnet USDC." : `Keeper testnet balance ${usd(hip4.data.usdc)}.`}
              </p>
              <table className="w-full text-[12px]">
                <tbody className="num divide-y divide-border">
                  {orders.slice(0, 8).map((o, i) => (
                    <tr key={i}>
                      <td className="max-w-[260px] truncate py-1.5 pr-3 font-sans text-text" title={o.question}>{o.question?.split(":")[0] ?? o.marketId}</td>
                      <td className="py-1.5 text-muted">{o.side === "bidYes" ? "bid YES" : "bid NO"}</td>
                      <td className="py-1.5 text-right">{o.price.toFixed(3)}</td>
                      <td className="py-1.5 text-right text-muted">×{o.size}</td>
                      <td className={`py-1.5 pl-3 text-right ${o.status === "resting" ? "text-gain" : o.status === "dry-run" ? "text-muted" : "text-warn"}`}>{o.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="py-8 text-center text-[12px] text-muted">No HIP-4 testnet run published yet.</div>
          )}
        </Card>
      </div>

      <Card title="How capital flows">
        <div className="grid items-stretch gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
          <Node title="LP deposits" body="USDC in, ltUSDC shares out at NAV" />
          <Arrow label="deposit" />
          <Node title="LongtailVault" body="idle USDC + reported venue value = total assets" accent />
          <Arrow label="deploy" />
          <Node title="Venue accounts" body="Polymarket (Polygon), Hyperliquid HIP-4" />
          <Arrow label="quote" />
          <Node title="Long-tail books" body="risk engine sets size, spread and when to stand aside" />
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <Node title="reportNav(value, snapshotHash, uri)" body="keeper posts venue value; hash pins the published position list; fee accrues above high-water mark" />
          <Node title="recall(account, amount)" body="keeper pulls USDC back so LPs can withdraw; withdrawals never exceed idle cash" />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Parameters" note="contract defaults, owner-adjustable within hard bounds">
          <dl className="divide-y divide-border text-[12px]">
            {PARAMS.map((p) => (
              <div key={p.k} className="grid grid-cols-[180px_1fr] gap-3 py-2">
                <dt className="text-muted">{p.k}</dt>
                <dd className="num text-text">{p.v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Test suite" note="Foundry · contracts/test/LongtailVault.t.sol">
          <ul className="space-y-1.5 text-[12px]">
            {TESTS.map((t) => (
              <li key={t} className="flex items-start gap-2">
                <span className="num text-gain">pass</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] leading-relaxed text-muted">
            Tested, not audited. Before any deposits: an external audit, a multisig owner, and a deposit cap sized to what the backtest supports.
          </p>
        </Card>
      </div>
    </div>
  );
}
