// Places Longtail's quotes on Hyperliquid HIP-4 outcome markets.
//
// Outcomes are fully collateralized and trade like spot: YES and NO books are merged, so
// buying NO at 1 - p is the same as offering YES at p. A two-sided quote therefore needs
// no inventory: bid = buy YES, offer = buy NO. Nothing can be liquidated.
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import type { Quote } from "../quoter.ts";

const OUTCOME_ASSET_BASE = 100_000_000;

export interface Hip4ExecutorOptions {
  privateKey: `0x${string}`;
  testnet: boolean;
  /** Hard cap on USDC committed per side of one market. */
  maxSideUsd: number;
  /** Never send anything; log what would be sent. */
  dryRun: boolean;
}

export interface PlacedOrder {
  marketId: string;
  side: "bidYes" | "bidNo";
  asset: number;
  price: number;
  size: number;
  oid?: number;
  status: string;
}

/** HL prices: at most 5 significant figures; outcome prices sit strictly inside (0, 1). */
export function formatPrice(p: number): string {
  const clamped = Math.min(0.999, Math.max(0.001, p));
  return Number(clamped.toPrecision(5)).toString();
}

export class Hip4Executor {
  readonly address: `0x${string}`;
  private info: InfoClient;
  private exchange: ExchangeClient;
  private opts: Hip4ExecutorOptions;

  constructor(opts: Hip4ExecutorOptions) {
    this.opts = opts;
    const wallet = privateKeyToAccount(opts.privateKey);
    this.address = wallet.address;
    const transport = new HttpTransport({ isTestnet: opts.testnet });
    this.info = new InfoClient({ transport });
    this.exchange = new ExchangeClient({ transport, wallet });
  }

  /** Spot-side USDC available for outcome orders. */
  async usdcBalance(): Promise<number> {
    const s = await this.info.spotClearinghouseState({ user: this.address });
    const usdc = s.balances.find((b) => b.coin === "USDC");
    return usdc ? Number(usdc.total) - Number(usdc.hold) : 0;
  }

  async openOrders() {
    return this.info.openOrders({ user: this.address });
  }

  async fills(sinceMs: number) {
    return this.info.userFillsByTime({ user: this.address, startTime: sinceMs });
  }

  /** Cancel every resting outcome order we own (each cycle replaces the whole quote set). */
  async cancelAll(): Promise<number> {
    const open = (await this.openOrders()).filter((o) => o.coin.startsWith("#"));
    if (open.length === 0 || this.opts.dryRun) return open.length;
    await this.exchange.cancel({ cancels: open.map((o) => ({ a: OUTCOME_ASSET_BASE + Number(o.coin.slice(1)), o: o.oid })) });
    return open.length;
  }

  /** Translate an engine quote for YES outcome `encoding` into bid-YES / bid-NO orders. */
  ordersFor(marketId: string, q: Quote): PlacedOrder[] {
    const yes = Number(marketId);
    const out: PlacedOrder[] = [];
    const cap = (px: number, size: number) => Math.max(0, Math.min(size, Math.floor(this.opts.maxSideUsd / px)));
    if (q.bid) {
      const size = cap(q.bid.price, q.bid.size);
      if (size > 0) out.push({ marketId, side: "bidYes", asset: OUTCOME_ASSET_BASE + yes, price: q.bid.price, size, status: "pending" });
    }
    if (q.ask) {
      const noPx = 1 - q.ask.price;
      const size = cap(noPx, q.ask.size);
      if (size > 0) out.push({ marketId, side: "bidNo", asset: OUTCOME_ASSET_BASE + yes + 1, price: noPx, size, status: "pending" });
    }
    return out;
  }

  async place(orders: PlacedOrder[]): Promise<PlacedOrder[]> {
    if (orders.length === 0) return [];
    if (this.opts.dryRun) return orders.map((o) => ({ ...o, status: "dry-run" }));
    const res = await this.exchange.order({
      orders: orders.map((o) => ({ a: o.asset, b: true, p: formatPrice(o.price), s: String(Math.floor(o.size)), r: false, t: { limit: { tif: "Alo" } } })),
      grouping: "na",
    });
    const statuses = res.response.data.statuses as Record<string, unknown>[];
    return orders.map((o, i) => {
      const st = statuses[i] ?? {};
      const resting = (st.resting as { oid?: number } | undefined)?.oid;
      const filled = (st.filled as { oid?: number } | undefined)?.oid;
      return { ...o, oid: resting ?? filled, status: resting ? "resting" : filled ? "filled" : String(st.error ?? "unknown") };
    });
  }
}
