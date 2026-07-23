/**
 * Helpers PURS de la fenêtre NETLIQ (testés) : normalisation de l'overlay BTC
 * (échelle propre 0..1 sur la fenêtre visible) et génération de ticks « ronds » en
 * Md$ pour la grille horizontale. Isolés du composant pour les GELER contre une
 * régression silencieuse — une courbe overlay écrasée ou une grille faussée
 * n'échoue ni au build ni au rendu, seul un test peut la détecter.
 */

/**
 * Normalise une série de clôtures en `y01 ∈ [0, 1]` sur les EXTRÊMES de la fenêtre
 * passée (0 = min, 1 = max) — « échelle propre » de l'overlay BTC, découplée du
 * domaine vertical de la liquidité. L'horodatage `t` est préservé (clé de jointure).
 * Renvoie `[]` si moins de 2 points ou si `max == min` (échelle dégénérée).
 */
export function normaliserSerieOverlay(
  closes: readonly { t: number; close: number }[],
): { t: number; y01: number }[] {
  if (closes.length < 2) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const c of closes) {
    if (c.close < min) min = c.close;
    if (c.close > max) max = c.close;
  }
  if (!(max > min)) return []; // max == min (ou non fini) → étendue nulle, pas d'échelle
  const etendue = max - min;
  return closes.map((c) => ({ t: c.t, y01: (c.close - min) / etendue }));
}

/** Pas « ronds » autorisés en Md$ pour la grille, du plus FIN au plus GROSSIER. */
const PAS_MD = [100, 250, 500, 1000] as const;

/**
 * Ticks ronds (multiples d'un `PAS_MD`) contenus dans `[min, max]`, en visant ~`n`
 * lignes. On retient le pas dont le nombre de multiples est le plus proche de `n` ;
 * à ÉGALITÉ, le pas le plus GROSSIER l'emporte (moins de lignes, grille plus aérée).
 * Renvoie `[]` si les bornes sont invalides (`max <= min`, non finies) ou `n ≤ 0`.
 */
export function ticksMd(min: number, max: number, n: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || n <= 0) return [];

  let meilleurPas: number = PAS_MD[0];
  let meilleurEcart = Infinity;
  for (const pas of PAS_MD) {
    const count = Math.floor(max / pas) - Math.ceil(min / pas) + 1;
    if (count <= 0) continue;
    const ecart = Math.abs(count - n);
    // « ≤ » : à écart égal, le pas plus grossier (parcouru après) remplace → aéré.
    if (ecart <= meilleurEcart) {
      meilleurEcart = ecart;
      meilleurPas = pas;
    }
  }

  const ticks: number[] = [];
  for (let v = Math.ceil(min / meilleurPas) * meilleurPas; v <= max; v += meilleurPas) {
    ticks.push(v);
  }
  return ticks;
}
