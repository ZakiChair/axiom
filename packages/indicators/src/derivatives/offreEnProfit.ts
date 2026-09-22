/**
 * @axiom/indicators — derivatives/offreEnProfit.ts
 *
 * Offre en profit (%) — part de l'offre BTC dont le prix de réalisation est sous
 * le cours : `pct = 100 × supplyProfit / (supplyProfit + supplyLoss)`. Les deux
 * séries (BGeometrics, BTC — définitions partagées avec le panneau CHAIN) sont en
 * BTC ; undefined si la somme est ≤ 0 ou qu'une jambe manque (jamais de 0 faux).
 */
import type { IndicatorDef } from "@axiom/types";

export const offreEnProfit: IndicatorDef = {
  id: "offreEnProfit",
  name: "Offre en profit (%)",
  category: "derivatives",
  pane: "separate",
  aux: ["supplyProfit", "supplyLoss"],
  minTimeframe: "1d",
  precision: 1,
  inputs: [],
  outputs: [{ key: "pct", name: "Offre en profit %", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const sp = ctx.aux?.supplyProfit;
    const sl = ctx.aux?.supplyLoss;
    if (sp && sl) {
      for (let i = 0; i < n; i++) {
        const p = sp[i];
        const l = sl[i];
        if (p === undefined || l === undefined) continue;
        const total = p + l;
        if (!Number.isFinite(total) || total <= 0) continue;
        out[i] = (100 * p) / total;
      }
    }
    return { series: { pct: out } };
  },
};
