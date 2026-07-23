/**
 * @axiom/indicators — statistical/betaRef.ts
 *
 * Bêta roulant des RENDEMENTS LOG du symbole courant vs ceux du symbole de RÉFÉRENCE
 * (série auxiliaire `refClose`, close du symbole de référence aligné LOCF sur les bougies
 * du chart). Deuxième indicateur cross-asset `statistical` : mesure la SENSIBILITÉ du
 * marché courant aux mouvements de la référence (β > 1 amplifie, β < 1 amortit, β < 0
 * inverse) — le β d'une régression sans constante de r sur rRef.
 *
 * Rendements LOG (mêmes conventions que rollingCorrelation) :
 *   r[i]    = ln(close[i] / close[i-1])
 *   rRef[i] = ln(ref[i]   / ref[i-1])
 * Un rendement (par jambe) n'existe que si SES DEUX bornes sont finies et > 0 ; une PAIRE
 * de rendements n'est exploitable que si les DEUX jambes y sont définies. Un trou de
 * refClose invalide donc le rendement du trou (borne haute) ET du point suivant (borne
 * basse) — même discipline positionnelle que rollingCorrelation.
 *
 * Bêta sur la fenêtre POSITIONNELLE des `length` derniers slots de rendement :
 *   beta = cov(r, rRef) / var(rRef)
 * Covariance/variance de convention POPULATION (les facteurs N² se simplifient dans le
 * ratio, cohérent en interne avec la Pearson de T3) :
 *   beta = (L·Σxy − Σx·Σy) / (L·Σyy − Σy·Σy)      [x = r, y = rRef]
 * `undefined` si la fenêtre est incomplète, si un slot y manque (pas de fenêtre à trous),
 * ou si var(rRef) = 0 (référence plate) — évite le 0/0. Le dénominateur est TOUJOURS la
 * jambe de RÉFÉRENCE (y).
 *
 * Moteur PUR : aucun fetch. Lecture défensive de `ctx.aux.refClose` — référence absente
 * ⇒ `beta` undefined partout, le repère constant β = 1 reste tracé (ligne de niveau).
 */

import type { IndicatorDef } from "@axiom/types";

/** Borne un entier de paramètre dans [min, max], repli sur `def` si non fini. */
function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/**
 * Rendements log d'une série de prix, alignés sur les bougies.
 * out[i] = ln(v[i]/v[i-1]) si v[i] et v[i-1] sont finis et > 0 ; sinon undefined
 * (out[0] toujours undefined : pas de borne précédente).
 */
function rendementsLog(
  values: Array<number | undefined>,
  n: number
): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 1; i < n; i++) {
    const cur = values[i];
    const prev = values[i - 1];
    if (cur === undefined || prev === undefined) continue;
    if (!Number.isFinite(cur) || !Number.isFinite(prev)) continue;
    if (cur <= 0 || prev <= 0) continue;
    out[i] = Math.log(cur / prev);
  }
  return out;
}

export const betaRef: IndicatorDef = {
  id: "betaRef",
  name: "Bêta référence",
  category: "statistical",
  pane: "separate",
  aux: ["refClose"],
  precision: 2,
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 50, min: 10, max: 500 },
    {
      key: "source",
      name: "Source",
      type: "source",
      default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
  ],
  outputs: [
    { key: "beta", name: "Bêta", style: "line" },
    { key: "one", name: "1", style: "line" },
  ],

  calc(candles, params, ctx) {
    const n = candles.length;
    const length = clampInt(params.length, 50, 10, 500);

    const beta: Array<number | undefined> = new Array(n).fill(undefined);
    const ref = ctx.aux?.refClose;

    if (ref) {
      const rx = rendementsLog(ctx.source, n);
      const rRef = rendementsLog(ref, n);

      for (let i = length; i < n; i++) {
        // Fenêtre POSITIONNELLE : les slots [i-length+1 .. i]. Un seul slot dont
        // l'une des deux jambes manque invalide tout le point (pas de trou toléré).
        let sumX = 0;
        let sumY = 0;
        let sumYY = 0;
        let sumXY = 0;
        let complete = true;
        for (let j = i - length + 1; j <= i; j++) {
          const x = rx[j];
          const y = rRef[j];
          if (x === undefined || y === undefined) {
            complete = false;
            break;
          }
          sumX += x;
          sumY += y;
          sumYY += y * y;
          sumXY += x * y;
        }
        if (!complete) continue;

        // beta = cov(r, rRef) / var(rRef). Le dénominateur est la jambe de RÉFÉRENCE (y) :
        // denY = L·Σyy − Σy·Σy = N²·var(rRef) ≥ 0. Variance nulle (référence plate) ⇒
        // beta non défini (évite 0/0).
        const denY = length * sumYY - sumY * sumY;
        if (denY <= 0) continue;

        beta[i] = (length * sumXY - sumX * sumY) / denY;
      }
    }

    return {
      series: {
        beta,
        one: new Array<number>(n).fill(1),
      },
    };
  },
};
