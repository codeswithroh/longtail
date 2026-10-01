import { connection } from "next/server";
import { LiveView } from "@/components/live-view";
import { Empty, PageHeader } from "@/components/ui";
import { readData, type PaperState } from "@/lib/data";

export default async function LivePage() {
  await connection();
  const s = readData<PaperState>("paper-state.json");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Live: paper quoting against real books"
        lede="The engine watches the addressable long tail, prices each market, and posts the quotes it would send. Fills are simulated only when a real taker print would have hit our price; no orders leave this machine."
      />
      {s ? <LiveView initial={s.data} /> : <Empty title="The paper engine hasn't run yet." command="pnpm paper 150 60" />}
    </div>
  );
}
