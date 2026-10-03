export interface Hip4Run {
  dryRun: boolean;
  updatedAt: number;
  cycles: number;
  usdc: number;
  markets: { id: string; question: string }[];
  lastOrders: { marketId: string; side: string; price: number; size: number; status: string; question?: string }[];
  fills: unknown[];
}

export interface NavReport {
  t: number;
  deployedValue: number;
  paperReturn: number;
  snapshotHash: string;
  tx: string;
  status: string;
}
