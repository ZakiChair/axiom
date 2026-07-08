/**
 * Divergences CVD spot vs perp — détecteur PUR (Task 16).
 *
 * L'ACCUMULATION trades → `CvdBucket[]` par bougie (spot ET perp) vit dans le
 * contrôleur (Task 17), comme le CVD existant (orderflow.ts). Ce module ne fait
 * QUE la détection sur une série de buckets déjà agrégée — aucun WS, aucun
 * timer, aucun accès DOM.
 *
 * Définition EXACTE de la divergence à l'indice i (i ≥ lookback) :
 *  - dSpot = spot[i] − spot[i−lookback], dPerp = perp[i] − perp[i−lookback].
 *  - divergence ssi sign(dSpot) ≠ sign(dPerp) (mismatch de signe — un zéro face
 *    à une valeur non nulle compte comme un mismatch ; deux zéros ne divergent
 *    jamais) ET |dSpot| ≥ médiane(|dSpot| sur la fenêtre glissante) ET idem pour
 *    |dPerp| (filtre anti-bruit, indépendant pour chaque série).
 *  - fenêtre glissante à l'indice i : les indices j valides (j ≥ lookback) de
 *    `i−lookback+1` à `i` INCLUS (donc `i` participe à sa propre médiane). Tant
 *    que i < 2×lookback−1, la fenêtre est plus courte que `lookback` (elle ne
 *    remonte jamais avant le premier indice valide).
 *  - kind = "spotUp_perpDown" si dSpot > 0 (donc dPerp < 0 par le mismatch),
 *    "spotDown_perpUp" si dSpot < 0. Cas dSpot === 0 : aucun des deux kinds ne
 *    s'applique littéralement au libellé du brief (qui ne définit que ces deux
 *    valeurs) → non signalé (choix documenté, cas dégénéré non couvert par les
 *    fixtures : un CVD spot parfaitement plat sur exactement `lookback` buckets).
 */

/** Point CVD (spot et perp cumulés) à la clôture d'un bucket. */
export interface CvdBucket {
  time: number;
  spot: number;
  perp: number;
}

/** Divergence détectée entre les deux CVD à l'indice correspondant. */
export interface CvdDivergence {
  time: number;
  kind: "spotUp_perpDown" | "spotDown_perpUp";
}

/** Médiane d'un tableau de nombres (moyenne des deux valeurs centrales si pair). PURE. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

/**
 * Détecte les divergences CVD spot/perp (filtrées par médiane anti-bruit).
 * `lookback` par défaut 14 (cf. brief).
 */
export function detectCvdDivergences(buckets: CvdBucket[], lookback = 14): CvdDivergence[] {
  const n = buckets.length;
  // Indexés comme `buckets` ; seuls les indices ≥ lookback sont renseignés.
  const dSpot: number[] = new Array(n).fill(Number.NaN);
  const dPerp: number[] = new Array(n).fill(Number.NaN);
  for (let i = lookback; i < n; i++) {
    dSpot[i] = (buckets[i]?.spot ?? 0) - (buckets[i - lookback]?.spot ?? 0);
    dPerp[i] = (buckets[i]?.perp ?? 0) - (buckets[i - lookback]?.perp ?? 0);
  }

  const out: CvdDivergence[] = [];
  for (let i = lookback; i < n; i++) {
    const ds = dSpot[i] ?? 0;
    const dp = dPerp[i] ?? 0;
    if (Math.sign(ds) === Math.sign(dp)) continue; // même direction => pas de divergence

    // Fenêtre glissante des `lookback` derniers indices valides, i INCLUS.
    const windowStart = Math.max(lookback, i - lookback + 1);
    const spotWindow: number[] = [];
    const perpWindow: number[] = [];
    for (let j = windowStart; j <= i; j++) {
      spotWindow.push(Math.abs(dSpot[j] ?? 0));
      perpWindow.push(Math.abs(dPerp[j] ?? 0));
    }
    if (Math.abs(ds) < median(spotWindow)) continue;
    if (Math.abs(dp) < median(perpWindow)) continue;

    if (ds > 0) {
      out.push({ time: buckets[i]?.time ?? 0, kind: "spotUp_perpDown" });
    } else if (ds < 0) {
      out.push({ time: buckets[i]?.time ?? 0, kind: "spotDown_perpUp" });
    }
    // ds === 0 : cas dégénéré non signalé (cf. docstring).
  }
  return out;
}
