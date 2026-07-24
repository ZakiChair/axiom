/**
 * @axiom/indicators — orderflow/cvdDivergence.ts
 *
 * Divergences CVD ↔ prix, rendues en POINTS overlay (régulières + cachées).
 * L'oscillateur est le CVD cumulé (`cvdOf`) — la lecture d'orderflow la plus utile
 * en divergence : le prix pousse un nouvel extrême que le flux agresseur ne suit pas.
 * Pivots prix sur les hauts (famille baissière) et les bas (famille haussière) ;
 * détection déléguée à `placerPointsDivergence` (via `detecterDivergences`, Task 2).
 *
 * Dégradation propre : une source SANS champs taker buy/sell (ex. actions
 * TwelveData) donne un CVD plat à 0 → aucun pivot fractal strict → aucune
 * divergence → aucun point, sans erreur.
 *
 * Rendu : 4 sorties `style: "points"`. Le format « points » n'a pas de rayon → les
 * divergences cachées ne sont pas plus petites que les régulières ; elles se
 * distinguent par leur libellé de série (décision consignée, cf. brief Step 2).
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf } from "../utils";
import { placerPointsDivergence } from "../utils-divergence-points";
import { cvdOf } from "./cvd";

export const cvdDivergence: IndicatorDef = {
  id: "cvdDivergence",
  name: "CVD Divergence",
  category: "orderflow",
  pane: "overlay",
  inputs: [
    { key: "gauche", name: "Pivot gauche", type: "number", default: 5, min: 1 },
    { key: "droite", name: "Pivot droite", type: "number", default: 5, min: 1 },
    { key: "maxEcart", name: "Écart max (barres)", type: "number", default: 60, min: 1 },
  ],
  outputs: [
    { key: "divHauss", name: "Div. haussière", style: "points", color: "var(--up)" },
    { key: "divBaiss", name: "Div. baissière", style: "points", color: "var(--down)" },
    { key: "divHaussCachee", name: "Div. haussière cachée", style: "points", color: "var(--up)" },
    { key: "divBaissCachee", name: "Div. baissière cachée", style: "points", color: "var(--down)" },
  ],
  calc(candles, params) {
    const opts = {
      gauche: Number(params.gauche ?? 5),
      droite: Number(params.droite ?? 5),
      maxEcart: Number(params.maxEcart ?? 60),
    };
    const osc = cvdOf(candles);
    const series = placerPointsDivergence(highOf(candles), lowOf(candles), osc, opts);
    return { series };
  },
};
