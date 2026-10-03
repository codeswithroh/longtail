"use client";
import clsx from "clsx";
import { ArrowDownToLine, ArrowUpFromLine, Check, Copy, Droplets, Loader2, PiggyBank, Sparkles, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConnectDialog } from "./connect";
import { fmtUsdc, useWallet } from "./wallet";

const STEPS = [
  { icon: Wallet, title: "Connect", body: "Demo wallet or your own" },
  { icon: Droplets, title: "Get test funds", body: "Gas + 1,000 tUSDC, free" },
  { icon: ArrowDownToLine, title: "Deposit", body: "Receive ltUSDC shares" },
  { icon: ArrowUpFromLine, title: "Withdraw", body: "Any time, from idle cash" },
];

function Step({ i, icon: Icon, title, body, done, active, children }: { i: number; icon: typeof Wallet; title: string; body: string; done: boolean; active: boolean; children?: React.ReactNode }) {
  return (
    <li className={clsx("flex items-start gap-3 rounded-xl border p-3", active ? "border-accent/50 bg-accent/5" : "border-border")}>
      <span className={clsx("grid size-8 shrink-0 place-items-center rounded-full text-[12px]", done ? "bg-gain/15 text-gain" : active ? "bg-accent text-bg" : "bg-raised text-muted")}>
        {done ? <Check size={15} aria-label="done" /> : <Icon size={15} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">
          <span className="num mr-1.5 text-muted">{i}</span>
          {title}
        </div>
        <div className="text-[12px] text-muted">{body}</div>
        {children}
      </div>
    </li>
  );
}

export function EarnPanel({ pricePerShare }: { pricePerShare: number | null }) {
  const w = useWallet();
  const router = useRouter();
  // After a confirmed transaction, re-render the server-side vault panels below with fresh chain state.
  const confirmed = w.txs.filter((t) => t.status === "success").length;
  useEffect(() => {
    if (!confirmed) return;
    const id = setTimeout(() => router.refresh(), 4000);
    return () => clearTimeout(id);
  }, [confirmed, router]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [pct, setPct] = useState(100);
  const b = w.balances;
  const hasFunds = !!b && b.usdc + b.assets > 0n && b.hype > 0n;
  const deposited = !!b && b.shares > 0n;
  const amt = BigInt(Math.max(0, Math.floor((Number(amount) || 0) * 1e6)));
  const redeemShares = b ? (b.maxRedeem * BigInt(pct)) / 100n : 0n;
  const stale = !!b && b.maxDeposit === 0n;

  if (!w.address)
    return (
      <section className="overflow-hidden rounded-2xl border border-accent/30 bg-[radial-gradient(80%_140%_at_0%_0%,rgba(44,176,200,0.16),transparent)] p-5 md:p-7">
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto]">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight md:text-[26px]">Earn from the long tail</h2>
            <p className="mt-2 max-w-xl text-[14px] text-muted">Deposit into the vault, and the engine puts it to work quoting markets nobody else makes. Try the full flow on testnet in under a minute.</p>
            <ol className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="rounded-xl border border-border bg-bg/40 p-3">
                  <Icon size={17} className="text-accent" aria-hidden />
                  <div className="mt-2 text-[13px] font-medium">
                    <span className="num mr-1 text-muted">{i + 1}</span>
                    {title}
                  </div>
                  <div className="text-[11px] text-muted">{body}</div>
                </li>
              ))}
            </ol>
          </div>
          <button onClick={() => setConnectOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3.5 text-[15px] font-medium text-bg hover:bg-[#4cc4da]">
            <Sparkles size={17} aria-hidden /> Start
          </button>
        </div>
        {connectOpen && <ConnectDialog onClose={() => setConnectOpen(false)} />}
      </section>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="min-w-0 rounded-xl border border-border bg-surface p-4 md:p-5 lg:col-span-2">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <PiggyBank size={15} className="text-accent" aria-hidden /> Your position
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <div className="num text-[26px] leading-none">{b ? fmtUsdc(b.assets) : "—"}</div>
            <div className="mt-1.5 text-[12px] text-muted">value, tUSDC</div>
          </div>
          <div>
            <div className="num text-[18px] leading-none">{b ? (Number(b.shares) / 1e12).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</div>
            <div className="mt-1.5 text-[12px] text-muted">ltUSDC shares</div>
          </div>
          <div>
            <div className="num text-[18px] leading-none">{b && b.vaultAssets > 0n ? `${((Number(b.assets) / Number(b.vaultAssets)) * 100).toFixed(1)}%` : "—"}</div>
            <div className="mt-1.5 text-[12px] text-muted">of the vault</div>
          </div>
          <div>
            <div className="num text-[18px] leading-none">{b ? fmtUsdc(b.usdc) : "—"}</div>
            <div className="mt-1.5 text-[12px] text-muted">wallet tUSDC</div>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-border bg-bg/40 p-4">
          <div role="tablist" className="inline-flex rounded-lg bg-raised p-1">
            {(["deposit", "withdraw"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx("rounded-md px-4 py-1.5 text-[13px] capitalize", tab === t ? "bg-surface text-text" : "text-muted hover:text-text")}>
                {t}
              </button>
            ))}
          </div>

          {tab === "deposit" ? (
            <div className="mt-4">
              <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:border-accent/50">
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="0.00"
                  aria-label="Deposit amount in tUSDC"
                  className="num min-w-0 flex-1 bg-transparent py-3 text-[20px] text-text placeholder:text-muted focus:outline-none focus-visible:outline-none"
                />
                <span className="text-[13px] text-muted">tUSDC</span>
                <button onClick={() => b && setAmount(String(Number(b.usdc) / 1e6))} className="rounded-md bg-raised px-2 py-1 text-[11px] text-accent hover:bg-raised/70">
                  MAX
                </button>
              </div>
              <div className="mt-2 flex justify-between text-[12px] text-muted">
                <span>≈ {pricePerShare && amt > 0n ? ((Number(amt) / 1e6) / pricePerShare).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0"} ltUSDC</span>
                <span>share price {pricePerShare?.toFixed(4) ?? "—"}</span>
              </div>
              <button
                onClick={() => w.deposit(amt)}
                disabled={!!w.busy || amt === 0n || !b || amt > b.usdc || stale}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-[14px] font-medium text-bg hover:bg-[#4cc4da] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {w.busy === "deposit" ? <Loader2 size={16} className="animate-spin" /> : <ArrowDownToLine size={16} />}
                {w.busy === "deposit" ? "Confirming…" : b && amt > b.usdc ? "Not enough tUSDC" : stale ? "Deposits paused (NAV stale)" : "Deposit"}
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <div className="grid grid-cols-4 gap-2">
                {[25, 50, 75, 100].map((p) => (
                  <button key={p} onClick={() => setPct(p)} className={clsx("rounded-lg border py-2 text-[13px]", pct === p ? "border-accent/50 bg-accent/10 text-text" : "border-border text-muted hover:text-text")}>
                    {p}%
                  </button>
                ))}
              </div>
              <div className="mt-3 flex justify-between text-[12px] text-muted">
                <span>you receive ≈ <span className="num text-text">{b && b.shares > 0n ? fmtUsdc((b.assets * redeemShares) / b.shares) : "0.00"}</span> tUSDC</span>
                <span>withdrawable now {b ? `${fmtUsdc(b.shares > 0n ? (b.assets * b.maxRedeem) / b.shares : 0n)}` : "—"}</span>
              </div>
              <button
                onClick={() => w.redeem(redeemShares)}
                disabled={!!w.busy || redeemShares === 0n}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-accent/50 py-3 text-[14px] font-medium text-text hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {w.busy === "redeem" ? <Loader2 size={16} className="animate-spin" /> : <ArrowUpFromLine size={16} />}
                {w.busy === "redeem" ? "Confirming…" : "Withdraw"}
              </button>
            </div>
          )}
          {w.error && (
            <p className="mt-3 text-[12px] text-loss" role="alert">
              {w.error}
            </p>
          )}
        </div>
      </section>

      <div className="space-y-4">
        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="text-[13px] font-medium">Try it</div>
          <ol className="mt-3 space-y-2">
            <Step i={1} icon={Wallet} title="Connected" body={w.kind === "demo" ? "Demo wallet in this browser" : "Browser wallet"} done active={false} />
            <Step i={2} icon={Droplets} title="Get test funds" body={b ? `${(Number(b.hype) / 1e18).toFixed(4)} HYPE · ${fmtUsdc(b.usdc)} tUSDC` : "Loading balances…"} done={hasFunds} active={!hasFunds}>
              {!hasFunds && (
                <button onClick={w.requestFunds} disabled={!!w.busy} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-bg hover:bg-[#4cc4da] disabled:opacity-50">
                  {w.busy === "faucet" ? <Loader2 size={13} className="animate-spin" /> : <Droplets size={13} />}
                  {w.busy === "faucet" ? "Sending…" : "Get test funds"}
                </button>
              )}
            </Step>
            <Step i={3} icon={ArrowDownToLine} title="Deposit" body="Pick an amount on the left" done={deposited} active={hasFunds && !deposited} />
            <Step i={4} icon={ArrowUpFromLine} title="Withdraw any time" body="Redeem shares for tUSDC" done={false} active={deposited} />
          </ol>
        </section>
        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="text-[13px] font-medium">Activity</div>
          {w.txs.length === 0 ? (
            <div className="mt-3 text-[12px] text-muted">Your transactions show up here.</div>
          ) : (
            <ul className="mt-3 space-y-2">
              {w.txs.map((t) => (
                <li key={t.hash} className="flex items-center gap-2 text-[12px]">
                  <span className={clsx("size-1.5 shrink-0 rounded-full", t.status === "success" ? "bg-gain" : t.status === "pending" ? "live-dot bg-warn" : "bg-loss")} />
                  <span className="min-w-0 flex-1 truncate">{t.label}</span>
                  <button onClick={() => navigator.clipboard?.writeText(t.hash)} className="num inline-flex items-center gap-1 text-muted hover:text-text" title={`${t.hash} (click to copy)`}>
                    {t.hash.slice(0, 8)}… <Copy size={11} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
