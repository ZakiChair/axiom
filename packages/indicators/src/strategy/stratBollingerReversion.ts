/**
 * @axiom/indicators — strategy/stratBollingerReversion.ts
 *
 * Stratégie mean-reversion Bollinger (long/short) : entrée long quand le close
 * RE-franchit la bande basse à la hausse (close[i−1] < bandeBasse[i−1] ET
 * close[i] ≥ bandeBasse[i] — le retour DANS les bandes, pas l'excursion) ;
 * short miroir sur la bande haute ; sortie au retour sur la moyenne (SMA) :
 * long sort quand close ≥ SMA, short sort quand close ≤ SMA. En position, la
 * sortie est évaluée AVANT toute nouvelle entrée. Rendu par defStrategie.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { sma, stdev } from "../utils";

export const stratBollingerReversion = defStrategie({
  id: "stratBollingerReversion",
  name: "Stratégie Bollinger réversion",
  inputsStrategie: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 2 },
    { key: "mult", name: "Multiplicateur σ", type: "number", default: 2, min: 0.1 },
  ],
  position: (_candles, params, ctx) => {
    const length = Number(params.length ?? 20);
    const mult = Number(params.mult ?? 2);
    const src = ctx.source;
    const m = sma(src, length);
    const sd = stdev(src, length);
    const n = src.length;
    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
    let etat: EtatStrategie = 0;
    for (let i = 0; i < n; i++) {
      const moy = m[i];
      const s = sd[i];
      const c = src[i];
      if (moy === undefined || s === undefined || c === undefined) continue;
      const bas = moy - mult * s;
      const haut = moy + mult * s;
      const cPrev = src[i - 1];
      const mPrev = m[i - 1];
      const sPrev = sd[i - 1];
      if (etat === 1 && c >= moy) etat = 0;
      else if (etat === -1 && c <= moy) etat = 0;
      else if (etat === 0 && cPrev !== undefined && mPrev !== undefined && sPrev !== undefined) {
        if (cPrev < mPrev - mult * sPrev && c >= bas) etat = 1;
        else if (cPrev > mPrev + mult * sPrev && c <= haut) etat = -1;
      }
      out[i] = etat;
    }
    return out;
  },
  libelles: (params) => ({
    long: `retour au-dessus de la bande basse (${params.length}, ${params.mult}σ)`,
    short: `retour sous la bande haute (${params.length}, ${params.mult}σ)`,
    sortie: "retour à la moyenne",
  }),
});
