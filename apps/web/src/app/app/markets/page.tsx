import { connection } from "next/server";
import { MarketsFeed } from "@/components/app/markets-feed";
import { readData, type PaperState } from "@/lib/data";

export default async function MarketsPage() {
  await connection();
  const s = await readData<PaperState>("paper-state.json");
  if (!s) return <div className="py-24 text-center text-muted">The engine hasn&apos;t published yet.</div>;
  return <MarketsFeed initial={s.data} />;
}
