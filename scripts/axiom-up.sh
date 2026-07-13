#!/usr/bin/env bash
# One-shot AXIOM : daemon + front (dev) ou daemon servant le build (prod).
#
# Usage (racine du repo) :
#   pnpm up              # daemon + Vite dev (http://localhost:5173)
#   pnpm up:prod         # build front + daemon (http://127.0.0.1:8787)
#   ./scripts/axiom-up.sh [--prod]
#
# Prérequis : pnpm, bun. `pnpm install` auto si node_modules absent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROD=0
for arg in "$@"; do
  case "$arg" in
    --prod) PROD=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "erreur: argument inconnu: $arg (attendu: --prod)" >&2
      exit 2
      ;;
  esac
done

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "erreur: \`$1\` introuvable — installez-le avant \`pnpm up\`." >&2
    exit 1
  fi
}

need pnpm
need bun

if [[ ! -d node_modules ]]; then
  echo "==> [up] node_modules absent — pnpm install"
  pnpm install
fi

mkdir -p logs

PORT="${AXIOMD_PORT:-8787}"
HEALTH_URL="http://127.0.0.1:${PORT}/health"

DAEMON_PID=""
WEB_PID=""
# 1 si ce script a démarré le daemon (ne pas tuer un daemon pré-existant).
DAEMON_OURS=0

cleanup() {
  local code=$?
  # Évite de re-entrer pendant les kill/wait.
  trap - EXIT INT TERM
  echo ""
  echo "==> [up] arrêt…"
  if [[ -n "${WEB_PID}" ]] && kill -0 "${WEB_PID}" 2>/dev/null; then
    kill "${WEB_PID}" 2>/dev/null || true
    wait "${WEB_PID}" 2>/dev/null || true
  fi
  if [[ "${DAEMON_OURS}" -eq 1 && -n "${DAEMON_PID}" ]] && kill -0 "${DAEMON_PID}" 2>/dev/null; then
    kill "${DAEMON_PID}" 2>/dev/null || true
    wait "${DAEMON_PID}" 2>/dev/null || true
  fi
  exit "${code}"
}
trap cleanup EXIT INT TERM

health_ok() {
  # curl -f : non-2xx = échec. Timeout court pour le poll.
  curl -sf --connect-timeout 0.5 --max-time 1 "${HEALTH_URL}" >/dev/null 2>&1
}

wait_health() {
  local deadline=$((SECONDS + 15))
  while (( SECONDS < deadline )); do
    if health_ok; then
      return 0
    fi
    # Daemon planté avant d'écouter ?
    if [[ -n "${DAEMON_PID}" ]] && ! kill -0 "${DAEMON_PID}" 2>/dev/null; then
      echo "erreur: daemon mort avant /health — voir logs/daemon.log" >&2
      return 1
    fi
    sleep 0.25
  done
  echo "erreur: /health timeout (15 s) sur ${HEALTH_URL} — voir logs/daemon.log" >&2
  return 1
}

if [[ "${PROD}" -eq 1 ]]; then
  echo "==> [up] build @axiom/web (mode prod)"
  pnpm --filter @axiom/web build
fi

if health_ok; then
  echo "==> [up] daemon déjà up (${HEALTH_URL}) — réutilisation"
else
  echo "==> [up] démarrage daemon → logs/daemon.log"
  # Pas de nohup : on garde le PID enfant pour le trap SIGINT.
  bun apps/daemon/src/index.ts >>logs/daemon.log 2>&1 &
  DAEMON_PID=$!
  DAEMON_OURS=1
  wait_health
  echo "==> [up] daemon OK (${HEALTH_URL}, pid ${DAEMON_PID})"
fi

if [[ "${PROD}" -eq 1 ]]; then
  echo "==> [up] prod prête — ouvrir http://127.0.0.1:${PORT}"
  echo "    (Ctrl+C pour arrêter${DAEMON_OURS:+ le daemon})"
  if [[ "${DAEMON_OURS}" -eq 1 ]]; then
    wait "${DAEMON_PID}"
  else
    # Daemon externe : rester vivant jusqu'à SIGINT sans le tuer.
    while true; do sleep 3600; done
  fi
else
  echo "==> [up] Vite dev (daemon optionnel déjà sondé)"
  pnpm --filter @axiom/web dev &
  WEB_PID=$!
  wait "${WEB_PID}"
fi
