/**
 * @axiom/indicators — derivatives/nupl.ts
 *
 * NUPL (Net Unrealized Profit/Loss) — (market cap − realized cap) / market cap :
 * part du réseau en profit/perte latent. Zones de cycle usuelles :
 *   < 0        capitulation ;  0–0.25 espoir/peur ;  0.25–0.5 optimisme/anxiété ;
 *   0.5–0.75   croyance/déni ; > 0.75 euphorie/avidité (sommets historiques).
 *
 * Série aux `nupl` (bitcoin-data.com / BGeometrics, journalier, BTC uniquement,
 * gratuit). Recopie directe : le moteur reste pur (aucun fetch), lecture défensive.
 */

import type { IndicatorDef } from "@axiom/types";

export const nupl: IndicatorDef = {
  id: "nupl",
  name: "NUPL (Net Unrealized P/L)",
  category: "derivatives",
  pane: "separate",
  aux: ["nupl"],
  minTimeframe: "1d",
  precision: 3,
  inputs: [],
  outputs: [{ key: "nupl", name: "NUPL", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.nupl;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) {
      for (let i = 0; i < n; i++) out[i] = series[i];
    }
    return { series: { nupl: out } };
  },
};
