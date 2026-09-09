#!/usr/bin/env bash
# CI locale AXIOM — typecheck + tests monorepo + build du front.
# Aucune dépendance GitHub / remote : exécutable hors ligne.
#
# Usage (racine du repo) :
#   pnpm check
#   ./scripts/ci.sh
#   pnpm check:e2e   # parcours navigateur hermétiques uniquement (Chromium installé)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${1:-}" == "--e2e" && "$#" == 1 ]]; then
  # Port isolé du lot maintenance ; un appel explicite peut le remplacer si nécessaire.
  export AXIOM_E2E_PORT="${AXIOM_E2E_PORT:-5239}"
  exec pnpm --filter @axiom/web exec playwright test \
    gate-g6-screener.hermetique gate-lot3-corr gate-v25-cap-dominance \
    gate-g3-playbooks corrections-revue macro-globale dom-microstructure onchain-complements \
    revue-evenements qualite-fraicheur
elif [[ "$#" != 0 ]]; then
  echo "Usage : $0 [--e2e]" >&2
  exit 2
fi

echo "==> [ci] typecheck"
pnpm -r typecheck

echo "==> [ci] test"
pnpm -r test

echo "==> [ci] build @axiom/web"
pnpm --filter @axiom/web build

echo "==> [ci] OK"
