/**
 * @axiom/indicators — strategy/stratDonchian.ts
 *
 * Stratégie breakout de canal Donchian (long/short) : long à la cassure du
 * plus-haut des `canal` bougies PRÉCÉDENTES (courante exclue), short à la
 * cassure du plus-bas ; entre les deux, la position est CONSERVÉE (stateful).
 * Premier état = flat une fois le canal défini. Rendu par defStrategie.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { closeOf, highOf, lowOf, rollingHighest, rollingLowest } from "../utils";

export const stratDonchian = defStrategie({
  id: "stratDonchian",
  name: "Stratégie Donchian",
  inputsStrategie: [{ key: "canal", name: "Canal (bougies)", type: "number", default: 20, min: 2 }],
  position: (candles, params) => {
    const canal = Number(params.canal ?? 20);
    const hh = rollingHighest(highOf(candles), canal);
    const ll = rollingLowest(lowOf(candles), canal);
    const closes = closeOf(candles);
    const n = candles.length;
    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
    let etat: EtatStrategie | undefined = undefined;
    for (let i = 1; i < n; i++) {
      const h = hh[i - 1]; // canal des `canal` bougies PRÉCÉDENTES
      const l = ll[i - 1];
      const c = closes[i];
      if (h === undefined || l === undefined || c === undefined) {
        out[i] = etat;
        continue;
      }
      if (c > h) etat = 1;
      else if (c < l) etat = -1;
      else etat = etat ?? 0; // canal défini, pas de cassure : flat au départ, maintien ensuite
      out[i] = etat;
    }
    return out;
  },
  libelles: (params) => ({
    long: `cassure du plus-haut ${params.canal} bougies`,
    short: `cassure du plus-bas ${params.canal} bougies`,
    sortie: "cassure du canal opposé",
  }),
});
