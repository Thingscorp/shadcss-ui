#!/usr/bin/env bash
# ==========================================================================
# scripts/check.sh — Ralph verification gate for shadcss-ui
# Mirrors the repo's real checks: build, consistency, markup.
# No CI exists; these are the canonical gates.
# ==========================================================================
set -euo pipefail

echo "=== GATE 1: Build (npm run build) ==="
npm run build 2>&1
echo ""

echo "=== GATE 2: Consistency + Markup (npm run check) ==="
npm run check 2>&1
echo ""

echo "ALL GATES PASS"
