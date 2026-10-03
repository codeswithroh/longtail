#!/usr/bin/env bash
# One engine cycle every 5 minutes for up to LOOP_MINUTES, publishing state after each.
# GitHub's scheduled triggers are best-effort (often delayed by an hour or more), so the
# workflow runs this loop and re-dispatches itself at the end instead of relying on cron.
set -uo pipefail
LOOP_MINUTES=${LOOP_MINUTES:-340}
deadline=$(( $(date +%s) + LOOP_MINUTES * 60 ))
llm=""; [ -n "${ANTHROPIC_API_KEY:-}" ] && llm="--llm"

publish() {
  ( cd data
    git checkout -q --orphan "s$(date +%s)"
    git add -A
    git commit -qm "engine state $(date -u +%FT%TZ)"
    git push -qf origin HEAD:live-state ) || echo "publish failed"
}

i=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  start=$(date +%s)
  last=$(cat data/universe.at 2>/dev/null || echo 0)
  if [ $(( start - last )) -gt 86400 ]; then
    node packages/engine/src/cli/universe.ts 150 20 && date +%s > data/universe.at
  fi
  node packages/engine/src/cli/cycle.ts $llm || echo "cycle failed"
  if [ -n "${KEEPER_PRIVATE_KEY:-}" ]; then
    # HIP-4 testnet quoting (dry-run until the keeper holds testnet USDC); NAV report hourly.
    timeout 120 node packages/engine/src/cli/hip4-testnet.ts 12 --once || echo "hip4 testnet failed"
    [ $(( i % 12 )) -eq 0 ] && { timeout 120 node packages/engine/src/cli/report-nav.ts | tee -a data/nav.log || echo "nav report failed"; }
  fi
  publish
  i=$(( i + 1 ))
  sleep $(( 300 - ($(date +%s) - start) > 0 ? 300 - ($(date +%s) - start) : 0 ))
done
