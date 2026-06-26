/**
 * Fournisseur MACRO — supply AGRÉGÉE des stablecoins (DefiLlama, gratuit).
 *
 * Endpoint (gratuit, SANS clé, sans limite pour un usage normal) :
 *   GET https://stablecoins.llama.fi/stablecoincharts/all
 *   Doc : https://api-docs.defillama.com/  (section « stablecoins »)
 *
 *   Réponse : tableau de points JOURNALIERS de la forme
 *     {
 *       date: "<secondes epoch>",                         // chaîne
 *       totalCirculating:    { peggedUSD, peggedEUR, ... },
 *       totalCirculatingUSD: { peggedUSD, peggedEUR, ... }, // déjà converti en USD
 *       totalUnreleased?:    { ... }
 *     }
 *
 *   Supply agrégée (USD) = SOMME des valeurs de `totalCirculatingUSD` sur tous les
 *   types de peg → couvre USDT + USDC + DAI + (pegs EUR/autres convertis en USD).
 *   On utilise `totalCirculatingUSD` (et non `totalCirculating`) pour que les pegs
 *   non-USD soient ramenés en dollars et donc additionnables.
 *
 * Variante par chaîne (non utilisée ici) : GET /stablecoincharts/{chain} (ex. "Ethereum").
 * UNITÉ de `value` : USD absolu (ex. ~1.6e11).
 */
import type { IMacroProvider, MacroFetchOptions, MacroPoint, MacroSeries } from "./types";

const CHARTS_ALL_URL = "https://stablecoins.llama.fi/stablecoincharts/all";

/** Point brut renvoyé par /stablecoincharts/all (champs utiles uniquement). */
interface StablecoinChartPoint {
  date: string; // secondes epoch (chaîne)
  totalCirculatingUSD: Record<string, number>; // clé = type de peg (peggedUSD, ...)
}

/** Somme des supplies par type de peg (valeurs déjà converties en USD par DefiLlama). */
function sumPeggedUsd(byPeg: Record<string, number>): number {
  let sum = 0;
  for (const v of Object.values(byPeg)) {
    // Garde-fou : ignore tout champ non numérique/non fini (donnée malformée).
    if (typeof v === "number" && Number.isFinite(v)) sum += v;
  }
  return sum;
}

/** Supply agrégée de l'ensemble des stablecoins suivis par DefiLlama. */
export const stablecoinsSupplyProvider: IMacroProvider = {
  id: "defillama-stablecoins",

  async fetchSeries(opts?: MacroFetchOptions): Promise<MacroSeries> {
    const res = await fetch(CHARTS_ALL_URL, { signal: opts?.signal });
    if (!res.ok) {
      throw new Error(`DefiLlama stablecoincharts ${res.status} ${res.statusText}`);
    }
    const raw = (await res.json()) as StablecoinChartPoint[];

    const series: MacroSeries = [];
    for (const p of raw) {
      const time = Number(p.date) * 1000;
      if (!Number.isFinite(time)) continue;
      if (opts?.start !== undefined && time < opts.start) continue;
      if (opts?.end !== undefined && time > opts.end) continue;
      const point: MacroPoint = { time, value: sumPeggedUsd(p.totalCirculatingUSD) };
      series.push(point);
    }
    return series;
  },
};
