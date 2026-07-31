/**
 * @axiom/indicators — trend/mcginley.ts
 *
 * McGinley Dynamic — moyenne mobile auto-ajustée à la vitesse du marché,
 * conçue pour mieux "coller" au prix qu'une EMA. Overlay sur les bougies.
 *
 * Formule canonique :
 *   MD[i] = MD[i−1] + (close[i] − MD[i−1]) / ( N · (close[i] / MD[i−1])^4 )
 * Source : John R. McGinley (1990s), "Journal of Technical Analysis".
 *
 * Amorce : MD[0] = close[0] (la série est récursive, définie dès la 1re bougie).
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf } from "../utils";

export const mcginley: IndicatorDef = {
  id: "mcginley",
  name: "McGinley Dynamic",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 14, min: 1 },
  ],
  outputs: [{ key: "mcginley", name: "McGinley", style: "line" }],
  calc(candles, params) {
    const length = Number(params.length ?? 14);
    const close = closeOf(candles);
    const n = close.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (n === 0) return { series: { mcginley: out } };

    // Amorce avec la première clôture.
    const first = close[0];
    if (first === undefined) return { series: { mcginley: out } };
    let md: number = first;
    out[0] = md;

    for (let i = 1; i < n; i++) {
      const c = close[i];
      if (c === undefined) {
        out[i] = md;
        continue;
      }
      // Garde anti division par zéro : MD reste > 0 sur des prix positifs.
      if (md === 0) {
        md = c;
      } else {
        const ratio = c / md;
        md = md + (c - md) / (length * ratio ** 4);
      }
      out[i] = md;
    }

    return { series: { mcginley: out } };
  },
};
