/**
 * @axiom/indicators — strategy/stratCroisementMM.ts
 *
 * Stratégie croisement de moyennes mobiles (long/short symétrique) : long quand
 * la MM rapide est au-dessus de la lente, short en dessous, égalité = flat.
 * Type (EMA/SMA) et longueurs configurables — remplace les variantes figées
 * (le défaut EMA 9/21 est le classique intraday). Rendu par defStrategie.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { ema, sma } from "../utils";

export const stratCroisementMM = defStrategie({
  id: "stratCroisementMM",
  name: "Stratégie croisement MM",
  inputsStrategie: [
    { key: "type", name: "Type de MM", type: "select", default: "ema", options: ["ema", "sma"] },
    { key: "rapide", name: "MM rapide", type: "number", default: 9, min: 1 },
    { key: "lente", name: "MM lente", type: "number", default: 21, min: 2 },
  ],
  position: (_candles, params, ctx) => {
    const moyenne = params.type === "sma" ? sma : ema;
    const rapide = moyenne(ctx.source, Number(params.rapide ?? 9));
    const lente = moyenne(ctx.source, Number(params.lente ?? 21));
    return ctx.source.map((_v, i): EtatStrategie | undefined => {
      const a = rapide[i];
      const b = lente[i];
      if (a === undefined || b === undefined) return undefined;
      return a > b ? 1 : a < b ? -1 : 0;
    });
  },
  libelles: (params) => {
    const t = params.type === "sma" ? "SMA" : "EMA";
    return {
      long: `croisement ${t} ${params.rapide} > ${t} ${params.lente}`,
      short: `croisement ${t} ${params.rapide} < ${t} ${params.lente}`,
      sortie: "croisement inverse",
    };
  },
});
