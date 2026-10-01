# Longtail style lock

Mood: technical / builder, dark (trading terminal). Generated with
`generate_palette.py --mood technical --mode dark --seed 47`; semantic colors added and checked with `check_contrast.py --matrix`.
Surface types: app shell + data views (no marketing hero). Density: dense.

## Color contract
| role | hex |
|---|---|
| bg | #070e10 |
| surface | #11191b |
| border | #1d2527 |
| text | #e5f5f9 |
| muted | #8a9ca1 |
| primary | #038093 (fills only; label = on-primary #ffffff) |
| accent | #2cb0c8 (links, active nav, focus, single-series charts) |
| gain | #4cc38a |
| loss | #f26d6d |
| warn | #e8b54a |

Text-safe (>=4.5): text, muted, accent, gain, loss, warn on bg and surface; on-primary on primary.
UI-safe (>=3.0): primary on bg/surface (fills, active states).
Decorative only: border on bg/surface (hairlines; never the only state signal). Color never carries meaning alone: signs (+/−) and labels accompany gain/loss.

## Type
IBM Plex Sans (UI, 13px base in data areas, 14px elsewhere) + IBM Plex Mono (every number, id, hash, price). Tabular figures everywhere numbers align.

## Density & spacing
4px base. Table rows 32px. Card padding 16px, gap between cards 16-24px (internal <= external). Radius 4px; no shadows, hairline borders.

## Motion
App-shell track only: staggered table entrance on data load, number transitions via NumberFlow, 150-200ms ease-out state changes, skeleton loading. prefers-reduced-motion respected. No scroll storytelling.

## Libraries
Next.js app router, Tailwind v4, Recharts (charts), NumberFlow (live numbers), clsx.

## Avoid
Gradients, glow, neon, emoji, rounded-2xl cards with shadows, crypto-hype copy, invented metrics (every number on screen comes from data/*.json).
