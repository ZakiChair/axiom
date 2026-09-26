/**
 * @axiom/indicators — derivatives/stablecoinPrint.ts
 *
 * Impression de stablecoins — variation nette QUOTIDIENNE de l'offre agrégée (série auxiliaire
 * `stablecoins`, DefiLlama journalière, alignée par report sur les bougies). C'est un Δ de
 * stock net, pas une somme de mints/burns bruts : une émission et un rachat le même jour se
 * compensent. Une valeur reportée à l'identique n'est pas une nouvelle observation (jour non
 * encore publié, bougie intrajournalière) : aucune barre, jamais un 0 inventé.
 *
 * À chaque nouvelle observation, l'écart au précédent est ramené à un montant par jour (écart
 * de temps entre observations, au moins un jour) : en 1d le Δ du jour, en 1w la moyenne
 * quotidienne de la semaine, en intrajournalier une barre par jour publié (pas ×24).
 * Sorties : `emission` (≥ 0, --up), `contraction` (< 0, --down), `moyenne` des `lissage`
 * dernières observations, reportée jusqu'à la suivante.
 */
import type { IndicatorDef } from "@axiom/types";

const JOUR_MS = 86_400_000;

export const stablecoinPrint: IndicatorDef = {
  id: "stablecoinPrint",
  name: "Impression de stablecoins (Δ offre / jour)",
  category: "derivatives",
  pane: "separate",
  aux: ["stablecoins"],
  precision: 0,
  inputs: [{ key: "lissage", name: "Moyenne (observations)", type: "number", default: 7, min: 2, max: 90 }],
  outputs: [
    { key: "emission", name: "Émission nette", style: "histogram", color: "--up" },
    { key: "contraction", name: "Contraction nette", style: "histogram", color: "--down" },
    { key: "moyenne", name: "Moyenne", style: "line" },
  ],
  calc(candles, params, ctx) {
    const n = candles.length;
    const lissage = Math.max(2, Math.round(Number(params.lissage ?? 7)));
    const emission: Array<number | undefined> = new Array(n).fill(undefined);
    const contraction: Array<number | undefined> = new Array(n).fill(undefined);
    const moyenne: Array<number | undefined> = new Array(n).fill(undefined);
    const serie = ctx.aux?.stablecoins;
    if (!serie) return { series: { emission, contraction, moyenne } };
    const observes: number[] = [];
    let precedent: { v: number; t: number } | undefined;
    let courante: number | undefined;
    for (let i = 0; i < n; i++) {
      const v = serie[i];
      const t = candles[i]!.time;
      if (v !== undefined && Number.isFinite(v) && v !== precedent?.v) {
        if (precedent) {
          const parJour = (v - precedent.v) / Math.max(1, (t - precedent.t) / JOUR_MS);
          if (parJour >= 0) emission[i] = parJour;
          else contraction[i] = parJour;
          observes.push(parJour);
          if (observes.length > lissage) observes.shift();
          if (observes.length === lissage) courante = observes.reduce((s, x) => s + x, 0) / lissage;
        }
        precedent = { v, t };
      }
      moyenne[i] = courante;
    }
    return { series: { emission, contraction, moyenne } };
  },
};
