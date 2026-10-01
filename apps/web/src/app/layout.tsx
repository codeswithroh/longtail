import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Nav } from "@/components/nav";
import { Mark } from "@/components/ui";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "Longtail",
  description: "AI-agent liquidity for the long tail of prediction markets.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-bg">
        <div className="flex min-h-dvh">
          <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-border px-3 py-4 md:flex">
            <div className="mb-6 flex items-center gap-2 px-3">
              <Mark />
              <span className="text-[14px] font-semibold tracking-tight">Longtail</span>
            </div>
            <Nav />
            <div className="mt-auto px-3 text-[11px] leading-relaxed text-muted">
              Paper mode. No orders are sent; fills are simulated against real venue prints.
            </div>
          </aside>
          <main className="min-w-0 flex-1 px-5 py-6 md:px-8">
            <div className="mb-5 md:hidden">
              <div className="mb-2 flex items-center gap-2">
                <Mark />
                <span className="font-semibold">Longtail</span>
              </div>
              <Nav horizontal />
            </div>
            <div className="mx-auto max-w-[1280px]">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
