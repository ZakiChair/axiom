/**
 * @axiom/indicators — support_resistance/zigzag.ts
 *
 * ZigZag — filtre de swings par seuil de retournement en pourcentage.
 * Source canonique : ZigZag classique (Arthur Merrill), méthode % deviation.
 *
 * Principe : on relie les pivots significatifs (hauts/bas alternés). Un nouveau
 * pivot n'est confirmé que lorsque le prix se retourne d'au moins `reversal` %
 * par rapport à l'extrême courant :
 *   - en tendance haussière, on suit le plus haut (high) le plus élevé ; un
 *     pivot HAUT est validé dès qu'un bas (low) descend de `reversal` % sous ce
 *     plus haut ;
 *   - symétriquement en tendance baissière avec les bas (low).
 *
 * Sortie : une unique série `zigzag` portant le PRIX de l'extrême aux seules
 * bougies pivot ; `undefined` partout ailleurs. Le renderer relie les points
 * définis (ligne brisée). Le dernier extrême en cours est marqué comme pivot
 * provisoire afin que la dernière jambe soit tracée (convention ZigZag).
 *
 * Déterminisme : balayage unique, gauche -> droite, sans repaint rétroactif des
 * pivots déjà confirmés.
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf } from "../utils";

export const zigzag: IndicatorDef = {
  id: "zigzag",
  name: "ZigZag",
  category: "support_resistance",
  pane: "overlay",
  inputs: [
    // Seuil de retournement en pourcentage (défaut 5 %).
    { key: "reversal", name: "Retournement %", type: "number", default: 5, min: 0 },
  ],
  outputs: [{ key: "zigzag", name: "ZigZag", style: "line" }],

  calc(candles, params) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (n === 0) return { series: { zigzag: out } };

    const dev = Number(params.reversal ?? 5) / 100;
    const highs = highOf(candles);
    const lows = lowOf(candles);

    // Amorce sur la bougie 0 (gardes explicites noUncheckedIndexedAccess).
    const h0 = highs[0];
    const l0 = lows[0];
    if (h0 === undefined || l0 === undefined) return { series: { zigzag: out } };

    let dir = 0; // tendance confirmée : +1 haussière, −1 baissière, 0 indéterminée
    let maxVal = h0;
    let maxIdx = 0; // candidat pivot HAUT en cours
    let minVal = l0;
    let minIdx = 0; // candidat pivot BAS en cours

    for (let i = 1; i < n; i++) {
      const hi = highs[i];
      const lo = lows[i];
      if (hi === undefined || lo === undefined) continue;

      if (dir === 1) {
        // Tendance haussière : on étend le plus haut, ou on retourne vers le bas.
        if (hi >= maxVal) {
          maxVal = hi;
          maxIdx = i;
        } else if (lo <= maxVal * (1 - dev)) {
          out[maxIdx] = maxVal; // confirme le pivot HAUT
          dir = -1;
          minVal = lo;
          minIdx = i;
        }
      } else if (dir === -1) {
        // Tendance baissière : on étend le plus bas, ou on retourne vers le haut.
        if (lo <= minVal) {
          minVal = lo;
          minIdx = i;
        } else if (hi >= minVal * (1 + dev)) {
          out[minIdx] = minVal; // confirme le pivot BAS
          dir = 1;
          maxVal = hi;
          maxIdx = i;
        }
      } else {
        // Direction indéterminée : on suit les deux extrêmes jusqu'au 1er seuil franchi.
        if (hi >= maxVal) {
          maxVal = hi;
          maxIdx = i;
        }
        if (lo <= minVal) {
          minVal = lo;
          minIdx = i;
        }
        if (lo <= maxVal * (1 - dev)) {
          // Le marché montait puis retourne : premier pivot = le plus haut.
          out[maxIdx] = maxVal;
          dir = -1;
          minVal = lo;
          minIdx = i;
        } else if (hi >= minVal * (1 + dev)) {
          // Le marché baissait puis retourne : premier pivot = le plus bas.
          out[minIdx] = minVal;
          dir = 1;
          maxVal = hi;
          maxIdx = i;
        }
      }
    }

    // Dernier extrême en cours -> pivot provisoire (dernière jambe tracée).
    if (dir === 1) out[maxIdx] = maxVal;
    else if (dir === -1) out[minIdx] = minVal;

    return { series: { zigzag: out } };
  },
};
