/**
 * Fusion du journal d'alertes FRONT (store, onglet ouvert) et du journal DAEMON
 * (`GET /alerts/journal`, seul témoin des déclenchements onglet fermé), pour la
 * section Session du BRIEF. PURE — bornes du jour injectées par l'appelant.
 */
import type { AlerteDeclencheeBrief } from "../../data/brief";
import type { DeclenchementDaemon } from "../../data/daemon";

/**
 * Tolérance de dédoublonnage (ms). Un même déclenchement logique n'a PAS le même
 * horodatage des deux côtés : le front évalue à la clôture de bougie / au tick de son
 * runtime, le daemon sur son propre tick (10 s pour liq, 60 s pour funding). Une
 * égalité stricte ferait apparaître deux fois chaque alerte survenue onglet ouvert.
 */
export const TOLERANCE_DEDUP_MS = 60_000;

/** Ligne d'alerte de la section Session, avec sa provenance. */
export interface AlerteSession {
  alertId: string;
  ts: number;
  message: string;
  valeur: number;
  /** Symbole — connu seulement pour les entrées venues du daemon. */
  symbol?: string;
  /** Vrai : déclenchement remonté par le daemon et absent du journal front. */
  daemon: boolean;
}

/**
 * Fusionne les deux journaux sur la fenêtre `[debutJour, now]` : les entrées locales
 * font foi, les entrées daemon qui n'ont pas d'équivalent local (même `alertId` à
 * moins de `TOLERANCE_DEDUP_MS`) sont ajoutées et marquées `daemon`. Tri chronologique.
 */
export function fusionnerAlertesSession(
  locales: readonly AlerteDeclencheeBrief[],
  daemon: readonly DeclenchementDaemon[],
  debutJour: number,
  now: number,
): AlerteSession[] {
  const out: AlerteSession[] = locales.map((a) => ({
    alertId: a.alertId,
    ts: a.ts,
    message: a.message,
    valeur: a.valeur,
    daemon: false,
  }));
  for (const d of daemon) {
    if (d.ts < debutJour || d.ts > now) continue;
    const dejaVu = locales.some(
      (a) => a.alertId === d.alertId && Math.abs(a.ts - d.ts) <= TOLERANCE_DEDUP_MS,
    );
    if (dejaVu) continue;
    out.push({
      alertId: d.alertId,
      ts: d.ts,
      message: d.message,
      valeur: d.valeur,
      symbol: d.symbol,
      daemon: true,
    });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}
