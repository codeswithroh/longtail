"use client";
import clsx from "clsx";
import { Check, Copy, LogOut, Sparkles, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmtUsdc, short, useWallet } from "./wallet";

export function ConnectDialog({ onClose }: { onClose: () => void }) {
  const w = useWallet();
  useEffect(() => {
    if (w.address) onClose();
  }, [w.address, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/60 p-0 sm:place-items-center sm:p-4" onClick={onClose} role="dialog" aria-modal aria-label="Connect a wallet">
      <div className="sheet-in w-full rounded-t-2xl border border-border bg-surface p-5 sm:max-w-sm sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">Connect</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-text" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="mt-1 text-[13px] text-muted">HyperEVM testnet · test tokens only</p>
        <div className="mt-5 space-y-2">
          <button onClick={w.connectDemo} className="flex w-full items-center gap-3 rounded-xl border border-accent/40 bg-accent/5 p-3.5 text-left hover:bg-accent/10">
            <span className="grid size-10 place-items-center rounded-lg bg-accent text-bg">
              <Sparkles size={18} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-medium">Demo wallet</span>
              <span className="block text-[12px] text-muted">One click, nothing to install. Key stays in this browser.</span>
            </span>
          </button>
          <button
            onClick={w.connectInjected}
            disabled={!w.hasInjected}
            className="flex w-full items-center gap-3 rounded-xl border border-border p-3.5 text-left hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="grid size-10 place-items-center rounded-lg bg-raised text-accent">
              <Wallet size={18} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-medium">Browser wallet</span>
              <span className="block text-[12px] text-muted">{w.hasInjected ? "MetaMask, Rabby… adds HyperEVM testnet for you" : "No browser wallet detected"}</span>
            </span>
          </button>
        </div>
        {w.error && <p className="mt-3 text-[12px] text-loss">{w.error}</p>}
      </div>
    </div>
  );
}

export function ConnectButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  if (!w.address)
    return (
      <>
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-bg hover:bg-[#4cc4da]">
          <Wallet size={15} aria-hidden /> Connect
        </button>
        {open && <ConnectDialog onClose={() => setOpen(false)} />}
      </>
    );

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setMenu((m) => !m)} className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] hover:bg-raised">
        <span className={clsx("size-2 rounded-full", w.kind === "demo" ? "bg-accent" : "bg-gain")} />
        <span className="num">{short(w.address)}</span>
        {w.balances && <span className="num hidden text-muted sm:inline">{fmtUsdc(w.balances.usdc)} tUSDC</span>}
      </button>
      {menu && (
        <div className="absolute right-0 top-full z-40 mt-2 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-xl">
          <div className="px-2.5 py-2 text-[11px] text-muted">{w.kind === "demo" ? "Demo wallet (this browser)" : "Browser wallet"}</div>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(w.address!);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] hover:bg-raised"
          >
            {copied ? <Check size={15} className="text-gain" /> : <Copy size={15} className="text-muted" />} Copy address
          </button>
          <button onClick={w.disconnect} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-loss hover:bg-raised">
            <LogOut size={15} /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
