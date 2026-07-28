/**
 * @axiom/indicators — strategy/stratPsar.ts
 *
 * Stratégie PSAR (long/short symétrique, jamais flat) : long tant que le prix
 * est au-dessus du Parabolic SAR, short en dessous — bascule à chaque
 * renversement du SAR. Step/max de l'accélération configurables (défauts
 * Wilder classiques 0,02/0,2). Rendu par defStrategie.
 *
 * Résultats de backtest : voir docs/superpowers/research/2026-07-28-backtest-strategies.md
 * (campagne §Task 6) — mesures passées, hors frais, PAS une promesse (formule
 * d'honnêteté du spec v2.3 §2).
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { psarOf } from "../trend/psar";

export const stratPsar = defStrategie({
  id: "stratPsar",
  name: "Stratégie PSAR",
  inputsStrategie: [
    { key: "step", name: "AF step", type: "number", default: 0.02, min: 0 },
    { key: "max", name: "AF max", type: "number", default: 0.2, min: 0 },
  ],
  position: (candles, params, ctx) => {
    const r = psarOf(candles, Number(params.step ?? 0.02), Number(params.max ?? 0.2));
    return ctx.source.map((c, i): EtatStrategie | undefined => {
      const s = r.psar[i];
      if (s === undefined || c === undefined) return undefined;
      return c > s ? 1 : -1;
    });
  },
  libelles: (params) => ({
    long: `bascule PSAR haussière (${params.step}/${params.max})`,
    short: `bascule PSAR baissière (${params.step}/${params.max})`,
    sortie: "bascule inverse",
  }),
});
