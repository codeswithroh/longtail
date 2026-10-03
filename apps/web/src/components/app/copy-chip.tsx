"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyChip({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      className="flex w-full items-center justify-between gap-3 rounded-lg bg-raised px-3 py-2.5 text-left transition-colors duration-150 hover:bg-raised/70"
      title={value}
    >
      <span className="min-w-0">
        <span className="block text-[11px] text-muted">{label}</span>
        <span className="num block truncate text-[12px] text-text">{value}</span>
      </span>
      {done ? <Check size={15} className="shrink-0 text-gain" aria-label="copied" /> : <Copy size={15} className="shrink-0 text-muted" aria-hidden />}
    </button>
  );
}
