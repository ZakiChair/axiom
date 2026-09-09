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
  /** Âge de la dernière observation, distinct de la profondeur historique. */
  ageJours?: number;
  /** Nombre de points utilisés. */
  n: number;
  /** Couverture de la cadence attendue, quand celle-ci est connue. */
  couverture?: { disponibles: number; attendus: number } | null;
}

/** Sous ce seuil de profondeur, le percentile serait trompeur → « réf. en construction ». */
export const PROFONDEUR_MIN_JOURS = 5;
export const OBSERVATIONS_MIN = 20;
export const COUVERTURE_MIN = 0.8;

const JOUR_MS = 86_400_000;

export interface OptionsReferentiel {
  minObservations?: number;
  profondeurMinJours?: number;
  cadenceAttendueMs?: number;
  couvertureMin?: number;
  ageMaxMs?: number;
}

/** Cadence médiane réellement observée entre points valides et distincts. */
export function cadenceObservee(serie: readonly PointSerie[], now = Date.now()): number | null {
  const temps = [...new Set(serie
    .map((p) => p.t)
    .filter((t) => Number.isFinite(t) && t <= now))]
    .sort((a, b) => a - b);
  const ecarts = temps.slice(1).map((t, i) => t - temps[i]!).filter((d) => d > 0).sort((a, b) => a - b);
  if (ecarts.length === 0) return null;
  const milieu = Math.floor(ecarts.length / 2);
  return ecarts.length % 2 === 1 ? ecarts[milieu]! : (ecarts[milieu - 1]! + ecarts[milieu]!) / 2;
}

/**
 * Rang percentile MI-DISTANCE : (strictement sous + ties / 2) / n × 100, 0..100.
 * NaN sous 2 valeurs. La convention mi-distance neutralise les masses d'égalités —
 * un funding scotché au clamp Binance (des dizaines de points identiques) lit p50,
 * pas p100. `strictementSous` = valeurs < valeur ; `ties` = valeurs === valeur.
 */
export function rangPercentile(valeurs: readonly number[], valeur: number): number {
  if (valeurs.length < 2) return Number.NaN;
  let strictementSous = 0;
  let ties = 0;
  for (const v of valeurs) {
    if (v < valeur) strictementSous += 1;
    else if (v === valeur) ties += 1;
  }
  return ((strictementSous + ties / 2) / valeurs.length) * 100;
}

/**
 * Situe `valeur` dans `serie`. Null si moins de 2 points finis ou si la série
 * couvre moins de PROFONDEUR_MIN_JOURS (référentiel en construction).
 */
export function referentiel(
  serie: readonly PointSerie[],
  valeur: number,
  now: number,
  options: OptionsReferentiel = {},
): Referentiel | null {
  if (!Number.isFinite(now) || !Number.isFinite(valeur)) return null;
  const uniques = new Map<number, PointSerie>();
  for (const p of serie) {
    if (!Number.isFinite(p.t) || p.t > now || !Number.isFinite(p.v)) continue;
    uniques.set(p.t, p);
  }
  const finis = [...uniques.values()].sort((a, b) => a.t - b.t);
  const minObservations = options.minObservations ?? OBSERVATIONS_MIN;
  if (finis.length < Math.max(2, minObservations)) return null;
  const premier = finis[0]!;
  const dernier = finis[finis.length - 1]!;
  const profondeurJours = (dernier.t - premier.t) / JOUR_MS;
  const ageJours = Math.max(0, now - dernier.t) / JOUR_MS;
  if (!(profondeurJours >= (options.profondeurMinJours ?? PROFONDEUR_MIN_JOURS))) return null;
  if (options.ageMaxMs !== undefined && now - dernier.t > options.ageMaxMs) return null;
  let couverture: Referentiel["couverture"] = null;
  const cadence = options.cadenceAttendueMs;
  if (cadence !== undefined && Number.isFinite(cadence) && cadence > 0) {
    const attendus = Math.floor((dernier.t - premier.t) / cadence) + 1;
    couverture = { disponibles: finis.length, attendus };
    if (attendus > 0 && finis.length / attendus < (options.couvertureMin ?? COUVERTURE_MIN)) return null;
  }
  return {
    percentile: rangPercentile(finis.map((p) => p.v), valeur),
    profondeurJours,
    ageJours,
    n: finis.length,
    couverture,
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
