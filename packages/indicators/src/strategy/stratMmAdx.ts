/**
 * @axiom/indicators — strategy/stratMmAdx.ts
 *
 * Stratégie MM + filtre ADX (long/short) : signe(MM rapide − MM lente) comme
 * `stratCroisementMM`, MAIS position forcée à 0 (flat) tant que l'ADX reste
 * sous `seuilAdx` — y compris pour couper une position en cours. Le filtre
 * anti-range EST la raison d'être du def : un croisement de moyennes sans
 * tendance confirmée (ADX faible) ne déclenche rien. Rendu par defStrategie.
 *
 * Résultats de backtest : voir docs/superpowers/research/2026-07-28-backtest-strategies.md
 * (campagne §Task 6) — mesures passées, hors frais, PAS une promesse (formule
 * d'honnêteté du spec v2.3 §2).
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { ema, sma } from "../utils";
import { adxOf } from "../trend/adx";

export const stratMmAdx = defStrategie({
  id: "stratMmAdx",
  name: "Stratégie MM + filtre ADX",
  inputsStrategie: [
    { key: "type", name: "Type de MM", type: "select", default: "ema", options: ["ema", "sma"] },
    { key: "rapide", name: "MM rapide", type: "number", default: 9, min: 1 },
    { key: "lente", name: "MM lente", type: "number", default: 21, min: 2 },
    { key: "adxLength", name: "Longueur ADX", type: "number", default: 14, min: 1 },
    { key: "seuilAdx", name: "Seuil ADX", type: "number", default: 25, min: 5, max: 60 },
  ],
  position: (candles, params, ctx) => {
    const moyenne = params.type === "sma" ? sma : ema;
    const rapide = moyenne(ctx.source, Number(params.rapide ?? 9));
    const lente = moyenne(ctx.source, Number(params.lente ?? 21));
    const a = adxOf(candles, Number(params.adxLength ?? 14));
    const seuil = Number(params.seuilAdx ?? 25);
    return ctx.source.map((_v, i): EtatStrategie | undefined => {
      const f = rapide[i];
      const l = lente[i];
      const x = a.adx[i];
      if (f === undefined || l === undefined || x === undefined) return undefined;
      if (x < seuil) return 0; // filtre anti-range : flat forcé
      return f > l ? 1 : f < l ? -1 : 0;
    });
  },
  libelles: (params) => {
    const t = params.type === "sma" ? "SMA" : "EMA";
    return {
      long: `croisement ${t} ${params.rapide} > ${t} ${params.lente}, ADX ≥ ${params.seuilAdx}`,
      short: `croisement ${t} ${params.rapide} < ${t} ${params.lente}, ADX ≥ ${params.seuilAdx}`,
      sortie: `croisement inverse ou ADX < ${params.seuilAdx}`,
    };
  },
});
