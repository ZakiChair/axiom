#!/usr/bin/env bash
# One-shot AXIOM : daemon + front (dev) ou daemon servant le build (prod).
#
# Usage (racine du repo) :
#   pnpm up              # daemon + Vite dev (http://localhost:5173)
#   pnpm up:prod         # build front + daemon (http://127.0.0.1:8787)
#   ./scripts/axiom-up.sh [--prod]
#
# Prérequis : pnpm, bun, curl. `pnpm install` auto si node_modules absent.
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
need curl

if [[ ! -d node_modules ]]; then
  echo "==> [up] node_modules absent — pnpm install"
  pnpm install
fi

mkdir -p logs

PORT="${AXIOMD_PORT:-8787}"
if [[ ! "${PORT}" =~ ^[0-9]{1,5}$ ]]; then
  echo "erreur: AXIOMD_PORT doit être un entier entre 1 et 65535 (reçu: ${PORT})." >&2
  exit 2
fi
PORT=$((10#${PORT}))
if (( PORT < 1 || PORT > 65535 )); then
  echo "erreur: AXIOMD_PORT doit être compris entre 1 et 65535 (reçu: ${PORT})." >&2
  exit 2
fi
DAEMON_DEV_URL="http://127.0.0.1:${PORT}"
HEALTH_URL="${DAEMON_DEV_URL}/health"

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

valider_health_json() {
  bun -e '
    const requis = ["kv", "candles", "alerts", "replay", "globe", "snapshots", "proxy"];
    try {
      const brut = await Bun.stdin.text();
      if (brut.length === 0 || brut.length > 65_536) process.exit(1);
      const valeur = JSON.parse(brut);
      const capabilities = valeur?.capabilities;
      const valide =
        valeur?.ok === true &&
        valeur?.service === "axiomd" &&
        valeur?.apiVersion === 1 &&
        typeof valeur?.version === "string" &&
        Array.isArray(capabilities) &&
        requis.every((capability) => capabilities.includes(capability));
      if (!valide) process.exit(1);
    } catch {
      process.exit(1);
    }
  ' >/dev/null 2>&1
}

health_ok() {
  curl -fsS --noproxy "*" --connect-timeout 0.5 --max-time 1 \
    -H "Accept: application/json" "${HEALTH_URL}" 2>/dev/null | valider_health_json
}

health_reachable() {
  # Sans `-f` : un 404/500 prouve tout de même qu'un serveur occupe ce port.
  curl -sS --noproxy "*" --connect-timeout 0.5 --max-time 1 \
    -o /dev/null "${HEALTH_URL}" >/dev/null 2>&1
}

port_occupe() {
  # Couvre aussi un service TCP non-HTTP. `lsof` est standard sur macOS ; repli
  # HTTP conservateur ailleurs, sans ajouter un nouveau prérequis au launcher.
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -nP -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
    [[ -n "${pids}" ]]
  else
    health_reachable
  fi
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

demarrer_daemon() {
  echo "==> [up] démarrage daemon → logs/daemon.log"
  bun apps/daemon/src/index.ts >>logs/daemon.log 2>&1 &
  DAEMON_PID=$!
  DAEMON_OURS=1
  wait_health
  echo "==> [up] daemon OK (${HEALTH_URL}, pid ${DAEMON_PID})"
}

if health_ok; then
  echo "==> [up] daemon AXIOM compatible déjà actif — réutilisation"
elif health_reachable || port_occupe; then
  echo "erreur: le port ${PORT} est occupé mais ne sert pas un axiomd compatible." >&2
  echo "        AXIOM refuse d'arrêter un processus qu'il n'a pas démarré." >&2
  exit 1
else
  demarrer_daemon
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
  echo "==> [up] Vite dev (daemon ${DAEMON_DEV_URL})"
  VITE_AXIOMD_URL="${DAEMON_DEV_URL}" pnpm --filter @axiom/web dev &
  WEB_PID=$!
  wait "${WEB_PID}"
fi
