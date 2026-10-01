export const pct = (x: number | null | undefined, digits = 0) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(digits)}%`);

export const cents = (x: number | null | undefined, digits = 1) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(digits)}¢`);

export const prob = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(3));

export function usd(x: number | null | undefined, opts: { signed?: boolean; digits?: number } = {}) {
  if (x == null || !Number.isFinite(x)) return "—";
  const abs = Math.abs(x);
  const digits = opts.digits ?? (abs >= 100 ? 0 : 2);
  const body = abs >= 1e6 ? `${(abs / 1e6).toFixed(1)}M` : abs >= 1e4 ? `${(abs / 1e3).toFixed(1)}k` : abs.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const sign = x < 0 ? "−" : opts.signed && x > 0 ? "+" : "";
  return `${sign}$${body}`;
}

export const int = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : Math.round(x).toLocaleString("en-US"));

export function ago(d: Date | number) {
  const s = Math.max(0, Math.round((Date.now() - (typeof d === "number" ? d : d.getTime())) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const tone = (x: number | null | undefined) => (x == null || x === 0 ? "text-muted" : x > 0 ? "text-gain" : "text-loss");
