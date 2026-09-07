/** Part des variations quadratiques baissières/haussières, autour de zéro.
 * RS− = Σ log(Ci/Ci−1)² pour les rendements négatifs ; RS+ symétrique.
 * Part baissière = RS−/(RS−+RS+) ×100. Ce n'est pas une volatilité annualisée.
 * Fenêtre en BOUGIES, courante provisoire ; un rendement invalide invalide sa fenêtre.
 */
import type { IndicatorDef } from "@axiom/types";

export const downsideVariance: IndicatorDef = {
  id: "downsideVariance",
  name: "Part de variance baissière / haussière (%)",
  category: "volatility",
  pane: "separate",
  precision: 2,
  inputs: [{ key: "length", name: "Fenêtre (bougies)", type: "number", default: 30, min: 2, max: 1000 }],
  outputs: [
    { key: "down", name: "Baissière %", style: "line" },
    { key: "up", name: "Haussière %", style: "line" },
  ],
  calc(candles, params) {
    const length = Math.max(2, Math.min(1000, Math.floor(Number(params.length) || 30)));
    const down: Array<number | undefined> = new Array(candles.length).fill(undefined);
    const up: Array<number | undefined> = new Array(candles.length).fill(undefined);
    const returns: Array<number | undefined> = candles.map((c, i) => {
      const prev = candles[i - 1];
      if (!prev || !Number.isFinite(c.close) || !Number.isFinite(prev.close) || c.close <= 0 || prev.close <= 0 || c.time <= prev.time) return undefined;
      return Math.log(c.close / prev.close);
    });
    for (let i = length; i < candles.length; i++) {
      let negative = 0;
      let positive = 0;
      let valid = true;
      for (let j = i - length + 1; j <= i; j++) {
        const r = returns[j];
        if (r === undefined || !Number.isFinite(r)) { valid = false; break; }
        if (r < 0) negative += r * r;
        else positive += r * r;
      }
      const total = negative + positive;
      if (valid && total > 0 && Number.isFinite(total)) {
        down[i] = 100 * negative / total;
        up[i] = 100 * positive / total;
      }
    }
    const last = candles.length - 1;
    return {
      series: { down, up },
      ...(last < 0 ? {} : { annotations: { labels: [{
        idx: last, valeur: down[last] ?? 0, cible: "pane" as const, couleur: "--text-dim",
        texte: down[last] === undefined ? "Historique invalide / insuffisant ou sans variation" : `${length} bougies · courante provisoire`,
        info: `Sommes des log-rendements au carré autour de zéro sur ${length} bougies. Pas d'annualisation ; haussière + baissière = 100 % quand la variation est non nulle.`,
      }] } }),
    };
  },
};
