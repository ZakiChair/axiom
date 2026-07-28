/**
 * @axiom/indicators — strategy/stratRsiReversion.ts
 *
 * Stratégie retour de survente (long/flat) : entrée quand le RSI RECROISE son
 * seuil de survente à la hausse (RSI[i−1] < survente ≤ RSI[i] — le rebond
 * confirmé, pas la chute) ; sortie quand le RSI atteint le seuil de surachat.
 * Pas de jambe short : la réversion crypto est asymétrique (les défauts 30/70
 * suivent le preset backtest « RSI survente/surachat »). Rendu par defStrategie.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { rsiOf } from "../momentum/rsi";

export const stratRsiReversion = defStrategie({
  id: "stratRsiReversion",
  name: "Stratégie RSI réversion",
  inputsStrategie: [
    { key: "length", name: "Longueur RSI", type: "number", default: 14, min: 1 },
    { key: "survente", name: "Survente", type: "number", default: 30, min: 1, max: 50 },
    { key: "surachat", name: "Surachat", type: "number", default: 70, min: 50, max: 99 },
  ],
  position: (_candles, params, ctx) => {
    const r = rsiOf(ctx.source, Number(params.length ?? 14));
    const survente = Number(params.survente ?? 30);
    const surachat = Number(params.surachat ?? 70);
    const n = ctx.source.length;
    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
    let etat: EtatStrategie = 0;
    for (let i = 0; i < n; i++) {
      const cur = r[i];
      if (cur === undefined) continue; // warm-up : out[i] reste undefined
      const prev = r[i - 1];
      if (etat === 1 && cur >= surachat) etat = 0;
      else if (etat === 0 && prev !== undefined && prev < survente && cur >= survente) etat = 1;
      out[i] = etat;
    }
    return out;
  },
  libelles: (params) => ({
    long: `RSI ${params.length} sort de survente (${params.survente})`,
    short: "", // jamais émis (long/flat)
    sortie: `RSI ${params.length} atteint le surachat (${params.surachat})`,
  }),
});
