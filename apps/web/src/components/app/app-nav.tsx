"use client";
import clsx from "clsx";
import { FlaskConical, LayoutDashboard, PiggyBank, Radar, ScanSearch } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const APP_NAV = [
  { href: "/app", label: "Overview", icon: LayoutDashboard },
  { href: "/app/markets", label: "Markets", icon: Radar },
  { href: "/app/analyze", label: "Analyze", icon: ScanSearch },
  { href: "/app/earn", label: "Earn", icon: PiggyBank },
  { href: "/app/research", label: "Research", icon: FlaskConical },
];

const isActive = (path: string, href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));

/**
 * The tab the user just clicked, before the route has finished loading. Highlighting it (and
 * showing a progress bar) on the click itself makes navigation feel instant even on a cold load.
 */
const Pending = createContext<{ pending: string | null; setPending: (h: string | null) => void }>({ pending: null, setPending: () => {} });

export function NavProvider({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [path]);
  return <Pending.Provider value={{ pending, setPending }}>{children}</Pending.Provider>;
}

function useCurrent() {
  const path = usePathname();
  const { pending, setPending } = useContext(Pending);
  return { current: pending ?? path, setPending, path };
}

/** Thin bar under the header while a tab is loading. */
export function NavProgress() {
  const { pending, path } = { ...useContext(Pending), path: usePathname() };
  if (!pending || pending === path) return null;
  return <div className="nav-progress absolute inset-x-0 bottom-0 h-0.5 bg-accent" aria-hidden />;
}

/** Desktop: vertical icon + label rail. */
export function SideNav() {
  const { current: path, setPending } = useCurrent();
  return (
    <nav aria-label="App" className="flex flex-col gap-1">
      {APP_NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(path, href);
        return (
          <Link
            key={href}
            href={href}
            prefetch
            onClick={() => setPending(href)}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors duration-150",
              active ? "bg-accent/10 text-text" : "text-muted hover:bg-raised hover:text-text",
            )}
          >
            <Icon size={18} className={active ? "text-accent" : undefined} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone: bottom tab bar, like a social app. */
export function TabBar() {
  const { current: path, setPending } = useCurrent();
  return (
    <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {APP_NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(path, href);
        return (
          <Link key={href} href={href} prefetch onClick={() => setPending(href)} aria-current={active ? "page" : undefined} className={clsx("flex flex-col items-center gap-1 py-2.5 text-[11px]", active ? "text-accent" : "text-muted")}>
            <Icon size={20} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PageTitle() {
  const { current: path } = useCurrent();
  const item = [...APP_NAV].reverse().find((n) => isActive(path, n.href));
  return <h1 className="text-[15px] font-semibold tracking-tight">{item?.label ?? "Longtail"}</h1>;
}
