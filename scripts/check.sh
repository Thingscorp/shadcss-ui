#!/usr/bin/env bash
# ==========================================================================
# scripts/check.sh — Ralph verification gate for shadcss-ui
# Mirrors the repo's real checks: build, consistency, markup, fidelity.
# No CI exists; these are the canonical gates.
# ==========================================================================
set -euo pipefail

echo "=== GATE 1: Build (npm run build) ==="
npm run build 2>&1
echo ""

echo "=== GATE 2: Consistency + Markup (npm run check) ==="
npm run check 2>&1
echo ""

echo "=== GATE 3: Fidelity Comparator (scripts/fidelity/compare.mjs) ==="
FIDELITY_OUTPUT=$(node scripts/fidelity/compare.mjs 2>&1)
echo "$FIDELITY_OUTPUT"
echo ""

REAL_DEVIATIONS=$(echo "$FIDELITY_OUTPUT" | grep '^real_deviations=' | grep -oE '[0-9]+' | head -1)
if [ -z "$REAL_DEVIATIONS" ]; then
  REAL_DEVIATIONS=0
fi
echo "Fidelity: ${REAL_DEVIATIONS} real deviation(s)"

if [ "$REAL_DEVIATIONS" -gt 0 ]; then
  echo "FAIL: ${REAL_DEVIATIONS} fidelity deviations remain — see qa/fidelity/gaps.csv"
  exit 1
fi

echo "ALL GATES PASS"
