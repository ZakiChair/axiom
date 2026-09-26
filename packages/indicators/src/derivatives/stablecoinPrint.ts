/**
 * @axiom/indicators — derivatives/stablecoinPrint.ts
 *
 * Impression de stablecoins (nom demandé par le propriétaire) — variation nette QUOTIDIENNE du
 * stock circulant de stablecoins valorisé en USD (série auxiliaire `stablecoins`, DefiLlama,
 * tous ancrages convertis en USD). Ce n'est PAS une mesure des mint/burn : la variation inclut
 * les effets de change des stablecoins non USD et les changements de couverture de DefiLlama
 * (un stablecoin nouvellement suivi fait une barre sans aucune émission).
 *
 * Unité 1d SEULEMENT (`minTimeframe` + `supportsIndicatorTimeframe`) : la bougie D lit le point
 * daté D, qui porte la dernière valeur du jour D. En intrajournalier il serait lu dès 00:00
 * (anticipation) ; en 1w, la bougie du lundi lirait la semaine précédente.
 * Une valeur reportée à l'identique (jour non publié) n'est pas une observation : aucune barre,
 * jamais un 0 inventé ; l'écart suivant est ramené par jour. La bougie non clôturée (jour en
 * cours, point encore réécrit par DefiLlama) va dans `partiel` et reste hors de la moyenne.
 */
import type { IndicatorDef } from "@axiom/types";

const JOUR_MS = 86_400_000;

export const stablecoinPrint: IndicatorDef = {
  id: "stablecoinPrint",
  name: "Impression de stablecoins (Δ offre / jour)",
  category: "derivatives",
  pane: "separate",
  aux: ["stablecoins"],
  minTimeframe: "1d",
  precision: 0,
  // La série auxiliaire couvre 90 jours : au-delà de 60 observations la moyenne serait presque vide.
  inputs: [{ key: "lissage", name: "Moyenne (jours)", type: "number", default: 7, min: 2, max: 60 }],
  outputs: [
    { key: "hausse", name: "Hausse nette de l'offre", style: "histogram", color: "--up" },
    { key: "baisse", name: "Baisse nette de l'offre", style: "histogram", color: "--down" },
    { key: "partiel", name: "Jour en cours (partiel)", style: "histogram", color: "--text-dim" },
    { key: "moyenne", name: "Moyenne des jours clos", style: "line" },
  ],
  calc(candles, params, ctx) {
    const n = candles.length;
    const lissage = Math.min(60, Math.max(2, Math.round(Number(params.lissage ?? 7))));
    const vide = (): Array<number | undefined> => new Array(n).fill(undefined);
    const hausse = vide(), baisse = vide(), partiel = vide(), moyenne = vide();
    const serie = ctx.aux?.stablecoins;
    if (!serie) return { series: { hausse, baisse, partiel, moyenne } };
    const observes: number[] = [];
    let precedent: { v: number; t: number } | undefined;
    let courante: number | undefined;
    for (let i = 0; i < n; i++) {
      const v = serie[i];
      const t = candles[i]!.time;
      if (v !== undefined && Number.isFinite(v) && v !== precedent?.v) {
        if (precedent) {
          const parJour = (v - precedent.v) / Math.max(1, (t - precedent.t) / JOUR_MS);
          if (candles[i]!.closed === false) partiel[i] = parJour;
          else {
            (parJour >= 0 ? hausse : baisse)[i] = parJour;
            observes.push(parJour);
            if (observes.length > lissage) observes.shift();
            if (observes.length === lissage) courante = observes.reduce((s, x) => s + x, 0) / lissage;
          }
        }
        precedent = { v, t };
      }
      moyenne[i] = courante;
    }
    return { series: { hausse, baisse, partiel, moyenne } };
  },
};
