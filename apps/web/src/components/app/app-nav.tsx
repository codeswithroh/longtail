"use client";
import clsx from "clsx";
import { FlaskConical, LayoutDashboard, Radar, Vault } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const APP_NAV = [
  { href: "/app", label: "Overview", icon: LayoutDashboard },
  { href: "/app/markets", label: "Markets", icon: Radar },
  { href: "/app/research", label: "Research", icon: FlaskConical },
  { href: "/app/vault", label: "Vault", icon: Vault },
];

const isActive = (path: string, href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));

/** Desktop: vertical icon + label rail. */
export function SideNav() {
  const path = usePathname();
  return (
    <nav aria-label="App" className="flex flex-col gap-1">
      {APP_NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(path, href);
        return (
          <Link
            key={href}
            href={href}
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
  const path = usePathname();
  return (
    <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {APP_NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(path, href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={clsx("flex flex-col items-center gap-1 py-2.5 text-[11px]", active ? "text-accent" : "text-muted")}>
            <Icon size={20} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PageTitle() {
  const path = usePathname();
  const item = [...APP_NAV].reverse().find((n) => isActive(path, n.href));
  return <h1 className="text-[15px] font-semibold tracking-tight">{item?.label ?? "Longtail"}</h1>;
}
