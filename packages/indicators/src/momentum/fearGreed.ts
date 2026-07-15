/**
 * @axiom/indicators — momentum/fearGreed.ts
 *
 * Fear & Greed Index (Alternative.me) — sentiment GLOBAL du marché crypto sur 0-100 :
 *   0-25  peur extrême (souvent des creux d'achat contrarien) ;
 *   25-45 peur ; 45-55 neutre ; 55-75 avidité ; 75-100 avidité extrême (sommets à risque).
 * Contrarien par nature (« acheter quand les autres ont peur »).
 *
 * Série aux `fearGreed` (journalier, gratuit, GLOBAL — identique quel que soit le
 * symbole affiché). Recopie directe : moteur pur, lecture défensive de ctx.aux.
 */

import type { IndicatorDef } from "@axiom/types";

export const fearGreed: IndicatorDef = {
  id: "fearGreed",
  name: "Fear & Greed Index",
  category: "momentum",
  pane: "separate",
  aux: ["fearGreed"],
  minTimeframe: "1d",
  precision: 0,
  inputs: [],
  outputs: [{ key: "fearGreed", name: "Fear & Greed", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.fearGreed;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) for (let i = 0; i < n; i++) out[i] = series[i];
    return { series: { fearGreed: out } };
  },
};
