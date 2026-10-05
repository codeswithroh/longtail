# Longtail: pitch and demo plan

Working notes for the presentation video and the submission. The numbers come from the repo's snapshot/ and the live dashboard, so re-check them on recording day.

## Pitch video (about 3 min): beats, not a script

1. **Hook (15s).** Creating a prediction market is free now; making it tradeable isn't. Open on the landing page: 187k Polymarket markets, top 0.1% hold 61% of volume, and the bottom 90% hold ~0%. The median depth near the mid is **$4**.
2. **It's structural (20s).** Same shape on Kalshi (82% of volume in the top 1%, 83% of markets idle) and on HIP-4 (45¢ spreads). Venues already pay **$29k/day** in rewards on this tail, and almost nobody collects it.
3. **Why nobody does it (25s).** Naive market making on the tail loses **39%** of capital to adverse selection (Research tab, naive arm). The problem isn't quoting. It's knowing which markets *not* to quote.
4. **What Longtail is (45s).** Walk the pipeline:
   - regime classifier (live vs slow information)
   - calibrated fair value (long-shot bias)
   - risk engine (insider risk, rule ambiguity, toxicity, drift, worst-case sizing)
   - Claude triage agent
   - post-only quotes
   - ERC-4626 vault with bounded NAV reports
5. **Evidence (40s).**
   - Walk-forward, out of sample: −$28.5k naive vs **+$354** for Longtail.
   - Brier improves from 0.0706 to 0.0670.
   - Agent eval on post-cutoff markets: markets it refused lost −$237, markets it kept made +$254.
   - Be honest that run 1 lost $142, and say what changed because of it.
6. **It's live (25s).**
   - Run 2 (since Oct 3): ~115 markets quoted every 5 min, 59 fills, +$87 trading PnL, ~$573 estimated rewards.
   - Hyperliquid HIP-4 testnet: real resting orders, 6 real fills on both sides. Two-sided quotes need no inventory and can't be liquidated.
   - HyperEVM testnet vault: 50+ hourly NAV reports on-chain, each pinned to the hash of the published state.
   - Anyone can try it: demo wallet → faucet → deposit/withdraw, and Analyze runs the engine and Claude on any Polymarket link.
7. **Ask / what's next (10s).**
   - Real-capital pilot with a capped vault.
   - Venue partnerships: liquidity-as-a-service for market creators.

## Demo recording shot list (dashboard)

Landing `/` (hero, problem, evidence) → **Launch app** → `/app` Overview (KPIs, run chart, AI triage ring) → `/app/markets` (open a card the AI refused, show its reasoning) → `/app/research` (walk-forward bars, calibration, triage split) → `/app/analyze` (paste a Polymarket link, show the verdict and Claude's triage) → `/app/earn` (demo wallet → get test funds → deposit → withdraw; capital flow, NAV reports, live HIP-4 quotes). Record at 1440×900; show one phone-width pass of the Markets feed.

## Submission: outline and open questions (fill in yourself)

- **Track:** Hyperliquid fits best, given HIP-4 execution and the HyperEVM vault. Polymarket data underpins the evidence either way.
- **One-liner:** your own words. Anchor it on "liquidity for the long tail."
- **Links:**
  - repo https://github.com/codeswithroh/longtail
  - dashboard https://longtail-rosy.vercel.app
  - vault 0x1c4DA07db8A2b1D23dBecDE9aAD3707dfc733AfC (chain 998)
- **Questions to decide:**
  - Team listing and bios?
  - Is the presentation video you on camera, or a voice-over on the dashboard?
  - Will you mention a real-capital pilot as the next step, given you declined it for now?
