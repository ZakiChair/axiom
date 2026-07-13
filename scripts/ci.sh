#!/usr/bin/env bash
# CI locale AXIOM — typecheck + tests monorepo + build du front.
# Aucune dépendance GitHub / remote : exécutable hors ligne.
#
# Usage (racine du repo) :
#   pnpm check
#   ./scripts/ci.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> [ci] typecheck"
pnpm -r typecheck

echo "==> [ci] test"
pnpm -r test

echo "==> [ci] build @axiom/web"
pnpm --filter @axiom/web build

echo "==> [ci] OK"
