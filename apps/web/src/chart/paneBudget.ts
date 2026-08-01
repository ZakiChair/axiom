/**
 * Budget de hauteur des panes d'indicateurs (revue du 2026-08-01 § 3.4).
 *
 * klinecharts alloue la hauteur des panes SÉPARÉS d'abord, puis donne au pane prix ce
 * qui reste — sans plancher (`_measurePaneHeight` : `candlePaneHeight =
 * paneExcludeXAxisHeight - indicatorPaneTotalHeight`). AXIOM crée chaque pane avec
 * `minHeight: 60`, ce qui protège les OSCILLATEURS ; rien ne protégeait le prix.
 * Reproduit dans le navigateur : à sept panes, le canvas du pane prix mesurait 4 px
 * CSS contre 100 px par oscillateur — plus une seule bougie à l'écran.
 *
 * PRINCIPE : ce module est un FILET, pas une mise en page. Il n'intervient que si le
 * pane prix est réellement étouffé, et il se contente alors de rogner les panes
 * d'indicateurs. Tant que le prix a sa part, les hauteurs sont laissées telles quelles
 * — c'est ce qui permet au redimensionnement manuel (`dragEnabled: true`) de tenir,
 * y compris pour agrandir un pane bien au-delà de la hauteur par défaut.
 */

/** Part de la hauteur utile garantie au pane des prix. */
export const PART_PRIX_MIN = 0.45;

/** Hauteur plancher d'un pane d'indicateur (identique au `minHeight` de création). */
export const HAUTEUR_PANE_MIN = 60;

/** Hauteur par défaut d'un pane d'indicateur, appliquée par klinecharts à la création. */
export const HAUTEUR_PANE_DEFAUT = 100;

/**
 * Hauteurs corrigées des panes d'indicateurs, ou `null` s'il n'y a rien à corriger.
 *
 * `hauteurUtile` est la hauteur que klinecharts répartit (pane prix + panes séparés) ;
 * `hauteurs` sont les hauteurs COURANTES des panes séparés, dans l'ordre. Retourne
 * `null` quand le prix a déjà sa part — cas de très loin le plus fréquent, et c'est
 * ce qui rend la fonction sûre à appeler à chaque frame.
 *
 * Quand le prix est étouffé, chaque pane est rogné PROPORTIONNELLEMENT à sa hauteur
 * courante : un pane que l'utilisateur avait agrandi reste le plus grand des trois
 * après correction, au lieu d'être ramené au même rang que les autres. PURE.
 */
export function hauteursCorrigees(
  hauteurUtile: number,
  hauteurs: readonly number[]
): number[] | null {
  if (hauteurs.length === 0 || !Number.isFinite(hauteurUtile) || hauteurUtile <= 0) return null;
  const total = hauteurs.reduce((s, h) => s + h, 0);
  if (total <= 0) return null;

  const budget = hauteurUtile * (1 - PART_PRIX_MIN);
  if (total <= budget) return null; // le prix a sa part : on ne touche à rien.

  // Rognage proportionnel, borné au plancher de lisibilité d'un pane.
  const facteur = budget / total;
  const corrigees = hauteurs.map((h) => Math.max(HAUTEUR_PANE_MIN, Math.floor(h * facteur)));
  // Si tout est déjà au plancher, la correction ne change rien : ne rien émettre plutôt
  // que réécrire les mêmes valeurs à chaque frame.
  return corrigees.every((h, i) => h === hauteurs[i]) ? null : corrigees;
}

/**
 * Nombre maximal de panes d'indicateurs tenables à cette hauteur, chacun au plancher.
 * Sert au refus explicite à l'activation — plutôt que d'ajouter un indicateur qui
 * rendrait le pane prix illisible en silence.
 */
export function paneMax(hauteurUtile: number): number {
  if (!Number.isFinite(hauteurUtile) || hauteurUtile <= 0) return 0;
  return Math.max(0, Math.floor((hauteurUtile * (1 - PART_PRIX_MIN)) / HAUTEUR_PANE_MIN));
}
