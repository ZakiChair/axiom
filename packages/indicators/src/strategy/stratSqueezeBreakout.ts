/**
 * @axiom/indicators — strategy/stratSqueezeBreakout.ts
 *
 * Stratégie squeeze breakout (long/short) : armement après ≥ `dureeMin`
 * bougies de squeeze TTM actif (BB entièrement dans KC), puis entrée à la
 * LIBÉRATION (squeeze ON → OFF) dans le sens du momentum TTM (`mom` > 0 →
 * long, `mom` < 0 → short). Une libération SANS armement (durée < `dureeMin`)
 * ne déclenche RIEN — le filtre de durée est la raison d'être du def (évite
 * les faux départs sur un simple à-coup de volatilité). Sortie au
 * retournement du momentum ; ré-armement possible au prochain squeeze.
 * Rendu par defStrategie.
 *
 * Résultats de backtest : voir docs/superpowers/research/2026-07-28-backtest-strategies.md
 * (campagne §Task 6) — mesures passées, hors frais, PAS une promesse (formule
 * d'honnêteté du spec v2.3 §2).
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { ttmSqueezeOf } from "../volatility/ttmSqueeze";

export const stratSqueezeBreakout = defStrategie({
  id: "stratSqueezeBreakout",
  name: "Stratégie squeeze breakout",
  inputsStrategie: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 2, max: 200 },
    { key: "multBB", name: "Multiplicateur BB", type: "number", default: 2, min: 0.5, max: 5 },
    { key: "multKC", name: "Multiplicateur KC", type: "number", default: 1.5, min: 0.5, max: 5 },
    { key: "dureeMin", name: "Durée min du squeeze", type: "number", default: 3, min: 1 },
  ],
  position: (candles, params, ctx) => {
    const r = ttmSqueezeOf(candles, ctx.hlc3, Number(params.length ?? 20), Number(params.multBB ?? 2), Number(params.multKC ?? 1.5));
    const dureeMin = Number(params.dureeMin ?? 3);
    const n = candles.length;
    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
    let etat: EtatStrategie = 0;
    let dureeOn = 0;
    let arme = false;
    for (let i = 0; i < n; i++) {
      const on = r.on[i];
      const mom = r.mom[i];
      if (on === undefined || mom === undefined) continue;
      if (on > 0) { dureeOn++; if (dureeOn >= dureeMin) arme = true; }
      else {
        if (arme && etat === 0) etat = mom > 0 ? 1 : mom < 0 ? -1 : 0; // libération armée → sens du momentum
        arme = false;
        dureeOn = 0;
      }
      if (etat === 1 && mom < 0) etat = 0;   // sortie : momentum retourné
      else if (etat === -1 && mom > 0) etat = 0;
      out[i] = etat;
    }
    return out;
  },
  libelles: (params) => ({
    long: `libération du squeeze (≥ ${params.dureeMin} barres) momentum haussier`,
    short: `libération du squeeze (≥ ${params.dureeMin} barres) momentum baissier`,
    sortie: "retournement du momentum",
  }),
});
