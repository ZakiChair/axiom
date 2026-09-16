/**
 * @axiom/indicators — statistical/spreadHalfLife.ts
 *
 * Demi-vie de retour à la moyenne du spread log entre le symbole courant et le
 * symbole de RÉFÉRENCE (série auxiliaire `refClose`), en BARRES — issue de la même
 * régression d'Engle-Granger que cointegrationAdf (noyau partagé
 * utils-cointegration.ts).
 *
 *   e = résidu de ln(close) = α + β·ln(ref) + e
 *   φ = coefficient de e_{t−1} dans l'ADF augmenté
 *   demi-vie = −ln 2 / ln(1 + φ)
 *
 * Lecture : « combien de barres pour résorber la moitié d'un écart ». 5 barres =
 * spread rapide ; 200 barres = écart qui ne se referme pas dans l'horizon de
 * trading — la demi-vie remplace ici le z-score comme filtre de patience.
 *
 * `beta` (second output) est le RATIO DE COUVERTURE de la régression : combien
 * d'unités de la référence pour une unité du symbole courant. Il sert à lire
 * l'ordre de grandeur du hedge, pas à dimensionner une position (le dimensionnement
 * vit dans PORT/BT).
 *
 * `hl` est undefined si φ ≥ 0 (aucun retour), φ ≤ −1 (oscillation explosive) ou si
 * la fenêtre est inexploitable (trou, référence plate, trop courte pour l'ADF).
 * Le pane reste vide sans référence : rien à tracer d'honnête.
 */

import type { IndicatorDef } from "@axiom/types";
import { clampInt } from "../utils";
import { engleGranger } from "../utils-cointegration";

export const spreadHalfLife: IndicatorDef = {
  id: "spreadHalfLife",
  name: "Demi-vie du spread",
  category: "statistical",
  pane: "separate",
  aux: ["refClose"],
  precision: 1,
  inputs: [
    { key: "length", name: "Fenêtre", type: "number", default: 120, min: 30, max: 500 },
    { key: "lags", name: "Retards ADF", type: "number", default: 1, min: 0, max: 5 },
  ],
  outputs: [
    { key: "hl", name: "Demi-vie (barres)", style: "line" },
    { key: "beta", name: "β (couverture)", style: "line" },
  ],

  calc(candles, params, ctx) {
    const n = candles.length;
    const length = clampInt(params.length, 120, 30, 500);
    const lags = clampInt(params.lags, 1, 0, 5);

    const hl: Array<number | undefined> = new Array(n).fill(undefined);
    const beta: Array<number | undefined> = new Array(n).fill(undefined);
    const ref = ctx.aux?.refClose;
    if (ref) {
      const closes = candles.map((c) => c.close);
      for (let i = length - 1; i < n; i++) {
        const r = engleGranger(closes, ref, i, length, lags);
        if (r === null) continue;
        beta[i] = r.beta;
        if (r.halfLife !== null) hl[i] = r.halfLife;
      }
    }

    return { series: { hl, beta } };
  },
};
