/**
 * @axiom/indicators — momentum/rsiDivergence.ts
 *
 * Divergences RSI ↔ prix, rendues en POINTS overlay (régulières + cachées).
 * L'oscillateur est le RSI de Wilder (`rsiOf`) calculé sur la source configurée ;
 * les pivots prix sont pris sur les hauts (famille baissière) et les bas (famille
 * haussière) des bougies. La détection, l'appariement ±3 barres et les inégalités
 * strictes sont délégués à `detecterDivergences` (Task 2) via `placerPointsDivergence`.
 *
 * Chaque point est posé au `idxTo` de la divergence et porte le prix à cet index
 * (low pour les haussières, high pour les baissières) → il se pose visuellement sur
 * le creux/sommet confirmé. `undefined` ailleurs : aucun tracé.
 *
 * Rendu : les 4 sorties sont en `style: "points"` (marqueurs circulaires côté app).
 * Le format « points » n'expose pas de rayon → les divergences cachées ne sont pas
 * tracées plus petites que les régulières ; elles se distinguent par leur libellé
 * de série (décision consignée, cf. brief Step 2).
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf } from "../utils";
import { placerPointsDivergence } from "../utils-divergence-points";
import { rsiOf } from "./rsi";

export const rsiDivergence: IndicatorDef = {
  id: "rsiDivergence",
  name: "RSI Divergence",
  category: "momentum",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Longueur RSI", type: "number", default: 14, min: 1 },
    {
      key: "source",
      name: "Source",
      type: "source",
      default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
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
  calc(candles, params, ctx) {
    const length = Number(params.length ?? 14);
    const opts = {
      gauche: Number(params.gauche ?? 5),
      droite: Number(params.droite ?? 5),
      maxEcart: Number(params.maxEcart ?? 60),
    };
    const osc = rsiOf(ctx.source, length);
    const series = placerPointsDivergence(highOf(candles), lowOf(candles), osc, opts);
    return { series };
  },
};
