/**
 * @axiom/indicators — strategy/stratDivergenceRsi.ts
 *
 * Stratégie divergence RSI (long/short) : entrée à la CONFIRMATION d'une
 * divergence RÉGULIÈRE (les cachées ne déclenchent rien — stratégie de
 * retournement). Anti-look-ahead STRICT : detecterDivergences date une
 * divergence à son pivot (idxTo), mais ce pivot n'est CONNU que `droite`
 * bougies plus tard — l'entrée est donc posée à idxTo + droite, jamais au
 * pivot. Sortie : RSI extrême opposé (long sort à ≥ seuilSortie, short à
 * ≤ 100 − seuilSortie). Une divergence confirmée pendant une position du même
 * sens est ignorée ; pendant une position opposée, elle attend le flat (pas de
 * retournement direct : la sortie est pilotée par le RSI). Rendu par defStrategie.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { detecterDivergences } from "../utils-divergence";
import { highOf, lowOf } from "../utils";
import { rsiOf } from "../momentum/rsi";

export const stratDivergenceRsi = defStrategie({
  id: "stratDivergenceRsi",
  name: "Stratégie divergence RSI",
  inputsStrategie: [
    { key: "length", name: "Longueur RSI", type: "number", default: 14, min: 1 },
    { key: "gauche", name: "Pivot gauche", type: "number", default: 5, min: 1 },
    { key: "droite", name: "Pivot droite", type: "number", default: 5, min: 1 },
    { key: "maxEcart", name: "Écart max (barres)", type: "number", default: 60, min: 5, max: 300 },
    { key: "seuilSortie", name: "Seuil de sortie (RSI)", type: "number", default: 70, min: 50, max: 99 },
  ],
  position: (candles, params, ctx) => {
    const length = Number(params.length ?? 14);
    const gauche = Number(params.gauche ?? 5);
    const droite = Number(params.droite ?? 5);
    const maxEcart = Number(params.maxEcart ?? 60);
    const seuilSortie = Number(params.seuilSortie ?? 70);
    const r = rsiOf(ctx.source, length);
    const n = candles.length;
    const opts = { gauche, droite, maxEcart };

    // Index de CONFIRMATION (idxTo + droite) des divergences régulières.
    const confirmLong = new Set<number>();
    for (const d of detecterDivergences(lowOf(candles), r, opts)) {
      if (d.type === "haussiere" && d.idxTo + droite < n) confirmLong.add(d.idxTo + droite);
    }
    const confirmShort = new Set<number>();
    for (const d of detecterDivergences(highOf(candles), r, opts)) {
      if (d.type === "baissiere" && d.idxTo + droite < n) confirmShort.add(d.idxTo + droite);
    }

    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
    let etat: EtatStrategie = 0;
    for (let i = 0; i < n; i++) {
      const cur = r[i];
      if (cur === undefined) continue; // warm-up RSI
      if (etat === 1 && cur >= seuilSortie) etat = 0;
      else if (etat === -1 && cur <= 100 - seuilSortie) etat = 0;
      if (etat === 0) {
        if (confirmLong.has(i)) etat = 1;
        else if (confirmShort.has(i)) etat = -1;
      }
      out[i] = etat;
    }
    return out;
  },
  libelles: (params) => ({
    long: `divergence RSI haussière confirmée (${params.gauche}/${params.droite})`,
    short: `divergence RSI baissière confirmée (${params.gauche}/${params.droite})`,
    sortie: `RSI ${params.length} extrême (seuil ${params.seuilSortie})`,
  }),
});
