import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { NavProgress, NavProvider, PageTitle, SideNav, TabBar } from "@/components/app/app-nav";
import { ConnectButton } from "@/components/app/connect";
import { WalletProvider } from "@/components/app/wallet";
import { Mark } from "@/components/ui";
import { LiveDot } from "@/components/viz";
import { readData, type PaperState } from "@/lib/data";
import { ago } from "@/lib/format";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const s = (await readData<PaperState>("paper-state.json"))?.data.summary;
  const fresh = s ? Date.now() - s.updatedAt < 12 * 60_000 : false;
  return (
    <WalletProvider>
    <NavProvider>
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border px-3 py-4 md:flex">
        <Link href="/" className="mb-7 flex items-center gap-2 px-3">
          <Mark size={22} />
          <span className="text-[15px] font-semibold tracking-tight">Longtail</span>
        </Link>
        <SideNav />
        <div className="mt-auto space-y-3 px-3">
          <div className="rounded-lg border border-border bg-surface p-3 text-[12px]">
            <div className="flex items-center gap-2 text-text">
              <LiveDot ok={fresh} />
              {fresh ? "Engine live" : "Engine idle"}
            </div>
            {s && <div className="num mt-1 text-[11px] text-muted">cycle {s.cycles} · {ago(s.updatedAt)}</div>}
          </div>
          <Link href="/" className="flex items-center gap-1 text-[12px] text-muted hover:text-text">
            longtail site <ArrowUpRight size={13} aria-hidden />
          </Link>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-bg/85 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <Link href="/" className="md:hidden" aria-label="Longtail home">
              <Mark size={22} />
            </Link>
            <PageTitle />
          </div>
          <div className="flex items-center gap-2">
            <span className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] sm:inline-flex ${fresh ? "bg-gain/10 text-gain" : "bg-warn/10 text-warn"}`}>
              <LiveDot ok={fresh} />
              {fresh ? "live" : "idle"}
            </span>
            <ConnectButton />
          </div>
          <NavProgress />
        </header>
        <main className="mx-auto max-w-[1320px] px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-6">{children}</main>
      </div>
      <TabBar />
    </div>
    </NavProvider>
    </WalletProvider>
  );
}
