/**
 * Référentiels historiques : situer une valeur courante dans sa distribution
 * (percentile) avec la PROFONDEUR RÉELLE des données — jamais un percentile nu.
 * Tout est pur ; les historiques viennent de data/referentiels.ts.
 */

/** Point d'une série temporelle (t = ms epoch). */
export interface PointSerie {
  t: number;
  v: number;
}

/** Position d'une valeur dans son historique, avec la profondeur réelle. */
export interface Referentiel {
  /** Rang percentile 0..100 de la valeur courante. */
  percentile: number;
  /** Profondeur couverte par la série, en jours (réelle, pas nominale). */
  profondeurJours: number;
  /** Nombre de points utilisés. */
  n: number;
}

/** Sous ce seuil de profondeur, le percentile serait trompeur → « réf. en construction ». */
export const PROFONDEUR_MIN_JOURS = 5;

const JOUR_MS = 86_400_000;

/** Rang percentile : part des valeurs ≤ valeur (ties inclus), 0..100. NaN sous 2 valeurs. */
export function rangPercentile(valeurs: readonly number[], valeur: number): number {
  if (valeurs.length < 2) return Number.NaN;
  let sous = 0;
  for (const v of valeurs) if (v <= valeur) sous += 1;
  return (sous / valeurs.length) * 100;
}

/**
 * Situe `valeur` dans `serie`. Null si moins de 2 points finis ou si la série
 * couvre moins de PROFONDEUR_MIN_JOURS (référentiel en construction).
 */
export function referentiel(
  serie: readonly PointSerie[],
  valeur: number,
  now: number,
): Referentiel | null {
  const finis = serie.filter((p) => Number.isFinite(p.v));
  if (finis.length < 2 || !Number.isFinite(valeur)) return null;
  let plusAncien = Number.POSITIVE_INFINITY;
  for (const p of finis) if (p.t < plusAncien) plusAncien = p.t;
  const profondeurJours = (now - plusAncien) / JOUR_MS;
  if (!(profondeurJours >= PROFONDEUR_MIN_JOURS)) return null;
  return {
    percentile: rangPercentile(finis.map((p) => p.v), valeur),
    profondeurJours,
    n: finis.length,
  };
}

/** « p97 · 12 j » — percentile arrondi, profondeur arrondie au jour. */
export function texteRef(ref: Referentiel): string {
  return `p${Math.round(ref.percentile)} · ${Math.round(ref.profondeurJours)} j`;
}

/** Extrême = queue de distribution (≥ p90 ou ≤ p10). */
export function estExtreme(ref: Referentiel): boolean {
  return ref.percentile >= 90 || ref.percentile <= 10;
}
