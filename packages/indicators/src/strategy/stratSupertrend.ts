/**
 * @axiom/indicators — strategy/stratSupertrend.ts
 *
 * Stratégie Supertrend (long/short symétrique) : long à la bascule haussière
 * (direction +1), short à la bascule baissière (direction −1). Période ATR et
 * multiplicateur configurables (défauts SuperTrend classiques 10/3). Rendu par
 * defStrategie.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { supertrendOf } from "../trend/supertrend";

export const stratSupertrend = defStrategie({
  id: "stratSupertrend",
  name: "Stratégie Supertrend",
  inputsStrategie: [
    { key: "atrLength", name: "Période ATR", type: "number", default: 10, min: 1 },
    { key: "mult", name: "Multiplicateur", type: "number", default: 3, min: 0.5 },
  ],
  position: (candles, params) => {
    const r = supertrendOf(candles, Number(params.atrLength ?? 10), Number(params.mult ?? 3));
    return r.direction.map((d): EtatStrategie | undefined =>
      d === undefined ? undefined : d > 0 ? 1 : -1
    );
  },
  libelles: (params) => ({
    long: `bascule Supertrend haussière (ATR ${params.atrLength} × ${params.mult})`,
    short: `bascule Supertrend baissière (ATR ${params.atrLength} × ${params.mult})`,
    sortie: "bascule inverse",
  }),
});
