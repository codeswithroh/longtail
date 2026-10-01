import { Card, PageHeader, Pill } from "@/components/ui";

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

export default function VaultPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Vault: pooled liquidity, on-chain accountability"
        lede="LPs deposit USDC into an ERC-4626 vault. The keeper deploys capital to venue accounts, quotes the long tail, and reports NAV on-chain with a link to the full position snapshot. A buggy or compromised keeper can only move NAV slowly, and the owner can pause in the meantime."
        right={<Pill tone="warn">not deployed · paper mode</Pill>}
      />

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
