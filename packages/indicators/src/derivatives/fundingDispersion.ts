/** Dispersion APR d'une cohorte FIXE Binance, Bybit, OKX, Hyperliquid. */
import type { IndicatorDef } from "@axiom/types";

const APR_PAR_FRACTION_HORAIRE = 24 * 365 * 100;

export interface DispersionFunding {
  sigma: number | undefined;
  min: number | undefined;
  max: number | undefined;
  knownCount: number;
}

/** Entrée en fractions horaires ; aucune réduction dynamique de la cohorte. */
export function calculerDispersionFunding(
  taux: readonly [number | undefined, number | undefined, number | undefined, number | undefined],
): DispersionFunding {
  const aprs = taux.map((v) => {
    if (v === undefined || !Number.isFinite(v)) return undefined;
    const apr = v * APR_PAR_FRACTION_HORAIRE;
    return Number.isFinite(apr) ? apr : undefined;
  });
  const connus = aprs.filter((v): v is number => v !== undefined);
  const knownCount = connus.length;
  if (knownCount !== 4) return { sigma: undefined, min: undefined, max: undefined, knownCount };
  const amplitude = Math.max(...connus.map(Math.abs));
  const reduits = amplitude === 0 ? connus : connus.map((v) => v / amplitude);
  const moyenne = reduits.reduce((a, b) => a + b, 0) / 4;
  const variance = reduits.reduce((s, v) => s + (v - moyenne) ** 2, 0) / 4;
  const sigma = Math.sqrt(variance) * amplitude;
  return { sigma: Number.isFinite(sigma) ? sigma : undefined, min: Math.min(...connus), max: Math.max(...connus), knownCount };
}

export const fundingDispersion: IndicatorDef = {
  id: "fundingDispersion",
  name: "Dispersion du funding — points d'APR",
  category: "derivatives",
  pane: "separate",
  aux: ["fundingHistBinance", "fundingHistBybit", "fundingHistOkx", "fundingHistHl"],
  precision: 2,
  inputs: [],
  outputs: [
    { key: "sigma", name: "Écart-type APR", style: "line" },
    { key: "min", name: "APR min", style: "line" },
    { key: "max", name: "APR max", style: "line" },
  ],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const sigma: Array<number | undefined> = Array(n).fill(undefined);
    const min: Array<number | undefined> = Array(n).fill(undefined);
    const max: Array<number | undefined> = Array(n).fill(undefined);
    let dernierCompte: { idx: number; count: number } | undefined;
    for (let i = 0; i < n; i++) {
      const r = calculerDispersionFunding([
        ctx.aux?.fundingHistBinance?.[i], ctx.aux?.fundingHistBybit?.[i],
        ctx.aux?.fundingHistOkx?.[i], ctx.aux?.fundingHistHl?.[i],
      ]);
      sigma[i] = r.sigma;
      min[i] = r.min;
      max[i] = r.max;
      dernierCompte = { idx: i, count: r.knownCount };
    }
    const annotations = dernierCompte ? { labels: [{
      idx: dernierCompte.idx, valeur: 0, ancrageY: "haut-pane" as const,
      texte: `${dernierCompte.count}/4 venues`, couleur: "--text-dim", cible: "pane" as const,
      info: "Nombre de venues avec funding historique valide à cet instant",
    }] } : undefined;
    return { series: { sigma, min, max }, annotations };
  },
};
