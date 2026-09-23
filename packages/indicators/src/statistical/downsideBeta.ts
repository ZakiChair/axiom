/** Bêta centré des rendements log durant les baisses de la référence stricte. */
import type { IndicatorDef } from "@axiom/types";
import { clampInt } from "../utils";
import { calculerMomentsBaissiers } from "./downsideMoments";

export const downsideBeta: IndicatorDef = {
  id: "downsideBeta",
  name: "Bêta baissier référence",
  category: "statistical",
  pane: "separate",
  aux: ["refCloseStrict"],
  precision: 2,
  inputs: [
    { key: "length", name: "Fenêtre", type: "number", default: 100, min: 20, max: 500 },
    { key: "minDown", name: "Baisses minimum", type: "number", default: 20, min: 3, max: 500 },
  ],
  outputs: [
    { key: "beta", name: "Bêta", style: "line" },
    { key: "one", name: "1", style: "line" },
  ],
  calc(candles, params, ctx) {
    const length = clampInt(params.length, 100, 20, 500);
    const minDown = clampInt(params.minDown, 20, 3, length);
    const evals = calculerMomentsBaissiers(candles.map((c) => c.close), ctx.aux?.refCloseStrict ?? [], length, minDown);
    const beta = evals.map((v) => v?.beta);
    const dernier = evals.at(-1);
    const idx = candles.length - 1;
    return {
      series: { beta, one: Array(candles.length).fill(1) as number[] },
      annotations: dernier && idx >= 0 ? { labels: [{
        idx, valeur: dernier.beta ?? 0, texte: `${dernier.count} baisses`,
        couleur: "--text-dim", cible: "pane" as const,
        info: `Rendements de référence négatifs parmi ${length} emplacements complets`,
      }] } : undefined,
    };
  },
};
