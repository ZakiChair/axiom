/**
 * Une instance est-elle RÉGLABLE depuis le graphe ?
 *
 * Le ⚙ des légendes (et le double-clic sur un pane) ouvre le menu « Indicateurs »
 * déplié sur l'instance visée. Deux familles d'instances n'y trouvent pourtant aucun
 * éditeur, et le bouton promettait donc des « Réglages de … » qu'il ne livrait pas :
 *  - les STRATÉGIES : la section « Actifs » du menu les exclut par construction
 *    (`category !== "strategy"`, components/IndicatorMenu.tsx) — elles se pilotent
 *    depuis le menu Stratégies, pas depuis celui-ci ;
 *  - les définitions SANS paramètre (Open Interest, OBV…) : le menu masque déjà son
 *    propre ✎ dans ce cas, l'éditeur n'afficherait que « Aucun paramètre. ».
 *
 * PURE et testée : c'est la même règle des deux côtés (légende overlay, en-tête de
 * pane, double-clic), et elle doit rester alignée sur celle du menu.
 */
import type { IndicatorDef } from "@axiom/types";

/** Vrai si le ⚙ mène à un éditeur réel pour cette définition. */
export function estReglable(def: IndicatorDef | undefined): boolean {
  if (!def) return false;
  if (def.category === "strategy") return false;
  return def.inputs.length > 0;
}
