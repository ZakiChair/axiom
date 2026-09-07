/**
 * @axiom/indicators — strategy/stratNetPositionFade.ts
 *
 * Stratégie « Fade positionnement foule » (non validé) :
 * Approche contrarienne exploitant les extrêmes de positionnement des comptes retail
 * (série aux `lsAccount`).
 *
 * Règle :
 *  - Long si la foule est lourdement vendeuse (Net Foule < -seuilNet %) ET que le prix repasse au-dessus de son EMA de confirmation.
 *  - Short si la foule est euphorique acheteuse (Net Foule > +seuilNet %) ET que le prix repasse sous son EMA.
 *  - Flat dès que le positionnement se normalise (|Net Foule| < 10%) ou que l'invalidation EMA intervient.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { closeOf, ema } from "../utils";

export const stratNetPositionFade = defStrategie({
  id: "stratNetPositionFade",
  name: "Fade positionnement foule (L/S)",
  validation: "non-valide",
  aux: ["lsAccount"],
  inputsStrategie: [
    { key: "seuilNet", name: "Seuil Net %", type: "number", default: 30, min: 10, max: 80 },
    { key: "emaLength", name: "EMA Confirmation", type: "number", default: 14, min: 2, max: 100 },
  ],
  position: (candles, params, ctx) => {
    const ls = ctx.aux?.lsAccount;
    const closes = closeOf(candles);
    const emaLength = Number(params.emaLength ?? 14);
    const seuilNet = Number(params.seuilNet ?? 30);
    const ma = ema(closes, emaLength);
    const n = candles.length;
    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);

    if (!ls) return out;

    let etat: EtatStrategie = 0;
    for (let i = 0; i < n; i++) {
      const r = ls[i];
      const m = ma[i];
      const c = closes[i];

      if (r === undefined || m === undefined || c === undefined || !Number.isFinite(r) || r <= 0) {
        out[i] = etat;
        continue;
      }

      const netPct = ((r - 1) / (r + 1)) * 100;

      if (netPct < -seuilNet && c > m) {
        etat = 1;
      } else if (netPct > seuilNet && c < m) {
        etat = -1;
      } else if (Math.abs(netPct) < 10) {
        etat = 0;
      }

      out[i] = etat;
    }

    return out;
  },
  libelles: (params) => ({
    long: `Foule Net Short < -${params.seuilNet}% et Close > EMA(${params.emaLength})`,
    short: `Foule Net Long > +${params.seuilNet}% et Close < EMA(${params.emaLength})`,
    sortie: `Normalisation du positionnement foule (|Net| < 10%)`,
  }),
});
