/**
 * Capacité du graphe MAÎTRE en panes d'indicateurs — Zustand vanilla, éphémère
 * (jamais persisté : c'est une mesure de géométrie, pas une préférence).
 *
 * POURQUOI un store : le menu « Indicateurs » doit pouvoir REFUSER un indicateur à pane
 * séparé quand il n'y a plus la place, avec un message actionnable — plutôt que de
 * l'activer et de le laisser rendre 0 px en silence (revue du 2026-08-01 § 3.4). Le
 * menu ne connaît pas la géométrie du canvas ; seul `ChartIndicators` la mesure. Ce
 * store est le fil le plus court entre les deux, sans couplage direct.
 *
 * Seul le graphe MAÎTRE publie : les slots secondaires partagent la même liste
 * d'indicateurs mais ont leur propre hauteur, et c'est le maître que l'utilisateur
 * regarde quand il ouvre le menu.
 */
import { createStore } from "zustand/vanilla";

export interface ChartCapaciteState {
  /** Nombre max de panes séparés tenables à la hauteur courante ; 0 = inconnue. */
  paneMax: number;
  setPaneMax: (n: number) => void;
}

export const chartCapaciteStore = createStore<ChartCapaciteState>((set) => ({
  paneMax: 0,
  setPaneMax: (n) => set((s) => (s.paneMax === n ? s : { paneMax: n })),
}));

/**
 * Le plafond est-il atteint ? PURE. `paneMax === 0` (géométrie pas encore mesurée, ou
 * graphe démonté) ne bloque JAMAIS : on préfère laisser passer que verrouiller le menu
 * sur une mesure absente.
 */
export function plafondPanesAtteint(panesActifs: number, paneMax: number): boolean {
  return paneMax > 0 && panesActifs >= paneMax;
}
