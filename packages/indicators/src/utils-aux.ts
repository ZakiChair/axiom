/**
 * @axiom/indicators — utils-aux.ts
 *
 * Helper PUR pour aligner une série auxiliaire (OI, funding, stablecoins…) sur
 * les timestamps de bougies. Ne fait AUCUN fetch : l'appelant fournit déjà les
 * `points` pré-récupérés. Garantit la pureté du moteur (§ contrat aux).
 */

/**
 * Aligne `points` (triés par `time` croissant) sur `candleTimes` : pour chaque
 * bougie, renvoie la dernière valeur connue dont `time <= t` (two-pointer,
 * O(candleTimes.length + points.length)). `undefined` avant le premier point.
 * Un point exactement à `t` est inclus dès ce `t`.
 */
export function alignAux(
  candleTimes: number[],
  points: { time: number; value: number }[]
): Array<number | undefined> {
  const n = candleTimes.length;
  const out = new Array<number | undefined>(n).fill(undefined);

  let p = 0;
  let current: number | undefined;
  for (let i = 0; i < n; i++) {
    const t = candleTimes[i]!;
    while (p < points.length && points[p]!.time <= t) {
      current = points[p]!.value;
      p++;
    }
    out[i] = current;
  }
  return out;
}
