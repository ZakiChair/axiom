/**
 * Budget de hauteur des panes d'indicateurs (revue du 2026-08-01 § 3.4).
 *
 * klinecharts alloue la hauteur des panes SÉPARÉS d'abord, puis donne au pane prix ce
 * qui reste — sans plancher (`_measurePaneHeight` : `candlePaneHeight =
 * paneExcludeXAxisHeight - indicatorPaneTotalHeight`). AXIOM crée chaque pane avec
 * `minHeight: 60`, ce qui protège les OSCILLATEURS ; rien ne protégeait le prix.
 * Reproduit dans le navigateur : à sept panes, le canvas du pane prix mesurait 4 px
 * CSS contre 100 px par oscillateur — plus une seule bougie à l'écran, sans le moindre
 * avertissement.
 *
 * Ce module ne contient que le calcul (pur, testé) ; l'application passe par
 * `chart.setPaneOptions({ id, height })` côté `chart/indicators.ts`.
 */

/** Part de la hauteur utile garantie au pane des prix. */
export const PART_PRIX_MIN = 0.45;

/** Hauteur plancher d'un pane d'indicateur (identique au `minHeight` de création). */
export const HAUTEUR_PANE_MIN = 60;

/** Hauteur par défaut d'un pane d'indicateur quand la place ne manque pas. */
export const HAUTEUR_PANE_DEFAUT = 100;

/**
 * Hauteur à donner à CHAQUE pane d'indicateur pour que le prix garde sa part.
 * Retourne `null` quand il n'y a rien à contraindre (aucun pane, ou hauteur inconnue) :
 * l'appelant laisse alors klinecharts faire.
 *
 * `hauteurUtile` = hauteur du conteneur moins l'axe des temps et les séparateurs.
 */
export function hauteurPaneIndicateur(hauteurUtile: number, nbPanes: number): number | null {
  if (nbPanes <= 0 || !Number.isFinite(hauteurUtile) || hauteurUtile <= 0) return null;
  const budget = hauteurUtile * (1 - PART_PRIX_MIN);
  const cible = Math.floor(budget / nbPanes);
  // Jamais sous le plancher : un pane de 20 px ne se lit pas non plus. C'est le rôle de
  // `paneMax` de refuser l'activation AVANT d'en arriver là.
  return Math.max(HAUTEUR_PANE_MIN, Math.min(HAUTEUR_PANE_DEFAUT, cible));
}

/**
 * Nombre maximal de panes d'indicateurs tenables à cette hauteur, chacun au plancher.
 * Sert au refus explicite à l'activation — plutôt que d'ajouter un indicateur qui
 * rendra 0 px en silence.
 */
export function paneMax(hauteurUtile: number): number {
  if (!Number.isFinite(hauteurUtile) || hauteurUtile <= 0) return 0;
  return Math.max(0, Math.floor((hauteurUtile * (1 - PART_PRIX_MIN)) / HAUTEUR_PANE_MIN));
}
