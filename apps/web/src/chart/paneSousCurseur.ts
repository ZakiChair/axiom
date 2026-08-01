/**
 * Résolution « position du curseur → instance d'indicateur » pour le double-clic
 * d'ouverture des réglages (revue du 2026-08-01 § 5.1).
 *
 * Le pane des prix est volontairement EXCLU : il porte les bougies et jusqu'à N
 * overlays, un double-clic n'y désigne aucune instance en particulier — la légende
 * du pane prix a ses propres ⚙, un par ligne. Le geste ne vaut donc que pour les panes
 * séparés, où un pane = une instance.
 */

/** Géométrie minimale d'un pane, telle que la renvoie `chart.getSize`. */
export interface BoitePane {
  top: number;
  height: number;
}

/** Le point `y` (relatif au conteneur) tombe-t-il dans cette boîte ? PURE. */
export function dansLaBoite(y: number, boite: BoitePane): boolean {
  return y >= boite.top && y < boite.top + boite.height;
}

/**
 * instanceId du pane séparé contenant `y`, sinon null. PURE — la lecture de la
 * géométrie reste à l'appelant, ce qui rend la règle testable sans DOM ni graphe.
 */
export function instancePourY(
  y: number,
  panes: ReadonlyArray<{ instanceId: string; boite: BoitePane | null }>
): string | null {
  for (const p of panes) {
    if (p.boite !== null && dansLaBoite(y, p.boite)) return p.instanceId;
  }
  return null;
}
