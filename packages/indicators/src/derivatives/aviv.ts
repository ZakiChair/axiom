/**
 * @axiom/indicators — derivatives/aviv.ts
 *
 * AVIV — ratio « valuation active » : capitalisation de marché rapportée au coût
 * de base des pièces ACTIVES (hors pièces perdues/dormantes) — thermomètre de cycle
 * comparable au MVRV mais nettoyé de l'offre inerte. Série aux `aviv`
 * (BGeometrics, journalier, BTC — embargo J-7 de l'offre gratuite).
 */
import type { IndicatorDef } from "@axiom/types";

export const aviv: IndicatorDef = {
  id: "aviv",
  name: "AVIV",
  category: "derivatives",
  pane: "separate",
  aux: ["aviv"],
  minTimeframe: "1d",
  precision: 2,
  inputs: [],
  outputs: [{ key: "aviv", name: "AVIV", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const serie = ctx.aux?.aviv;
    if (serie) {
      for (let i = 0; i < n; i++) {
        const v = serie[i];
        if (v !== undefined && Number.isFinite(v)) out[i] = v;
      }
    }
    return { series: { aviv: out } };
  },
};
