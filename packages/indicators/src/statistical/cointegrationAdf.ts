/**
 * @axiom/indicators — statistical/cointegrationAdf.ts
 *
 * Statistique d'Engle-Granger (t de l'ADF augmenté sur le résidu) entre le symbole
 * courant et le symbole de RÉFÉRENCE (série auxiliaire `refClose`, close de la
 * référence aligné LOCF sur les bougies du chart). Quatrième indicateur cross-asset
 * `statistical` : spreadZScore mesure l'ÉCART courant, celui-ci teste si l'écart
 * REVIENT — un z extrême sur un spread non cointégré est un piège, pas un signal.
 *
 * Noyau partagé (régression + ADF + conventions) : utils-cointegration.ts.
 *
 * Lecture : t < −3,34 (repère tracé, valeur critique d'Engle-Granger à 5 % pour
 * N=2 avec constante — approximation de MacKinnon, PAS un test exact) ⇒ on ne
 * rejette pas l'hypothèse de non-cointégration... plus exactement : t plus négatif
 * que la valeur critique ⇒ le résidu est stationnaire au seuil considéré. Un t
 * proche de 0 = spread en marche aléatoire, quel que soit son z.
 *
 * Le repère −3,34 est une LIGNE DE NIVEAU constante, comme les bandes ±2 de
 * spreadZScore ; il reste tracé même sans référence (aucun pane muet).
 *
 * Moteur PUR : aucun fetch. Référence absente ⇒ `t` undefined partout.
 */

import type { IndicatorDef } from "@axiom/types";
import { clampInt } from "../utils";
import { engleGranger } from "../utils-cointegration";

/** Valeur critique d'Engle-Granger à 5 % (N=2, constante) — approximation de MacKinnon. */
export const SEUIL_EG_5PCT = -3.34;

export const cointegrationAdf: IndicatorDef = {
  id: "cointegrationAdf",
  name: "Cointégration (Engle-Granger)",
  category: "statistical",
  pane: "separate",
  aux: ["refClose"],
  precision: 2,
  inputs: [
    { key: "length", name: "Fenêtre", type: "number", default: 120, min: 30, max: 500 },
    { key: "lags", name: "Retards ADF", type: "number", default: 1, min: 0, max: 5 },
  ],
  outputs: [
    { key: "t", name: "t (Engle-Granger)", style: "line" },
    { key: "seuil", name: "−3,34 (5 %)", style: "line" },
  ],

  calc(candles, params, ctx) {
    const n = candles.length;
    const length = clampInt(params.length, 120, 30, 500);
    const lags = clampInt(params.lags, 1, 0, 5);

    const t: Array<number | undefined> = new Array(n).fill(undefined);
    const ref = ctx.aux?.refClose;
    if (ref) {
      const closes = candles.map((c) => c.close);
      for (let i = length - 1; i < n; i++) {
        const r = engleGranger(closes, ref, i, length, lags);
        if (r === null || r.t === null) continue;
        t[i] = r.t;
      }
    }

    return {
      series: {
        t,
        seuil: new Array<number>(n).fill(SEUIL_EG_5PCT),
      },
    };
  },
};
