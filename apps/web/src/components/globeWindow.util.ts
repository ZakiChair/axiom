/**
 * Textes PURS du pied de la fenêtre GLOBE (une note par source, avec fraîcheur
 * honnête) — extraits du JSX pour être testables au harnais vitest node sans DOM.
 */
import { formatAge, formatEntier } from "../lib/format";
import type { EtatConflitsUcdp, EtatEvenements, FrontUkraine } from "../data/globe/types";

/** Note GDELT : « jamais du live » — âge d'ingestion + largeur de fenêtre réelle. */
export function noteEvenements(etat: EtatEvenements | null, coucheActive: boolean, daemonOk: boolean, nowMs: number): string {
  if (!coucheActive) return "Événements : désactivé";
  if (!daemonOk) return "Événements : daemon hors ligne (pnpm run up)";
  if (etat === null || etat.majA === null) {
    return "Événements : GDELT en attente… (daemon frais requis — routes /globe)";
  }
  const fenetreH = etat.couverture === null ? 0 : Math.round((etat.couverture.aMs - etat.couverture.deMs) / 3_600_000);
  return `Événements : GDELT 15 min, ${formatEntier(etat.cellules.length)} zone${etat.cellules.length > 1 ? "s" : ""} sur ${formatEntier(fenetreH)} h, maj ${formatAge(etat.majA, nowMs)}`;
}

/** Note UCDP : fichier mensuel + âge de l'instantané daemon. */
export function noteConflits(etat: EtatConflitsUcdp | null, coucheActive: boolean, daemonOk: boolean, nowMs: number): string {
  if (!coucheActive) return "Conflits : désactivé";
  if (!daemonOk) return "Conflits : daemon hors ligne (pnpm run up)";
  if (etat === null) {
    return "Conflits : UCDP en attente… (si persiste : redémarrer daemon périmé)";
  }
  const version = etat.fichier.replace(/^GEDEvent_|\.csv$/g, "");
  return `Conflits : UCDP ${version} (~1 mois de lag), ${formatEntier(etat.zones.length)} zones, maj ${formatAge(etat.majA, nowMs)}`;
}

/** Note ISW : source non contractuelle, fraîcheur EditDate. */
export function noteUkraine(front: FrontUkraine | null, coucheActive: boolean, nowMs: number): string {
  if (!coucheActive) return "Ukraine : désactivé";
  if (front === null) return "Ukraine : ISW en attente…";
  const maj = front.majMs !== null ? `, maj ${formatAge(front.majMs, nowMs)}` : "";
  return `Ukraine : front ISW, ${formatEntier(front.n)} polygones${maj}`;
}
