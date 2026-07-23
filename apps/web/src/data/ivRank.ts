/**
 * IV Rank — percentile-RANK classique du DVOL courant dans son historique 90 j (OMON, vue
 * Smile). Contraste avec `cotIndex` (min-max amplitude) : ici on compte la PROPORTION de
 * l'historique strictement sous la valeur courante, pas sa position dans l'amplitude — deux
 * valeurs extrêmes rapprochées ne dominent donc pas le résultat (spec
 * `2026-07-23-lot-v13-consolidation-quickwins-design.md`).
 *
 * Fonction PURE.
 */

/**
 * `100 × (nb de points de `historique` STRICTEMENT < courant) / n`, arrondi à l'entier le plus
 * proche. Les points non finis (NaN/Infinity) de `historique` sont exclus avant de calculer `n`.
 * `null` si `n < 30` après exclusion (historique insuffisant) ou si `courant` n'est pas fini.
 */
export function ivRank(historique: number[], courant: number): number | null {
  if (!Number.isFinite(courant)) return null;
  const valides = historique.filter((v) => Number.isFinite(v));
  if (valides.length < 30) return null;
  const nbInferieurs = valides.filter((v) => v < courant).length;
  return Math.round((100 * nbInferieurs) / valides.length);
}
