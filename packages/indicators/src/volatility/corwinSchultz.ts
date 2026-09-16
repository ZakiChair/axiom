/**
 * @axiom/indicators — volatility/corwinSchultz.ts
 *
 * Spread effectif estimé par Corwin-Schultz (high-low, deux barres consécutives),
 * exprimé en % du prix. Estimateur de spread SANS carnet : la fourchette haute/basse
 * de deux barres voisines contient à la fois le spread et la volatilité, et le
 * chevauchement des deux ranges permet de démêler les deux [acad].
 *
 *   β = ln(H_t/L_t)² + ln(H_{t+1}/L_{t+1})²
 *   γ = ln( max(H_t,H_{t+1}) / min(L_t,L_{t+1}) )²
 *   α = (√(2β) − √β) / (3 − 2√2) − √( γ / (3 − 2√2) )
 *   S = 2·(e^α − 1) / (1 + e^α)
 *
 * Sur `length` barres, la fenêtre porte sur les `length − 1` paires consécutives :
 * le premier point est calculé à l'index `length − 1` (comme toute fenêtre).
 *
 * S peut sortir NÉGATIF (deux barres sans spread mais très directionnelles) :
 * borné à 0, convention standard de l'estimateur — un spread négatif n'a pas de
 * sens, et la borne est explicite plutôt qu'un NaN silencieux.
 *
 * Limite affichée : sur un carnet crypto à tick fin, le spread réel est de l'ordre
 * du point de base ; l'estimateur high-low est bruité à cette échelle. Le DOM (L2)
 * reste la mesure de référence du spread courant — cet indicateur sert à en lire
 * l'HISTORIQUE, pas l'instant.
 *
 * Sortie : spread en % du prix de clôture (0,05 = 5 points de base).
 */

import type { IndicatorDef } from "@axiom/types";
import { clampInt } from "../utils";

const TROIS_MOINS_2RACINE2 = 3 - 2 * Math.SQRT2;

export const corwinSchultz: IndicatorDef = {
  id: "corwinSchultz",
  name: "Spread effectif (Corwin-Schultz)",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 2, max: 200 },
  ],
  outputs: [{ key: "spread", name: "Spread est. %", style: "line" }],
  precision: 3,
  calc(candles, params) {
    const length = clampInt(params.length, 20, 2, 200);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    // Terme ln(H/L)² par barre.
    const hl2: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined || !(c.high > 0) || !(c.low > 0)) continue;
      const hl = Math.log(c.high / c.low);
      hl2[i] = hl * hl;
    }

    // S d'une paire (barre a, barre b) — undefined si l'une des deux est inexploitable.
    function spreadPaire(a: number, b: number): number | undefined {
      const ca = candles[a];
      const cb = candles[b];
      const ha = hl2[a];
      const hb = hl2[b];
      if (ca === undefined || cb === undefined || ha === undefined || hb === undefined) return undefined;
      const haut = Math.max(ca.high, cb.high);
      const bas = Math.min(ca.low, cb.low);
      if (!(haut > 0) || !(bas > 0)) return undefined;
      const gamma = Math.log(haut / bas);
      const beta = ha + hb;
      const alpha =
        (Math.sqrt(2 * beta) - Math.sqrt(beta)) / TROIS_MOINS_2RACINE2 -
        Math.sqrt((gamma * gamma) / TROIS_MOINS_2RACINE2);
      const exp = Math.exp(alpha);
      const s = (2 * (exp - 1)) / (1 + exp);
      return s > 0 ? s : 0;
    }

    for (let i = length - 1; i < n; i++) {
      let sum = 0;
      let ok = true;
      for (let j = i - length + 2; j <= i; j++) {
        const s = spreadPaire(j - 1, j);
        if (s === undefined) {
          ok = false;
          break;
        }
        sum += s;
      }
      if (!ok) continue;
      const moyenne = sum / (length - 1);
      out[i] = 100 * moyenne; // fraction du prix → %
    }

    return { series: { spread: out } };
  },
};
