import { connection } from "next/server";
import { AnalyzeView } from "@/components/app/analyze-view";
import { readData, type PaperState } from "@/lib/data";

export default async function AnalyzePage() {
  await connection();
  const s = await readData<PaperState>("paper-state.json");
  // A few markets the live engine is quoting right now, as one-click examples.
  const seen = new Set<string>();
  const examples = (s?.data.markets ?? [])
    // Only markets with time left: a weekly market can still be in the engine's state after it closes.
    .filter((m) => m.venue === "polymarket" && m.decision?.quote && (m.endTime ?? 0) > Date.now() + 2 * 86_400_000)
    .filter((m) => !seen.has(m.category) && seen.add(m.category))
    .slice(0, 3)
    .map((m) => ({ url: m.url, question: m.question }));
  return <AnalyzeView examples={examples} />;
}
