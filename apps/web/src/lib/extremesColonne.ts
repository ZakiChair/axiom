/**
 * Extrêmes cross-sectionnels d'une colonne du screener : seuil du 9e décile
 * de l'univers AFFICHÉ (pas d'historique — la comparaison est entre pairs).
 */

/** Seuil au quantile q (ex. 0.9) de la colonne. Null sous 10 valeurs finies. */
export function seuilDecile(valeurs: readonly number[], quantile: number): number | null {
  const finies = valeurs.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finies.length < 10) return null;
  const idx = Math.min(finies.length - 1, Math.max(0, Math.ceil(quantile * finies.length) - 1));
  return finies[idx] ?? null;
}

/** Une cellule est extrême si |v| atteint le seuil (calculé sur les |valeurs|). */
export function estExtremeColonne(v: number | undefined, seuil: number | null): boolean {
  if (v === undefined || seuil === null || !Number.isFinite(v)) return false;
  return Math.abs(v) >= seuil;
}
