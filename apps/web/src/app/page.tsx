import { connection } from "next/server";
import { ConcentrationChart, SpreadHistogram } from "@/components/charts";
import { Card, Empty, Freshness, PageHeader, Stat } from "@/components/ui";
import { readData, type Census } from "@/lib/data";
import { cents, int, pct, usd } from "@/lib/format";

export default async function ProblemPage() {
  await connection();
  const c = readData<Census>("census.json");
  if (!c) {
    return (
      <>
        <PageHeader title="The long tail has no liquidity" lede="A census of every open prediction market, by information regime." />
        <div className="mt-6">
          <Empty title="No census yet." command="pnpm census" />
        </div>
      </>
    );
  }
  const { polymarket: pm, charts } = c.data;
  const hip4 = c.data.hip4 && "markets" in c.data.hip4 ? c.data.hip4 : null;
  const lt = pm.addressableLongTail;

  return (
    <div className="space-y-6">
      <PageHeader
        title="The long tail has no liquidity"
        lede={
          <>
            Creating a prediction market is now nearly free. Making it tradeable is not. Below is every open Polymarket market with an order book, split
            into <span className="text-text">live-information</span> markets (in-play sports, weather, price-at-expiry, where a resting quote gets
            picked off) and <span className="text-text">slow-information</span> markets, which Longtail is built to quote.
          </>
        }
        right={<Freshness at={c.data.generatedAt} label="census" />}
      />

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-md border border-border bg-surface p-5 lg:grid-cols-4">
        <Stat label="Open markets" value={int(pm.all.markets)} sub={`${int(pm.slow.markets)} slow-information · ${int(pm.live.markets)} live`} />
        <Stat label="Volume in top 10% of markets" value={pct(pm.all.top10PctShare)} sub={`top 1% alone: ${pct(pm.all.top1PctShare)}`} tone="text-warn" />
        <Stat label="Traded $0 in 24h" value={pct(pm.all.zeroDaily)} sub={`under $1k/day: ${pct(pm.all.under1kDaily)}`} />
        <Stat label="Addressable long tail" value={int(lt.markets)} sub="slow-information, clean rules, ends < 120d, < $1k/day" tone="text-accent" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Volume concentration" note="cumulative share of 24h volume vs. share of markets">
          <ConcentrationChart data={charts.lorenz} />
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            The dashed line is what an evenly traded catalog would look like. The curve hugging the top-left corner means a handful of headline markets
            take nearly all the flow; everything else waits for a counterparty.
          </p>
        </Card>
        <Card title="Quoted spread by regime" note="share of markets in each spread bucket">
          <SpreadHistogram live={charts.spreadHist.live} slow={charts.spreadHist.slow} />
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            &ldquo;One-sided&rdquo; means no bid or no ask at all. Slow-information markets: median spread {cents(pm.slow.spreadMedian)}, with{" "}
            {pct(pm.slow.spreadAtLeast5c)} quoted 5¢ or wider.
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Addressable long tail, sampled books" note={`${int(lt.sampledBooks)} live order books`}>
          <div className="grid grid-cols-2 gap-5">
            <Stat label="Median depth ±2¢" value={usd(lt.depthWithin2cMedianUsd)} sub={`p25: ${usd(lt.depthWithin2cP25Usd)}`} />
            <Stat label="Median book spread" value={cents(lt.bookSpreadMedian)} sub={`p75: ${cents(lt.bookSpreadP75)}`} />
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-muted">
            Depth within 2¢ of the mid is what a trader can actually execute without moving the price. A few dollars of depth means even a $50 order walks
            the book.
          </p>
        </Card>
        <Card title="Hyperliquid HIP-4 outcomes" note="all live outcome books">
          {hip4 ? (
            <div className="grid grid-cols-2 gap-5">
              <Stat label="Outcome markets" value={int(hip4.markets)} sub={`${int(hip4.twoSided)} with a two-sided book`} />
              <Stat label="Median spread" value={cents(hip4.spreadMedian)} sub={`p75: ${cents(hip4.spreadP75)}`} tone="text-warn" />
            </div>
          ) : (
            <div className="text-[12px] text-muted">HIP-4 data unavailable in this census run.</div>
          )}
          <p className="mt-4 text-[12px] leading-relaxed text-muted">The same gap on a second venue: markets are listed, but nobody makes them.</p>
        </Card>
        <Card title="Where the addressable markets are" note="by topic">
          <ul className="space-y-1.5">
            {pm.topCategories.slice(0, 8).map((t) => {
              const max = pm.topCategories[0]!.markets || 1;
              return (
                <li key={t.category} className="grid grid-cols-[1fr_auto] items-center gap-3 text-[12px]">
                  <div className="min-w-0">
                    <div className="truncate text-text">{t.category}</div>
                    <div className="mt-1 h-1 rounded-full bg-raised">
                      <div className="h-1 rounded-full bg-accent" style={{ width: `${(t.markets / max) * 100}%` }} />
                    </div>
                  </div>
                  <span className="num text-muted">{int(t.markets)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
