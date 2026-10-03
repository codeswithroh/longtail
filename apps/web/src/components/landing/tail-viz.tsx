// Hero visual: the power law of prediction-market volume. A few headline markets tower; the
// long tail is flat and dark until Longtail's quotes light it up, one market at a time.
const N = 64;
const heights = Array.from({ length: N }, (_, i) => Math.max(1.5, 210 / Math.pow(i + 1, 1.15)));

export function TailViz({ topShare = 0.61 }: { topShare?: number }) {
  const w = 640;
  const h = 260;
  const gap = 3;
  const bw = (w - gap * (N - 1)) / N;
  return (
    <svg viewBox={`0 0 ${w} ${h + 34}`} className="h-auto w-full" role="img" aria-label="Volume by market rank: a few markets take nearly all volume; Longtail quotes the long tail">
      <defs>
        <linearGradient id="tv-head" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#c9d6da" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#8a9ca1" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="tv-tail" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#2cb0c8" />
          <stop offset="100%" stopColor="#038093" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      {heights.map((bh, i) => {
        const x = i * (bw + gap);
        const tail = i >= 6;
        return (
          <g key={i}>
            <rect x={x} y={h - bh} width={bw} height={bh} rx={1.5} fill={tail ? "#2a3639" : "url(#tv-head)"} />
            {tail && (
              <rect
                className="tv-lit"
                x={x}
                y={h - bh - 10 - (i % 4) * 3}
                width={bw}
                height={10 + (i % 4) * 3}
                rx={1.5}
                fill="url(#tv-tail)"
                style={{ animationDelay: `${((i * 37) % 58) * 0.11}s` }}
              />
            )}
          </g>
        );
      })}
      <line x1={0} x2={w} y1={h + 0.5} y2={h + 0.5} stroke="#1d2527" />
      <text x={2} y={h + 22} fill="#8a9ca1" fontSize="12" fontFamily="var(--font-plex-mono)">
        top 0.1% · {Math.round(topShare * 100)}% of volume
      </text>
      <text x={w - 2} y={h + 22} fill="#2cb0c8" fontSize="12" fontFamily="var(--font-plex-mono)" textAnchor="end">
        the long tail · quoted by Longtail →
      </text>
    </svg>
  );
}
