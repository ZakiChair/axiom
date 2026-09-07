/**
 * @axiom/indicators — strategy/stratSpotBreakout.ts
 *
 * Stratégie « Breakout avec validation Taker Volume » (non validé) :
 * Filtre les breakouts de canaux Donchian en exigeant une confirmation
 * nette du carnet (Taker Net Flow > seuilNet % pour un long, < -seuilNet % pour un short).
 *
 * Évite les faux breakouts à faible conviction et les pièges de liquidité.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { closeOf, highOf, lowOf, rollingHighest, rollingLowest } from "../utils";

export const stratSpotBreakout = defStrategie({
  id: "stratSpotBreakout",
  name: "Breakout validé Taker Net",
  validation: "non-valide",
  inputsStrategie: [
    { key: "canal", name: "Canal Donchian", type: "number", default: 20, min: 2 },
    { key: "seuilNet", name: "Seuil Taker Net %", type: "number", default: 15, min: 0, max: 100 },
  ],
  position: (candles, params) => {
    const canal = Number(params.canal ?? 20);
    const seuilNet = Number(params.seuilNet ?? 15);
    const hh = rollingHighest(highOf(candles), canal);
    const ll = rollingLowest(lowOf(candles), canal);
    const closes = closeOf(candles);
    const n = candles.length;
    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);

    let etat: EtatStrategie = 0;
    for (let i = 1; i < n; i++) {
      const h = hh[i - 1];
      const l = ll[i - 1];
      const c = closes[i];
      const candle = candles[i];

      if (h === undefined || l === undefined || c === undefined || candle === undefined) {
        out[i] = etat;
        continue;
      }

      // Sans split réel et valide, le flux ne peut confirmer aucune entrée.
      let netPct: number | undefined;
      const buy = candle.buyVolume;
      const sell = candle.sellVolume;
      if (
        buy !== undefined &&
        sell !== undefined &&
        Number.isFinite(buy) &&
        Number.isFinite(sell) &&
        buy >= 0 &&
        sell >= 0 &&
        buy + sell > 0
      ) {
        netPct = ((buy - sell) / (buy + sell)) * 100;
      }

      if (netPct !== undefined && c > h && netPct > seuilNet) {
        etat = 1;
      } else if (netPct !== undefined && c < l && netPct < -seuilNet) {
        etat = -1;
      } else if (etat === 1 && c < (h + l) / 2) {
        etat = 0;
      } else if (etat === -1 && c > (h + l) / 2) {
        etat = 0;
      }

      out[i] = etat;
    }

    return out;
  },
  libelles: (params) => ({
    long: `Cassure plus-haut Donchian(${params.canal}) avec Taker Net > +${params.seuilNet}%`,
    short: `Cassure plus-bas Donchian(${params.canal}) avec Taker Net < -${params.seuilNet}%`,
    sortie: `Retour sous la médiane du canal Donchian`,
  }),
});
