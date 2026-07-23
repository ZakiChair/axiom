/**
 * @axiom/indicators — statistical/rollingCorrelation.ts
 *
 * Corrélation roulante de Pearson des RENDEMENTS LOG du symbole courant vs ceux du
 * symbole de RÉFÉRENCE (série auxiliaire `refClose`, close du symbole de référence
 * aligné LOCF sur les bougies du chart). Premier des indicateurs cross-asset
 * `statistical` — mesure si les deux marchés bougent ensemble (+1), en opposition
 * (−1) ou sans lien (0) sur une fenêtre glissante.
 *
 * Rendements LOG :
 *   r[i]    = ln(close[i] / close[i-1])
 *   rRef[i] = ln(ref[i]   / ref[i-1])
 * Un rendement (par jambe) n'existe que si SES DEUX bornes sont finies et > 0 —
 * sinon undefined (jamais de NaN, jamais de 0 fantôme). Une PAIRE de rendements au
 * slot i n'est exploitable que si les DEUX jambes y sont définies : un trou de
 * refClose (undefined) invalide donc le rendement du trou (borne haute) ET du point
 * suivant (borne basse), même discipline que `lisserDeltas`.
 *
 * Fenêtre : les `length` derniers SLOTS de rendement (positionnelle, pas les
 * bougies). Pearson `undefined` si la fenêtre est incomplète (moins de `length`
 * slots disponibles) OU si un slot y est manquant (pas de fenêtre à trous, pas de
 * backfill d'un rendement plus ancien) OU si la variance d'une des deux jambes est
 * nulle (évite 0/0). Sortie bornée : clamp léger dans [−1, 1] contre le débordement
 * flottant.
 *
 * Moteur PUR : aucun fetch. Lecture défensive de `ctx.aux.refClose` (modèle
 * `fundingZScore` / `mvrvZScore`) — référence absente ⇒ `corr` undefined partout,
 * les repères constants +1/0/−1 restent tracés (lignes de niveau, cf. priceZScore).
 */

import type { IndicatorDef } from "@axiom/types";
import { clampInt, rendementsLog } from "../utils";

export const rollingCorrelation: IndicatorDef = {
  id: "rollingCorrelation",
  name: "Corrélation roulante",
  category: "statistical",
  pane: "separate",
  aux: ["refClose"],
  precision: 2,
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 50, min: 10, max: 500 },
    {
      key: "source",
      name: "Source",
      type: "source",
      default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
  ],
  outputs: [
    { key: "corr", name: "Corrélation", style: "line" },
    { key: "hi", name: "+1", style: "line" },
    { key: "mid", name: "0", style: "line" },
    { key: "lo", name: "-1", style: "line" },
  ],

  calc(candles, params, ctx) {
    const n = candles.length;
    const length = clampInt(params.length, 50, 10, 500);

    const corr: Array<number | undefined> = new Array(n).fill(undefined);
    const ref = ctx.aux?.refClose;

    if (ref) {
      const rx = rendementsLog(ctx.source, n);
      const rRef = rendementsLog(ref, n);

      for (let i = length; i < n; i++) {
        // Fenêtre POSITIONNELLE : les slots [i-length+1 .. i]. Un seul slot dont
        // l'une des deux jambes manque invalide tout le point (pas de trou toléré).
        let sumX = 0;
        let sumY = 0;
        let sumXX = 0;
        let sumYY = 0;
        let sumXY = 0;
        let complete = true;
        for (let j = i - length + 1; j <= i; j++) {
          const x = rx[j];
          const y = rRef[j];
          if (x === undefined || y === undefined) {
            complete = false;
            break;
          }
          sumX += x;
          sumY += y;
          sumXX += x * x;
          sumYY += y * y;
          sumXY += x * y;
        }
        if (!complete) continue;

        // Pearson via sommes : num = L·Σxy − Σx·Σy ; den = √(denX·denY).
        const denX = length * sumXX - sumX * sumX;
        const denY = length * sumYY - sumY * sumY;
        // Variance nulle d'un côté (rendements plats) ⇒ corrélation non définie.
        if (denX <= 0 || denY <= 0) continue;

        const r = (length * sumXY - sumX * sumY) / Math.sqrt(denX * denY);
        // Clamp léger contre le débordement flottant hors [−1, 1].
        corr[i] = Math.min(1, Math.max(-1, r));
      }
    }

    return {
      series: {
        corr,
        hi: new Array<number>(n).fill(1),
        mid: new Array<number>(n).fill(0),
        lo: new Array<number>(n).fill(-1),
      },
    };
  },
};
