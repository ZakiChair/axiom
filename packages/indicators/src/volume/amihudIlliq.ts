/**
 * @axiom/indicators — volume/amihudIlliq.ts
 *
 * Illiquidité d'Amihud sur fenêtre glissante : impact de prix moyen par unité de
 * volume en devises. Mesure d'ILLIQUIDITÉ de fréquence bougie — complément du coût
 * d'exécution L2 du DOM (instantané) : ici, l'historique.
 *
 *   ILLIQ_i = 10^6 · (1/N) · Σ_j |r_j| / DV_j
 *   r_j  = ln(close_j / close_{j−1})
 *   DV_j = quoteVolume_j si présent, sinon close_j · volume_j
 *
 * Le facteur 10^6 est la convention usuelle (Amihud 2002) : sans lui, les valeurs
 * sont des ordres de grandeur illisibles. L'unité reste donc arbitraire — lire la
 * SÉRIE (niveaux relatifs, régime), pas la valeur absolue.
 *
 * Fenêtre : les N rendements exigent la clôture précédant la première barre (premier
 * point à l'index `length`) ; une barre sans volume positif ou sans rendement
 * exploitable invalide la fenêtre entière (pas de fenêtre à trous, pas de zéro
 * fabriqué). Les sources sans volume (forex Twelve Data) retombent donc sur
 * `undefined` — l'app les marque déjà UNUSABLE.
 */

import type { IndicatorDef } from "@axiom/types";
import { clampInt, rendementsLog } from "../utils";

export const amihudIlliq: IndicatorDef = {
  id: "amihudIlliq",
  name: "Illiquidité d'Amihud",
  category: "volume",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 30, min: 5, max: 200 },
  ],
  outputs: [{ key: "illiq", name: "ILLIQ (×10⁶)", style: "line" }],
  precision: 2,
  calc(candles, params) {
    const length = clampInt(params.length, 30, 5, 200);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    const closes = candles.map((c) => c.close);
    const r = rendementsLog(closes, n);

    // Terme par barre : |r| / DV, ou undefined si l'une des deux entrées manque.
    const terme: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const ri = r[i];
      if (c === undefined || ri === undefined) continue;
      const dv =
        c.quoteVolume !== undefined && Number.isFinite(c.quoteVolume) && c.quoteVolume > 0
          ? c.quoteVolume
          : c.close * c.volume;
      if (!(dv > 0) || !Number.isFinite(dv)) continue;
      terme[i] = Math.abs(ri) / dv;
    }

    for (let i = length; i < n; i++) {
      let sum = 0;
      let ok = true;
      for (let j = i - length + 1; j <= i; j++) {
        const t = terme[j];
        if (t === undefined) {
          ok = false;
          break;
        }
        sum += t;
      }
      if (!ok) continue;
      out[i] = 1e6 * (sum / length);
    }

    return { series: { illiq: out } };
  },
};
