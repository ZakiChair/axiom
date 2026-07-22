#!/usr/bin/env bash
# Gate G5 — « alerte onglet fermé » : le daemon SEUL évalue et notifie (front FERMÉ).
#
# Démarche : daemon isolé sur le port 8791 (AUCUN front, aucun heartbeat → l'anti-
# doublon `doitNotifier` autorise la notification), création d'une alerte prix via
# l'API REST (PUT /kv/alerts/defs — le même canal que le dual-write du front), puis
# assertion sur GET /alerts/journal : la ligne du déclenchement existe avec
# notifie=true. Déclenchement en DEUX phases car le moteur CALIBRE sans déclencher
# à la 1re évaluation (engine.ts, frontArme) :
#   phase A — niveau inatteignable (999 999 999 $, sens hausse) : le 1er tick
#             miniTicker calibre/ré-arme l'alerte (arme=true, persisté) ;
#   phase B — niveau 1 $ : BTC ≥ 1 $ → le tick suivant déclenche (les défs KV sont
#             relues à CHAQUE évaluation, pas besoin d'attendre le poll 5 s).
#
# NOTE : la bannière macOS visuelle reste un coup d'œil HUMAIN pendant le run — ce
# script prouve le chemin daemon → journal → notify (notifie=true), pas l'affichage.
#
# Usage (racine du repo) : ./scripts/gate/g5-daemon-journal.sh
# Sortie : « G5 PASS » (code 0) ou « G5 FAIL : raison » (code 1).
# Prérequis : bun, curl, réseau vers Binance (WS miniTicker). Le daemon quotidien
# (pnpm up, port 8787) doit être ARRÊTÉ : sa base SQLite est à chemin fixe (db.ts)
# et un second évaluateur rendrait le résultat ambigu.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "G5 FAIL : \`$1\` introuvable — installez-le avant le test." >&2
    exit 1
  fi
}

need bun
need curl

PORT=8791 # port de test imposé (isolé du daemon quotidien 8787)
BASE="http://127.0.0.1:${PORT}"
DB="apps/daemon/axiom.db"
ID="g5-qa-$$-$(date +%s)"
LOG="logs/g5-daemon.log"
NIVEAU_ARMEMENT=999999999 # inatteignable → le 1er tick calibre arme=true
NIVEAU_DECLENCHE=1        # BTC ≥ 1 $ → le tick suivant déclenche

mkdir -p logs

DAEMON_PID=""
ORIG_PRESENT=0  # 1 si /kv/alerts/defs existait avant le test (à restaurer)
ORIG_DEFS="[]"  # défs d'origine (tableau JSON) — préservées telles quelles
DEFS_POSEES=0   # 1 dès que le script a écrit dans le KV (à nettoyer)

fail() {
  echo "G5 FAIL : $*"
  exit 1
}

# ─── Nettoyage (trap EXIT) : restaurer le KV, tuer le daemon, purger la base ───
cleanup() {
  local code=$?
  trap - EXIT INT TERM
  # 1. Restaurer les défs KV d'origine via REST (le daemon tient encore la base).
  if [[ "${DEFS_POSEES}" -eq 1 && -n "${DAEMON_PID}" ]] && kill -0 "${DAEMON_PID}" 2>/dev/null; then
    if [[ "${ORIG_PRESENT}" -eq 1 ]]; then
      curl -fsS --noproxy "*" -X PUT --data-binary "${ORIG_DEFS}" "${BASE}/kv/alerts/defs" >/dev/null 2>&1 || true
    else
      curl -fsS --noproxy "*" -X DELETE "${BASE}/kv/alerts/defs" >/dev/null 2>&1 || true
    fi
  fi
  # 2. Arrêter le daemon et ATTENDRE sa fin (la purge exige la base libérée).
  if [[ -n "${DAEMON_PID}" ]] && kill -0 "${DAEMON_PID}" 2>/dev/null; then
    kill "${DAEMON_PID}" 2>/dev/null || true
    wait "${DAEMON_PID}" 2>/dev/null || true
  fi
  # 3. Purger l'état + le journal de l'alerte de test (best-effort, daemon mort).
  if [[ "${DEFS_POSEES}" -eq 1 && -e "${DB}" ]]; then
    G5_DB="${DB}" G5_ID="${ID}" bun -e '
      import { Database } from "bun:sqlite";
      try {
        const d = new Database(Bun.env.G5_DB);
        for (const table of ["alertes_journal", "alertes_etat"]) {
          try { d.query(`DELETE FROM ${table} WHERE alertId = ?`).run(Bun.env.G5_ID); } catch {}
        }
        d.close();
      } catch {}
    ' >/dev/null 2>&1 || true
  fi
  exit "${code}"
}
trap cleanup EXIT INT TERM

# ─── Gardes : base SQLite non partagée + port de test libre ───
# db.ts fixe le chemin de la base (aucun env) : un autre axiomd (quel que soit son
# port) la tenant ouverte évaluerait AUSSI l'alerte de test → journal en double et
# `notifie` ambigu (son heartbeat front peut être récent). On refuse net.
if [[ -e "${DB}" ]] && command -v lsof >/dev/null 2>&1; then
  if lsof -t "${DB}" >/dev/null 2>&1; then
    fail "la base ${DB} est ouverte par un autre processus (axiomd déjà actif ?) — arrêtez-le avant le test"
  fi
fi
if command -v lsof >/dev/null 2>&1; then
  if [[ -n "$(lsof -nP -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)" ]]; then
    fail "le port ${PORT} est déjà occupé — libérez-le avant le test"
  fi
elif curl -sS --noproxy "*" --connect-timeout 0.5 --max-time 1 -o /dev/null "${BASE}/health" >/dev/null 2>&1; then
  fail "le port ${PORT} est déjà occupé — libérez-le avant le test"
fi

# ─── Démarrage du daemon isolé (aucun front) ───
echo "==> [g5] démarrage daemon isolé (port ${PORT}) → ${LOG}"
AXIOMD_PORT="${PORT}" bun apps/daemon/src/index.ts >>"${LOG}" 2>&1 &
DAEMON_PID=$!

health_ok() {
  local corps
  corps="$(curl -fsS --noproxy "*" --connect-timeout 0.5 --max-time 1 \
    -H "Accept: application/json" "${BASE}/health" 2>/dev/null)" || return 1
  printf '%s' "${corps}" | bun -e '
    try {
      const v = JSON.parse(await Bun.stdin.text());
      if (!(v?.ok === true && v?.service === "axiomd")) process.exit(1);
    } catch { process.exit(1); }
  ' >/dev/null 2>&1
}

deadline=$((SECONDS + 15))
until health_ok; do
  if ! kill -0 "${DAEMON_PID}" 2>/dev/null; then
    fail "daemon mort avant /health — voir ${LOG}"
  fi
  if (( SECONDS >= deadline )); then
    fail "/health timeout (15 s) sur ${BASE} — voir ${LOG}"
  fi
  sleep 0.25
done
echo "==> [g5] daemon OK (pid ${DAEMON_PID})"

# ─── Sauvegarde des défs d'origine (restaurées au nettoyage) ───
if CORPS_ORIG="$(curl -fsS --noproxy "*" "${BASE}/kv/alerts/defs" 2>/dev/null)"; then
  ORIG_PRESENT=1
  ORIG_DEFS="$(printf '%s' "${CORPS_ORIG}" | bun -e '
    const v = JSON.parse(await Bun.stdin.text());
    console.log(JSON.stringify(Array.isArray(v?.valeur) ? v.valeur : []));
  ')"
fi

# Écrit les défs KV = défs d'origine + l'alerte de test au niveau donné ($1).
# `declenchements: []` est REQUIS : le moteur y appose l'horodatage au déclenchement.
poser_def() {
  local corps
  corps="$(G5_ORIG="${ORIG_DEFS}" G5_ID="${ID}" G5_NIVEAU="$1" bun -e '
    const orig = JSON.parse(Bun.env.G5_ORIG ?? "[]");
    const defs = Array.isArray(orig) ? [...orig] : [];
    defs.push({
      id: Bun.env.G5_ID,
      symbol: "BTCUSDT",
      source: "binance",
      condition: { type: "prix-croise", niveau: Number(Bun.env.G5_NIVEAU), sens: "hausse" },
      message: "G5 QA — déclenchement de test (script gate)",
      actif: true,
      declenchements: [],
    });
    console.log(JSON.stringify(defs));
  ')"
  curl -fsS --noproxy "*" -X PUT -H "content-type: application/json" \
    --data-binary "${corps}" "${BASE}/kv/alerts/defs" >/dev/null
  DEFS_POSEES=1
}

# Cherche la ligne de test dans GET /alerts/journal.
# Écrit « notifie » ou « silencieux » si trouvée, rien sinon. Jamais fatal (poll).
chercher_journal() {
  local corps
  corps="$(curl -fsS --noproxy "*" --max-time 2 "${BASE}/alerts/journal" 2>/dev/null)" || return 0
  printf '%s' "${corps}" | G5_ID="${ID}" bun -e '
    try {
      const v = JSON.parse(await Bun.stdin.text());
      const ligne = (v?.journal ?? []).find((l) => l?.alertId === Bun.env.G5_ID);
      if (ligne) console.log(ligne.notifie === true ? "notifie" : "silencieux");
    } catch {}
  ' 2>/dev/null || true
}

# ─── Déclenchement en deux phases (3 tentatives : réseau/tick parfois lents) ───
RESULTAT=""
for cycle in 1 2 3; do
  echo "==> [g5] cycle ${cycle} : phase A — armement (niveau ${NIVEAU_ARMEMENT}, le 1er tick calibre)"
  poser_def "${NIVEAU_ARMEMENT}"
  # Poll KV des symboles (5 s) + connexion WS Binance + 1er tick miniTicker (~1 s).
  sleep 12
  echo "==> [g5] cycle ${cycle} : phase B — franchissement (niveau ${NIVEAU_DECLENCHE} \$, BTC au-dessus)"
  poser_def "${NIVEAU_DECLENCHE}"
  deadline=$((SECONDS + 20))
  while (( SECONDS < deadline )); do
    RESULTAT="$(chercher_journal)"
    if [[ -n "${RESULTAT}" ]]; then break 2; fi
    sleep 1
  done
done

if [[ -z "${RESULTAT}" ]]; then
  fail "aucun déclenchement journalisé après 3 cycles (~1,5 min) — réseau Binance ? voir ${LOG}"
fi
if [[ "${RESULTAT}" != "notifie" ]]; then
  fail "déclenchement journalisé mais notifie=false (un front a-t-il envoyé un heartbeat ?)"
fi

# Preuve : la ligne de journal brute (alertId + notifie=true).
LIGNE="$(curl -fsS --noproxy "*" "${BASE}/alerts/journal" 2>/dev/null | G5_ID="${ID}" bun -e '
  try {
    const v = JSON.parse(await Bun.stdin.text());
    const ligne = (v?.journal ?? []).find((l) => l?.alertId === Bun.env.G5_ID);
    if (ligne) console.log(JSON.stringify(ligne));
  } catch {}
' 2>/dev/null || true)"
[[ -n "${LIGNE}" ]] && echo "==> [g5] journal : ${LIGNE}"

echo "G5 PASS"
