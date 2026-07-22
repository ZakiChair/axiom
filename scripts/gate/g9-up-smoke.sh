#!/usr/bin/env bash
# Gate G9 — « axiom up » : front + daemon démarrés en UNE commande (smoke test).
#
# Démarche : vérifie que les ports 5173 (Vite) et 8787 (daemon) sont LIBRES —
# sinon échec explicite, ce script ne tue JAMAIS un processus existant — puis
# lance le lanceur en arrière-plan dans son PROPRE groupe de processus, poll
# /health (JSON axiomd) puis http://localhost:5173 (HTML du front), envoie
# SIGINT au groupe entier (reproduction fidèle du Ctrl+C terminal — c'est le
# contrat du trap cleanup de axiom-up.sh) et vérifie que daemon ET Vite sont
# bien morts (ports relibérés).
#
# NOTE : `pnpm up` NU résout vers le builtin pnpm `update` (alias `up`) et ne
# lance PAS le stack — seul `pnpm run up` atteint scripts/axiom-up.sh (piège
# corrigé dans le README le 2026-07-22). Le gate teste donc `pnpm run up`
# (1 commande, même chaîne que la doc).
#
# Usage (racine du repo) : ./scripts/gate/g9-up-smoke.sh
# Sortie : « G9 PASS » (code 0) ou « G9 FAIL : raison » (code 1).
# Prérequis : pnpm, bun, curl. AXIOMD_PORT respecté comme dans axiom-up.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "G9 FAIL : \`$1\` introuvable — installez-le avant le test." >&2
    exit 1
  fi
}

need pnpm
need bun
need curl

PORT="${AXIOMD_PORT:-8787}"
VITE_PORT=5173
HEALTH_URL="http://127.0.0.1:${PORT}/health"
VITE_URL="http://localhost:${VITE_PORT}"
LOG="logs/g9-up.log"

mkdir -p logs
# Log par run : tronqué au départ pour que les queues de diagnostic (fail)
# ne montrent jamais les lignes d'un run précédent.
: >"${LOG}"

UP_PID=""

fail() {
  echo "G9 FAIL : $*"
  # Diagnostic : queues des logs du lanceur et du daemon.
  local f
  for f in "${LOG}" logs/daemon.log; do
    if [[ -s "${f}" ]]; then
      echo "---- queue ${f} ----"
      tail -n 15 "${f}"
    fi
  done
  exit 1
}

# ─── Nettoyage (trap EXIT) : ne jamais laisser d'orphelin ───
# Cible UNIQUEMENT le groupe de processus lancé par ce script (jamais un
# processus tiers) : SIGINT d'abord (chemin propre du trap axiom-up.sh),
# escalade TERM puis KILL seulement si le groupe survit.
cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [[ -n "${UP_PID}" ]] && kill -0 -"${UP_PID}" 2>/dev/null; then
    kill -INT -"${UP_PID}" 2>/dev/null || true
    local fin=$((SECONDS + 10))
    while (( SECONDS < fin )) && kill -0 -"${UP_PID}" 2>/dev/null; do
      sleep 0.25
    done
    if kill -0 -"${UP_PID}" 2>/dev/null; then
      kill -TERM -"${UP_PID}" 2>/dev/null || true
      sleep 1
      kill -KILL -"${UP_PID}" 2>/dev/null || true
    fi
  fi
  if [[ -n "${UP_PID}" ]]; then
    wait "${UP_PID}" 2>/dev/null || true
  fi
  exit "${code}"
}
trap cleanup EXIT INT TERM

# ─── Sondes ports / services ───
port_occupe() {
  # $1 = port, $2 = URL sonde (repli conservateur sans lsof, comme axiom-up.sh).
  if command -v lsof >/dev/null 2>&1; then
    [[ -n "$(lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null || true)" ]]
  else
    curl -sS --noproxy "*" --connect-timeout 0.5 --max-time 1 \
      -o /dev/null "$2" >/dev/null 2>&1
  fi
}

health_ok() {
  curl -fsS --noproxy "*" --connect-timeout 0.5 --max-time 1 \
    -H "Accept: application/json" "${HEALTH_URL}" 2>/dev/null | bun -e '
    try {
      const v = JSON.parse(await Bun.stdin.text());
      if (!(v?.ok === true && v?.service === "axiomd" && v?.apiVersion === 1)) process.exit(1);
    } catch { process.exit(1); }
  ' >/dev/null 2>&1
}

front_ok() {
  local corps
  corps="$(curl -fsS --noproxy "*" --connect-timeout 0.5 --max-time 2 \
    "${VITE_URL}" 2>/dev/null)" || return 1
  # HTML du front : la racine React (survit à la transformation dev de Vite).
  [[ "${corps}" == *'<div id="root">'* ]]
}

# ─── Gardes : les deux ports doivent être LIBRES avant le lancement ───
if port_occupe "${PORT}" "${HEALTH_URL}"; then
  fail "le port ${PORT} (daemon) est déjà occupé — arrêtez le processus qui l'occupe avant le test (ce script ne tue jamais un processus existant)"
fi
if port_occupe "${VITE_PORT}" "${VITE_URL}"; then
  fail "le port ${VITE_PORT} (Vite) est déjà occupé — arrêtez le processus qui l'occupe avant le test (ce script ne tue jamais un processus existant)"
fi

# ─── Lancement : pnpm run up dans son propre groupe de processus ───
# `set -m` donne au job son propre pgid → `kill -INT -PGID` reproduit le Ctrl+C
# terminal (SIGINT à TOUT le groupe : pnpm + axiom-up.sh + bun + vite).
echo "==> [g9] lancement \`pnpm run up\` → ${LOG}"
set -m
pnpm run up >>"${LOG}" 2>&1 &
UP_PID=$!
set +m

# ─── Poll daemon : /health doit servir le JSON axiomd ───
# Timeout généreux : axiom-up.sh peut lancer `pnpm install` si node_modules absent.
echo "==> [g9] attente daemon (${HEALTH_URL}, timeout 240 s)"
deadline=$((SECONDS + 240))
until health_ok; do
  if ! kill -0 "${UP_PID}" 2>/dev/null; then
    fail "\`pnpm run up\` mort avant que /health réponde — voir ${LOG}"
  fi
  if (( SECONDS >= deadline )); then
    fail "/health timeout (240 s) sur ${HEALTH_URL} — voir ${LOG}"
  fi
  sleep 0.5
done
echo "==> [g9] daemon OK (${HEALTH_URL})"

# ─── Poll front : Vite doit servir le HTML (racine React) ───
echo "==> [g9] attente front (${VITE_URL}, timeout 120 s)"
deadline=$((SECONDS + 120))
until front_ok; do
  if ! kill -0 "${UP_PID}" 2>/dev/null; then
    fail "\`pnpm run up\` mort avant que Vite réponde — voir ${LOG}"
  fi
  if (( SECONDS >= deadline )); then
    fail "front timeout (120 s) sur ${VITE_URL} — voir ${LOG}"
  fi
  sleep 0.5
done
echo "==> [g9] front OK (${VITE_URL})"

# ─── Arrêt : SIGINT au groupe = Ctrl+C — le trap de axiom-up.sh doit tout tuer ───
echo "==> [g9] SIGINT au groupe ${UP_PID} (équivalent Ctrl+C)"
if ! kill -INT -"${UP_PID}" 2>/dev/null; then
  fail "impossible d'envoyer SIGINT au groupe ${UP_PID}"
fi

deadline=$((SECONDS + 20))
while (( SECONDS < deadline )); do
  if ! kill -0 "${UP_PID}" 2>/dev/null \
    && ! port_occupe "${PORT}" "${HEALTH_URL}" \
    && ! port_occupe "${VITE_PORT}" "${VITE_URL}"; then
    break
  fi
  sleep 0.25
done

if kill -0 "${UP_PID}" 2>/dev/null; then
  fail "\`pnpm run up\` (pid ${UP_PID}) toujours vivant 20 s après SIGINT — trap de axiom-up.sh cassé ?"
fi
if port_occupe "${PORT}" "${HEALTH_URL}"; then
  fail "port ${PORT} (daemon) toujours occupé 20 s après SIGINT — processus orphelin"
fi
if port_occupe "${VITE_PORT}" "${VITE_URL}"; then
  fail "port ${VITE_PORT} (Vite) toujours occupé 20 s après SIGINT — processus orphelin"
fi
wait "${UP_PID}" 2>/dev/null || true
echo "==> [g9] arrêt propre : daemon et Vite morts, ports ${PORT} et ${VITE_PORT} relibérés"

echo "G9 PASS"
