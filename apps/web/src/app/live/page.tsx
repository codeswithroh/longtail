import { connection } from "next/server";
import { RunChart } from "@/components/charts";
import { LiveView } from "@/components/live-view";
import { Card, Empty, PageHeader } from "@/components/ui";
import { readData, readTimeline, type PaperState } from "@/lib/data";

export default async function LivePage() {
  await connection();
  const s = await readData<PaperState>("paper-state.json");
  const timeline = await readTimeline();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Live: paper quoting against real books"
        lede="The engine watches the addressable long tail, prices each market, and posts the quotes it would send. Fills are simulated only when a real taker print would have hit our price; no orders leave this machine."
      />
      {s ? <LiveView initial={s.data} /> : <Empty title="The paper engine hasn't run yet." command="pnpm paper 60" />}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="The run so far" note="one point per engine cycle" className="lg:col-span-3">
          {timeline.length > 1 ? <RunChart rows={timeline} /> : <div className="py-16 text-center text-[12px] text-muted">The chart fills in as the engine cycles.</div>}
        </Card>
        <Card title="What the first run taught the engine" note="45h paper run, Oct 1–3" className="lg:col-span-2">
          <p className="text-[12px] leading-relaxed text-muted">
            The first live run quoted 159 markets for 45 hours: 30 fills, mark-to-fair PnL of −$142. Three markets caused −$151 of it:
          </p>
          <ul className="mt-3 space-y-2 text-[12px]">
            <li className="flex justify-between gap-3"><span>Big Brother contestant placing (producers know first)</span><span className="num text-loss">−$103</span></li>
            <li className="flex justify-between gap-3"><span>&ldquo;Will Trump say Ice Cream&rdquo; (settles on live speech)</span><span className="num text-loss">−$26</span></li>
            <li className="flex justify-between gap-3"><span>Codex usage-limit resets (the company decides)</span><span className="num text-loss">−$22</span></li>
          </ul>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Everything else was flat. The rules now exclude reality TV, mention markets, outages and company-decided outcomes, and the Claude agent refuses markets it scores high on insider risk.
          </p>
        </Card>
      </div>
    </div>
  );
}
