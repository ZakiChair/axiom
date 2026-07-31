/**
 * @axiom/indicators — strategy/stratMacdCross.ts
 *
 * Stratégie croisement MACD (long/short symétrique) : long quand la ligne MACD
 * est au-dessus du signal, short en dessous, égalité = flat. Périodes fast/slow/
 * signal et source configurables (défauts MACD classiques 12/26/9). Rendu par
 * defStrategie.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { macdOf } from "../trend/macd";

export const stratMacdCross = defStrategie({
  id: "stratMacdCross",
  name: "Stratégie croisement MACD",
  inputsStrategie: [
    { key: "fast", name: "Rapide", type: "number", default: 12, min: 1 },
    { key: "slow", name: "Lente", type: "number", default: 26, min: 1 },
    { key: "signal", name: "Signal", type: "number", default: 9, min: 1 },
    {
      key: "source", name: "Source", type: "source", default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
  ],
  position: (_candles, params, ctx) => {
    const r = macdOf(ctx.source, Number(params.fast ?? 12), Number(params.slow ?? 26), Number(params.signal ?? 9));
    return ctx.source.map((_v, i): EtatStrategie | undefined => {
      const m = r.macd[i];
      const s = r.signal[i];
      if (m === undefined || s === undefined) return undefined;
      return m > s ? 1 : m < s ? -1 : 0;
    });
  },
  libelles: (params) => ({
    long: `MACD (${params.fast}/${params.slow}) croise au-dessus du signal ${params.signal}`,
    short: `MACD (${params.fast}/${params.slow}) croise sous le signal ${params.signal}`,
    sortie: "croisement inverse",
  }),
});
