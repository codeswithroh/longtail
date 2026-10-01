"use client";
import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Problem", hint: "Where liquidity is missing" },
  { href: "/backtest", label: "Backtest", hint: "Replay on resolved markets" },
  { href: "/live", label: "Live", hint: "Paper quoting, live books" },
  { href: "/vault", label: "Vault", hint: "LP capital, on-chain NAV" },
];

export function Nav({ horizontal = false }: { horizontal?: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className={clsx("flex gap-0.5", horizontal ? "-mx-1 overflow-x-auto" : "flex-col")}>
      {ITEMS.map((it) => {
        const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "group shrink-0 rounded-sm px-3 py-2 transition-colors duration-150",
              horizontal ? "border-b-2" : "border-l-2",
              active ? "border-accent bg-raised" : "border-transparent hover:bg-raised/60",
            )}
          >
            <div className={clsx("text-[13px]", active ? "text-text" : "text-muted group-hover:text-text")}>{it.label}</div>
            {!horizontal && <div className="text-[11px] text-muted">{it.hint}</div>}
          </Link>
        );
      })}
    </nav>
  );
}
