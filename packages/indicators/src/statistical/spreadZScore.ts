/**
 * @axiom/indicators — statistical/spreadZScore.ts
 *
 * Z-score roulant du SPREAD LOG (niveaux) entre le symbole courant et le symbole de
 * RÉFÉRENCE (série auxiliaire `refClose`, close du symbole de référence aligné LOCF sur
 * les bougies du chart). Troisième indicateur cross-asset `statistical` : mesure de
 * mean-reversion de l'écart de valorisation entre les deux marchés — un z extrême signale
 * un spread anormalement tendu (pair-trading).
 *
 * Spread en NIVEAUX (pas des rendements) :
 *   s[i] = ln(close[i]) − ln(ref[i])
 * Un point de spread existe DÈS QUE close[i] et ref[i] sont finis et > 0 — aucune
 * dépendance au point précédent. Un trou de refClose invalide donc UNIQUEMENT son propre
 * slot (contrairement aux rendements de corrélation/bêta qui invalident aussi le suivant).
 *
 * Z-score sur la fenêtre POSITIONNELLE des `length` derniers slots (convention priceZScore,
 * stdev POPULATION divise par N) :
 *   z[i] = (s[i] − moyenne(fenêtre)) / stdev_pop(fenêtre)
 * `undefined` si la fenêtre est incomplète (moins de `length` slots), si un slot y manque
 * (spread absent — pas de fenêtre à trous), ou si stdev = 0 (spread plat) — évite le 0/0.
 *
 * Le spread est ÉPINGLÉ sur `close` (pas d'input `source`) : `length` est le seul réglage.
 * Moteur PUR : aucun fetch. Lecture défensive de `ctx.aux.refClose` — référence absente
 * ⇒ `z` undefined partout, les bandes constantes +2 / −2 restent tracées (lignes de niveau).
 */

import type { IndicatorDef } from "@axiom/types";
import { clampInt } from "../utils";

/**
 * Spread log en niveaux, aligné sur les bougies.
 * out[i] = ln(close[i]) − ln(ref[i]) si close[i] et ref[i] sont finis et > 0 ; sinon
 * undefined (aucune dépendance au point précédent : slot indépendant).
 */
function spreadLog(
  closes: Array<number | undefined>,
  ref: Array<number | undefined>,
  n: number
): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 0; i < n; i++) {
    const c = closes[i];
    const r = ref[i];
    if (c === undefined || r === undefined) continue;
    if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
    if (c <= 0 || r <= 0) continue;
    out[i] = Math.log(c) - Math.log(r);
  }
  return out;
}

export const spreadZScore: IndicatorDef = {
  id: "spreadZScore",
  name: "Spread Z-Score",
  category: "statistical",
  pane: "separate",
  aux: ["refClose"],
  precision: 2,
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 100, min: 10, max: 500 },
  ],
  outputs: [
    { key: "z", name: "Z-Score", style: "line" },
    { key: "hi", name: "+2", style: "line" },
    { key: "lo", name: "-2", style: "line" },
  ],

  calc(candles, params, ctx) {
    const n = candles.length;
    const length = clampInt(params.length, 100, 10, 500);

    const z: Array<number | undefined> = new Array(n).fill(undefined);
    const ref = ctx.aux?.refClose;

    if (ref) {
      const s = spreadLog(ctx.source, ref, n);

      // Premier point plein à l'index length-1 : le spread est un NIVEAU, le slot 0 est
      // valide (pas de rendement à amorcer).
      for (let i = length - 1; i < n; i++) {
        // Fenêtre POSITIONNELLE : les slots [i-length+1 .. i]. Un seul slot sans spread
        // invalide tout le point (pas de trou toléré).
        let sum = 0;
        let sumSq = 0;
        let complete = true;
        for (let j = i - length + 1; j <= i; j++) {
          const v = s[j];
          if (v === undefined) {
            complete = false;
            break;
          }
          sum += v;
          sumSq += v * v;
        }
        if (!complete) continue;

        // Variance POPULATION : L²·var = L·Σx² − (Σx)² ≥ 0. stdev nulle (spread plat) ⇒
        // z non défini (évite 0/0). z = (s[i] − moyenne) / stdev = (L·s[i] − Σx) / √(...).
        const den = length * sumSq - sum * sum;
        if (den <= 0) continue;

        const cur = s[i]!;
        z[i] = (length * cur - sum) / Math.sqrt(den);
      }
    }

    return {
      series: {
        z,
        hi: new Array<number>(n).fill(2),
        lo: new Array<number>(n).fill(-2),
      },
    };
  },
};
