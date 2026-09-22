/**
 * @axiom/indicators — derivatives/vddMultiple.ts
 *
 * VDD Multiple — multiple des « Value Days Destroyed » ajusté de la tendance
 * annuelle : mesure la vélocité de destruction de jours de détention (les vieilles
 * pièces qui bougent pèsent davantage). Zone haute historique ≈ distribution de
 * sommet de cycle. Série aux `vddMultiple` (BGeometrics, journalier, BTC — recopie).
 */
import type { IndicatorDef } from "@axiom/types";

export const vddMultiple: IndicatorDef = {
  id: "vddMultiple",
  name: "VDD Multiple",
  category: "derivatives",
  pane: "separate",
  aux: ["vddMultiple"],
  minTimeframe: "1d",
  precision: 2,
  inputs: [],
  outputs: [{ key: "vdd", name: "VDD Multiple", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const serie = ctx.aux?.vddMultiple;
    if (serie) {
      for (let i = 0; i < n; i++) {
        const v = serie[i];
        if (v !== undefined && Number.isFinite(v)) out[i] = v;
      }
    }
    return { series: { vdd: out } };
  },
};
