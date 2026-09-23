/** Corrélation des rendements log durant les baisses de la référence stricte. */
import type { IndicatorDef } from "@axiom/types";
import { clampInt } from "../utils";
import { calculerMomentsBaissiers } from "./downsideMoments";

export const downsideCorrelation: IndicatorDef = {
  id: "downsideCorrelation",
  name: "Corrélation baissière référence",
  category: "statistical",
  pane: "separate",
  aux: ["refCloseStrict"],
  precision: 2,
  inputs: [
    { key: "length", name: "Fenêtre", type: "number", default: 100, min: 20, max: 500 },
    { key: "minDown", name: "Baisses minimum", type: "number", default: 20, min: 3, max: 500 },
  ],
  outputs: [
    { key: "corr", name: "Corrélation", style: "line" },
    { key: "hi", name: "+1", style: "line" },
    { key: "mid", name: "0", style: "line" },
    { key: "lo", name: "−1", style: "line" },
  ],
  calc(candles, params, ctx) {
    const length = clampInt(params.length, 100, 20, 500);
    const minDown = clampInt(params.minDown, 20, 3, length);
    const evals = calculerMomentsBaissiers(candles.map((c) => c.close), ctx.aux?.refCloseStrict ?? [], length, minDown);
    const corr = evals.map((v) => v?.correlation);
    const dernier = evals.at(-1);
    const idx = candles.length - 1;
    return {
      series: {
        corr,
        hi: Array(candles.length).fill(1) as number[],
        mid: Array(candles.length).fill(0) as number[],
        lo: Array(candles.length).fill(-1) as number[],
      },
      annotations: dernier && idx >= 0 ? { labels: [{
        idx, valeur: dernier.correlation ?? 0, texte: `${dernier.count} baisses`,
        couleur: "--text-dim", cible: "pane" as const,
        info: `Rendements de référence négatifs parmi ${length} emplacements complets`,
      }] } : undefined,
    };
  },
};
