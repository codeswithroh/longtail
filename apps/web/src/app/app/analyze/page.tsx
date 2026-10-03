import { connection } from "next/server";
import { AnalyzeView } from "@/components/app/analyze-view";
import { readData, type PaperState } from "@/lib/data";

export default async function AnalyzePage() {
  await connection();
  const s = await readData<PaperState>("paper-state.json");
  // A few markets the live engine is quoting right now, as one-click examples.
  const seen = new Set<string>();
  const examples = (s?.data.markets ?? [])
    .filter((m) => m.venue === "polymarket" && m.decision?.quote && !seen.has(m.category) && seen.add(m.category))
    .slice(0, 3)
    .map((m) => ({ url: m.url, question: m.question }));
  return <AnalyzeView examples={examples} />;
}
