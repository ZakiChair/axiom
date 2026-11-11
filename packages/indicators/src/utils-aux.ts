/**
 * @axiom/indicators — utils-aux.ts
 *
 * Helper PUR pour aligner une série auxiliaire (OI, funding, stablecoins…) sur
 * les timestamps de bougies. Ne fait AUCUN fetch : l'appelant fournit déjà les
 * `points` pré-récupérés. Garantit la pureté du moteur (§ contrat aux).
 *
 * CONVENTION D'HORODATAGE (arrêtée le 2026-09-02, suggestion 17 de la revue).
 * Deux familles de séries auxiliaires cohabitent, et le mode d'alignement doit
 * suivre l'horodatage des points :
 *
 *  1. Points portant l'INSTANT OÙ LA VALEUR EST CONNUE (OI/funding : clôture d'un
 *     bucket, ou relevé instantané). L'appelant les horodate à cet instant — pour un
 *     bucket, sa FIN, pas son début — et demande `surCloture = true` : chaque bougie
 *     reçoit alors la dernière valeur connue à sa CLÔTURE. Les deux moitiés vont
 *     ENSEMBLE : décaler les points sans passer en mode clôture retarderait d'une
 *     barre un graphe dont le pas égale celui du bucket.
 *  2. Points appariés 1:1 sur l'OUVERTURE de la bougie (séries déjà fetchées à
 *     l'interval du graphe : `perpDelta`, `refClose`), ou horodatés au DÉBUT de leur
 *     période (séries quotidiennes). Elles gardent `surCloture = false` (défaut) :
 *     le mode clôture leur ferait au contraire lire la période SUIVANTE.
 */

/**
 * Aligne `points` (triés par `time` croissant) sur `candleTimes` : pour chaque
 * bougie, renvoie la dernière valeur connue jusqu'à sa borne de lecture (two-pointer,
 * O(candleTimes.length + points.length)). `undefined` avant le premier point.
 * Un point exactement sur la borne est inclus dès cette borne.
 *
 * La borne est l'OUVERTURE de la bougie par défaut ; avec `surCloture`, c'est sa
 * CLÔTURE, prise comme l'ouverture de la bougie SUIVANTE (exacte même à pas variable
 * — mensuel, trous de séance). Pour la DERNIÈRE bougie, la clôture est extrapolée du
 * dernier pas ; avec une seule bougie le pas est inconnu → repli sur l'ouverture.
 * Un TROU dans `candleTimes` élargit d'autant la borne de la bougie qui le précède :
 * écart assumé, une bougie isolée avant un trou peut lire au-delà de sa vraie clôture.
 */
export function alignAux(
  candleTimes: number[],
  points: { time: number; value: number }[],
  surCloture = false
): Array<number | undefined> {
  const n = candleTimes.length;
  const out = new Array<number | undefined>(n).fill(undefined);
  const dernierPas = n >= 2 ? candleTimes[n - 1]! - candleTimes[n - 2]! : 0;

  let p = 0;
  let current: number | undefined;
  for (let i = 0; i < n; i++) {
    const t = candleTimes[i]!;
    const borne = surCloture ? candleTimes[i + 1] ?? t + dernierPas : t;
    while (p < points.length && points[p]!.time <= borne) {
      current = points[p]!.value;
      p++;
    }
    out[i] = current;
  }
  return out;
}

/**
 * Projette sur les bougies d'un graphe une série calculée sur une unité SUPÉRIEURE
 * (EMA 1d ou RSI 4h sur un graphe 1h). Chaque valeur supérieure est datée à la CLÔTURE
 * de sa bougie (ouverture + `dureeSup`), instant où elle est connue (famille 1 de la
 * convention ci-dessus) ; chaque bougie du graphe lit la dernière bougie supérieure
 * close au plus tard à SA clôture (ouverture + `dureeGraphe`). Sur un graphe 1h, l'EMA
 * 4h de 00:00-04:00 apparaît donc sur la bougie 03:00, close à 04:00 : la courbe monte
 * en escalier, en retard d'au plus une période supérieure, et ne repeint jamais.
 *
 * Réutilise `alignAux` : les points portent l'INDICE de la bougie supérieure, remplacé
 * ensuite par sa valeur. Une valeur supérieure absente (amorce, trou du calcul) reste
 * absente sur le graphe, jamais remplacée par la précédente. La borne de lecture vient
 * de la durée connue du graphe, pas de la bougie suivante : un trou du graphe n'élargit
 * aucune borne (contrairement au mode `surCloture`).
 *
 * L'appelant ne fournit que des bougies supérieures CLOSES (la bougie en cours
 * repeindrait), triées par ouverture croissante. PURE.
 */
export function projeterSurUnite(
  tempsGraphe: number[],
  dureeGraphe: number,
  ouverturesSup: number[],
  dureeSup: number,
  serieSup: Array<number | undefined>
): Array<number | undefined> {
  const points = ouverturesSup.map((t, k) => ({ time: t + dureeSup, value: k }));
  const indices = alignAux(tempsGraphe.map((t) => t + dureeGraphe), points);
  return indices.map((k) => (k === undefined ? undefined : serieSup[k]));
}
