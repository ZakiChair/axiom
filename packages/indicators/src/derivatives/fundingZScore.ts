/**
 * @axiom/indicators — derivatives/fundingZScore.ts
 *
 * Funding Z-Score — écart du funding courant par rapport à sa moyenne récente,
 * normalisé par l'écart-type (détection de funding extrême).
 *
 * Formule :
 *   z[i] = (funding[i] - mean(fenêtre)) / stdev(fenêtre)
 * où la fenêtre est constituée des `window` derniers points DÉFINIS de
 * `ctx.aux.funding` en remontant depuis `i` (inclus). `undefined` tant que
 * moins de `window` points définis ne sont disponibles. Si l'écart-type de la
 * fenêtre est nul (valeurs constantes), z = 0 (évite 0/0 = NaN).
 *
 * Réutilise `stdev` de `utils.ts` (écart-type population, cf. sa doc) plutôt
 * que de recalculer la variance à la main.
 */

import type { IndicatorDef } from "@axiom/types";
import { stdev } from "../utils";

export const fundingZScore: IndicatorDef = {
  id: "fundingZScore",
  name: "Funding Z-Score",
  category: "derivatives",
  pane: "separate",
  aux: ["funding"],
  minTimeframe: "1h",
  inputs: [
    { key: "window", name: "Fenêtre", type: "number", default: 30, min: 5, max: 500 },
  ],
  outputs: [{ key: "fundingZScore", name: "Funding Z-Score", style: "line" }],
  calc(candles, params, ctx) {
    const n = candles.length;
    // Quantifie : sinon `win.length < window` (comparaison entier/fractionnaire)
    // collecte silencieusement un point de trop (ceil implicite au lieu du plus
    // proche) — variante "fenêtre fausse" du même bug, sans série vide.
    const window = Math.round(Number(params.window ?? 30));
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    const funding = ctx.aux?.funding;
    if (!funding || window <= 0) return { series: { fundingZScore: out } };

    for (let i = 0; i < n; i++) {
      const current = funding[i];
      if (current === undefined) continue;

      // Remonte depuis i pour collecter les `window` derniers points définis.
      const win: number[] = [];
      for (let j = i; j >= 0 && win.length < window; j--) {
        const v = funding[j];
        if (v !== undefined) win.unshift(v);
      }
      if (win.length < window) continue; // fenêtre incomplète

      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      const sd = stdev(win, win.length)[win.length - 1];
      if (sd === undefined) continue;
      out[i] = sd === 0 ? 0 : (current - mean) / sd;
    }

    return { series: { fundingZScore: out } };
  },
};
