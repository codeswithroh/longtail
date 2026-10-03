import { connection } from "next/server";
import { RankBuckets, SpreadHistogram } from "@/components/charts";
import { Card, Empty, Freshness, PageHeader, Stat } from "@/components/ui";
import { readData, type Census } from "@/lib/data";
import { cents, int, pct, usd } from "@/lib/format";

export default async function ProblemPage() {
  await connection();
  const c = await readData<Census>("census.json");
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
  const rw = c.data.rewards;
  const bottom = charts.rankBuckets.at(-1);
  const top = charts.rankBuckets[0];

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
        <Stat label={`Volume in the top ${int(top?.markets)} markets`} value={pct(top?.volumeShare)} sub={`top 1%: ${pct(pm.all.top1PctShare)} · bottom 90%: ${pct(bottom?.volumeShare, 1)}`} tone="text-warn" />
        <Stat label="Slow markets that traded $0" value={pct(pm.slow.zeroDaily)} sub={`under $1k/day: ${pct(pm.slow.under1kDaily)} · last 24h`} />
        <Stat label="Addressable long tail" value={int(lt.markets)} sub="slow-information, clean rules, ends < 120d, < $1k/day" tone="text-accent" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Where the volume goes" note="share of 24h volume by market rank">
          <RankBuckets data={charts.rankBuckets} />
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            {int(top?.markets)} headline markets take {pct(top?.volumeShare)} of all volume. The bottom 90%, {int(bottom?.markets)} markets, wait for a
            counterparty that never comes.
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

      {rw && (
        <Card title="The money is already there" note="Polymarket liquidity rewards, current configs">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
            <Stat label="Rewards paid to makers" value={`${usd(rw.all.dailyUsd)}/day`} sub={`${int(rw.all.markets)} markets`} />
            <Stat label="On the addressable long tail" value={`${usd(rw.addressableLongTail.dailyUsd)}/day`} sub={`${int(rw.addressableLongTail.markets)} markets · ≈${usd(rw.addressableLongTail.dailyUsd * 365)}/yr`} tone="text-gain" />
            <Stat label="On markets with zero volume" value={`${usd(rw.zeroVolumeAddressable.dailyUsd)}/day`} sub={`${int(rw.zeroVolumeAddressable.markets)} markets nobody trades`} />
            <Stat label="Median per market" value={`${usd(rw.addressableLongTail.medianDailyUsd)}/day`} sub="split pro-rata among makers inside the band" />
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-muted">
            Venues already pay makers to quote these markets; in a book with $3 of depth there is rarely anyone else inside the reward band. Longtail's job is
            to collect that subsidy without being picked off, which is what the risk engine and the backtest are about.
          </p>
        </Card>
      )}

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
