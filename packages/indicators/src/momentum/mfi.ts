/**
 * @axiom/indicators — momentum/mfi.ts
 *
 * MFI (Money Flow Index) — « RSI pondéré par le volume ».
 *
 * Source : formule canonique (Quong & Soudack, repris par TradingView / pandas-ta).
 *
 * Calcul :
 *   tp[i]   = (high + low + close) / 3            (prix typique = hlc3)
 *   rmf[i]  = tp[i] * volume[i]                   (raw money flow)
 *   sens    : tp[i] > tp[i-1] -> flux positif ; tp[i] < tp[i-1] -> flux négatif ;
 *             tp[i] == tp[i-1] -> ni l'un ni l'autre (les deux à 0).
 *   posMF   = somme roulante des rmf positifs sur `length`
 *   negMF   = somme roulante des rmf négatifs sur `length`
 *   ratio   = posMF / negMF
 *   MFI     = 100 - 100 / (1 + ratio)             (borné 0..100)
 *   Cas particulier : negMF == 0 -> MFI = 100 (aucun flux sortant sur la fenêtre).
 *
 * Alignement : la première valeur exige `length` variations de tp (donc
 * `length + 1` bougies). Les positions précédentes valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { rollingSum } from "../utils";

export const mfi: IndicatorDef = {
  id: "mfi",
  name: "MFI",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 14, min: 1 },
  ],
  outputs: [{ key: "mfi", name: "MFI", style: "line" }],

  calc(candles, params, ctx) {
    const length = Number(params.length);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    // Prix typique fourni par le contexte (hlc3) ; raw money flow = tp * volume.
    const tp = ctx.hlc3;

    // Flux positifs / négatifs alignés sur la bougie courante (index 0 = neutre).
    const posFlow: number[] = new Array(n).fill(0);
    const negFlow: number[] = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const cur = tp[i];
      const prev = tp[i - 1];
      const c = candles[i];
      if (cur === undefined || prev === undefined || c === undefined) continue;
      const rmf = cur * c.volume;
      if (cur > prev) posFlow[i] = rmf;
      else if (cur < prev) negFlow[i] = rmf;
      // égalité : aucun flux comptabilisé.
    }

    const posSum = rollingSum(posFlow, length);
    const negSum = rollingSum(negFlow, length);

    // La première fenêtre roulante pleine couvre les indices 0..length-1, mais
    // l'index 0 n'a pas de variation : on ne publie qu'à partir de l'index length.
    for (let i = length; i < n; i++) {
      const p = posSum[i];
      const neg = negSum[i];
      if (p === undefined || neg === undefined) continue;
      out[i] = neg === 0 ? 100 : 100 - 100 / (1 + p / neg);
    }

    return { series: { mfi: out } };
  },
};
