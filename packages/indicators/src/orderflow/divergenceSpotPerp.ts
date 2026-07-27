/**
 * @axiom/indicators — orderflow/divergenceSpotPerp.ts
 *
 * Détecteur PUR de divergences de flux spot/perp — port index-based de
 * `detectCvdDivergences` (apps/web/src/chart/cvdSpotPerp.ts, module WS conservé
 * tel quel) pour le def REST `cvdSpotPerp`. Définition à l'indice i (i ≥ lookback) :
 *   dSpot = spot[i] − spot[i−lookback] ; dPerp idem ;
 *   divergence ssi sign(dSpot) ≠ sign(dPerp), AUCUN des deux n'est nul (garde
 *   symétrique zéro-delta : un côté plat ne prouve jamais une divergence), ET
 *   |dSpot| ≥ médiane(|dSpot| fenêtre glissante) ET idem |dPerp| (anti-bruit,
 *   indépendant par série). Fenêtre glissante : indices j VALIDES (bornes
 *   définies) de i−lookback+1 à i inclus. Les indices dont une borne est
 *   `undefined` sont sautés et exclus des médianes.
 */

export interface DivergenceSpotPerp {
  idx: number;
  sens: "spotHaussier" | "spotBaissier";
  /** Δ des jambes sur `lookback` bougies (unités de la série d'entrée — σ de flux
   * quand on lui passe les CVD normalisés du def). Exposés pour les tooltips. */
  dSpot: number;
  dPerp: number;
}

/** Médiane (moyenne des deux centrales si pair) — copie du module WS. PURE. */
function mediane(valeurs: number[]): number {
  const tri = [...valeurs].sort((a, b) => a - b);
  const mid = Math.floor(tri.length / 2);
  if (tri.length % 2 === 0) return ((tri[mid - 1] ?? 0) + (tri[mid] ?? 0)) / 2;
  return tri[mid] ?? 0;
}

export function detecterDivergencesSpotPerp(
  spot: ReadonlyArray<number | undefined>,
  perp: ReadonlyArray<number | undefined>,
  lookback: number,
): DivergenceSpotPerp[] {
  const n = spot.length;
  const dSpot: Array<number | undefined> = new Array(n).fill(undefined);
  const dPerp: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = lookback; i < n; i++) {
    const s1 = spot[i - lookback];
    const s2 = spot[i];
    const p1 = perp[i - lookback];
    const p2 = perp[i];
    if (s1 === undefined || s2 === undefined || p1 === undefined || p2 === undefined) continue;
    dSpot[i] = s2 - s1;
    dPerp[i] = p2 - p1;
  }

  const out: DivergenceSpotPerp[] = [];
  for (let i = lookback; i < n; i++) {
    const ds = dSpot[i];
    const dp = dPerp[i];
    if (ds === undefined || dp === undefined) continue;
    if (ds === 0 || dp === 0) continue; // garde symétrique : un côté plat, jamais de divergence
    if (Math.sign(ds) === Math.sign(dp)) continue;

    const fenSpot: number[] = [];
    const fenPerp: number[] = [];
    for (let j = Math.max(lookback, i - lookback + 1); j <= i; j++) {
      const a = dSpot[j];
      const b = dPerp[j];
      if (a !== undefined) fenSpot.push(Math.abs(a));
      if (b !== undefined) fenPerp.push(Math.abs(b));
    }
    if (Math.abs(ds) < mediane(fenSpot)) continue;
    if (Math.abs(dp) < mediane(fenPerp)) continue;

    out.push({ idx: i, sens: ds > 0 ? "spotHaussier" : "spotBaissier", dSpot: ds, dPerp: dp });
  }
  return out;
}
