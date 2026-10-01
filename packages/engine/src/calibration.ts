/**
 * Market-price calibration: how often do markets priced at p actually resolve YES?
 * Prediction markets are known to overprice long shots (favourite-longshot bias).
 * Fit on resolved markets, then apply to fair values on unseen markets.
 */
export interface CalibrationCurve {
  /** Bin edges in price space, ascending, from 0 to 1. */
  edges: number[];
  /** Calibrated YES frequency at each bin's mean price. */
  points: { p: number; y: number; n: number }[];
}

export const DEFAULT_EDGES = [0, 0.03, 0.07, 0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.88, 0.93, 0.97, 1];

/**
 * Binned calibration with shrinkage toward the diagonal: a bin with few markets stays
 * close to y = p, so sparse bins can't produce a confident correction.
 * `samples` should weight each market equally (a few price points per market).
 */
export function fitCalibration(samples: { p: number; y: number; w?: number }[], edges = DEFAULT_EDGES, priorStrength = 20): CalibrationCurve {
  const points: CalibrationCurve["points"] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const inBin = samples.filter((s) => s.p >= lo && (i === edges.length - 2 ? s.p <= hi : s.p < hi));
    const n = inBin.reduce((a, s) => a + (s.w ?? 1), 0);
    if (n === 0) continue;
    const meanP = inBin.reduce((a, s) => a + s.p * (s.w ?? 1), 0) / n;
    const hits = inBin.reduce((a, s) => a + s.y * (s.w ?? 1), 0);
    // Beta prior with mean meanP and strength priorStrength.
    const y = (hits + priorStrength * meanP) / (n + priorStrength);
    points.push({ p: meanP, y, n });
  }
  // Calibrated frequencies must not decrease in price (pool adjacent violators).
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      if (a.y > b.y) {
        const n = a.n + b.n;
        const merged = { p: (a.p * a.n + b.p * b.n) / n, y: (a.y * a.n + b.y * b.n) / n, n };
        points.splice(i, 2, merged);
        changed = true;
        break;
      }
    }
  }
  return { edges, points };
}

/** Piecewise-linear map through the curve's points, pinned at (0,0) and (1,1). */
export function applyCalibration(curve: CalibrationCurve | null, p: number): number {
  if (!curve || curve.points.length === 0) return p;
  const pts = [{ p: 0, y: 0 }, ...curve.points, { p: 1, y: 1 }];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (p >= a.p && p <= b.p) {
      const t = b.p === a.p ? 0 : (p - a.p) / (b.p - a.p);
      return a.y + t * (b.y - a.y);
    }
  }
  return p;
}

/** Brier score of predictions against outcomes; lower is better. */
export const brier = (xs: { p: number; y: number }[]) => (xs.length ? xs.reduce((a, x) => a + (x.p - x.y) ** 2, 0) / xs.length : NaN);
