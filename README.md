# Longtail

**AI-agent liquidity for the long tail of prediction markets.**

**Live dashboard: [longtail-rosy.vercel.app](https://longtail-rosy.vercel.app)** · The engine runs every 5 minutes on GitHub Actions ([live-engine](.github/workflows/live-engine.yml)), and its state is published to the [`live-state`](https://github.com/codeswithroh/longtail/tree/live-state) branch.

Creating a prediction market is now nearly free. Making it tradeable is not. Longtail is a liquidity network that prices and quotes the thousands of thin markets nobody makes, with a risk engine built to survive the adverse selection that makes long-tail market making lose money.

## The problem (measured, not asserted)

From a full census of Polymarket on Oct 1, 2026 (`pnpm census`):

| | |
|---|---|
| Open markets with an order book | **206,349** |
| Share of 24h volume in the top 0.1% (206 markets) | **59%** (top 1%: 92%) |
| Share of 24h volume in the bottom 90% (185,715 markets) | **~0%** |
| Slow-information markets that traded $0 in 24h | **60%** (95% traded under $1k) |
| Median depth within ±2¢ of the mid, addressable long tail (400 live books) | **$3** |
| Liquidity rewards Polymarket pays makers | **$183.6k/day** across 17,989 markets |
| …of which on the addressable long tail | **$50.2k/day** across 6,924 markets (~$18M/yr) |

It isn't a Polymarket quirk. **Kalshi** (CFTC-regulated, combos excluded) lists 131,920 open markets: 82% of 24h volume is in the top 1%, and 83% traded nothing. **Hyperliquid HIP-4** lists 236 outcome books with a 45¢ 75th-percentile spread.

## What Longtail does

1. **Classifies every market by information regime.** *Live-information* markets (in-play sports, weather, price-at-expiry, stock thresholds) settle from public real-time feeds; anyone watching the feed beats a resting quote. Longtail never quotes them. *Slow-information* markets (elections, policy, tech, culture) are where a model and wide quotes can hold their own.
2. **Prices each market.** Fair value blends the live microprice (weighted by book tightness), decayed trade VWAP, the last print and recent history, then passes it through a **calibration curve fitted on resolved markets**. Prediction markets overprice long shots: markets priced 15¢ resolved YES ~8% of the time. A tight live book always bounds the result. An optional **Claude forecasting agent** (web search, structured output) adds an independent signal.
3. **Decides whether to quote at all.** Risk engine: resolution-rule ambiguity and insider-risk scoring, flow toxicity from fill markouts, one-sided flow, news shocks, drift guard, worst-case position limits (shares × (1 − price) for shorts), category and portfolio caps, reduce-only before resolution, and a full pull 24h out.
4. **Quotes post-only**, skewed against inventory, stepping inside a venue's reward band only when its own risk spread is already close.
5. **Accounts transparently.** LPs fund an ERC-4626 vault; the keeper deploys to venue accounts and reports NAV on-chain, rate-limited and linked to a published position snapshot.

## Results

### Replay on 963 resolved markets (26 weeks, `pnpm backtest 26 40`)

Re-quotes every 15 minutes using only information available at the time. Fills only on real taker prints *strictly through* our price (back of queue), capped at print size. Settles at the real outcome. The calibration curve is fitted on the **older half only**; every arm below is scored on the **newer half** (482 markets).

| Arm (out of sample) | PnL after settlement | On peak capital | Worst market |
|---|---|---|---|
| Naive (fixed 2¢ half-spread, no limits) | **−$28,469** | −38.8% | −$1,182 |
| Risk engine | −$1,629 | −13.1% | −$146 |
| + drift guard | −$1,620 | −13.1% | −$136 |
| **+ calibration (Longtail)** | **+$354** | **+1.9%** | −$225 |

Calibration also improves forecasts out of sample (Brier score 0.0706 → 0.0670).

**Reading it honestly:** naive long-tail market making loses about 39% of capital to adverse selection. Longtail's engine brings spread PnL to roughly break-even out of sample. Venue liquidity rewards, not modelled in the replay, are the margin: without calibration the engine needs about 4% of available rewards to break even, and with it, none.

### The AI agent, out of sample (`node packages/engine/src/cli/eval-llm.ts`)

Claude Opus 5.5 was tested on 136 slow-information markets that resolved **after its training cutoff**. It forecast 7 days before resolution, with web search off so it couldn't see outcomes.

| Forecast | Brier (lower is better) |
|---|---|
| Market price | 0.0598 |
| Calibrated price | 0.0570 |
| Claude alone | 0.0582 |
| **Claude + calibrated price** | **0.0565** |

**Triage matters more than forecasting.** Markets the agent refused (insider risk > 0.3 or resolution clarity < 0.6) lost **−$237** in replay; the ones it kept made **+$254**. It's a small sample, so treat it as early evidence.

### Live paper trading

**Run 1 (Oct 1–3, 45h, 159 markets):** 30 fills, −$142 mark-to-fair. Three markets caused −$151: a Big Brother contestant, "Will Trump say *Ice Cream*", and Codex usage-limit resets. Reality TV, mention markets and company-decided outcomes are now excluded by rule, and the agent refuses what the rules miss.

**Run 2 (from Oct 3, ongoing):

** the engine quotes ~150 reward-paying long-tail markets (Polymarket plus HIP-4) every 5 minutes, with the Claude agent triaging each market. Fills are simulated only when a real taker print would have hit our price, and positions settle when markets resolve. Reward income is estimated with Polymarket's published scoring formula. The rest of the book is treated as one competitor, which overstates competition. **The run-rate shown on the dashboard is a model estimate until validated with real orders.**

### Hyperliquid execution

`packages/engine/src/live/hip4-executor.ts` turns quotes into HIP-4 orders. A bid is a buy of YES; an offer is a buy of NO at 1 − price. The merged book makes that equivalent to a two-sided quote that needs no inventory and can't be liquidated. `hip4-testnet.ts` runs the full engine with real orders on HIP-4 testnet, and `contracts/script/Deploy.s.sol` deploys the vault to HyperEVM testnet.

## Repo

```
packages/core     venue adapters: Polymarket (Gamma, CLOB, Data API, rewards), Hyperliquid HIP-4; DoH resolution
packages/engine   forecast, calibration, rules/regime, toxicity, risk, quoter, rewards, paper exchange, replay
  src/cli         census · backtest · universe · paper · cycle · eval-llm · hip4-testnet · rewards
  src/live        resumable live engine, HIP-4 executor
  src/llm.ts      Claude forecasting agent (web search + structured output)
contracts         LongtailVault.sol (ERC-4626) + Foundry tests
apps/web          dashboard: Problem · Backtest · Live · Vault (Next.js)
```

## Run it

```bash
pnpm install
pnpm rewards                       # snapshot reward configs
pnpm census                        # full market census (~20 min, caches data/pm-markets.json)
pnpm backtest 26 40                # fetch + replay; add --cached to re-run instantly
pnpm universe                      # pick the reward-paying long tail (~3 min)
pnpm paper 60                      # live paper quoting (resumable; ANTHROPIC_API_KEY enables the agent)
pnpm --filter web dev              # dashboard on :3000
pnpm test                          # engine tests (27)
cd contracts && forge test         # vault tests (9)
```

Set `ANTHROPIC_API_KEY` to switch on the forecasting agent (`LONGTAIL_LLM_MODEL`, `LONGTAIL_LLM_EFFORT` to tune cost). In regions that block venue domains at the resolver, the adapters resolve over DNS-over-HTTPS (`LONGTAIL_DOH=0` to disable).

## Limitations, plainly

- **Paper only.** No live orders yet. Simulated fills don't capture queue priority or our own market impact.
- **Rewards are estimated**, not earned. The backtest excludes rewards entirely because historical reward configs aren't published.
- **The agent's evaluation is small** (136 markets).
- **The vault is tested but not audited or deployed.**
- **Kalshi is read-only** (census). Trading needs a US-regulated account.
- **The regime and insider rules are heuristics.** They're conservative by design, so they exclude many sports-season markets that might be quotable.

All code in this repo was written during the Crypto World's Fair hackathon (Oct 2026).
