/**
 * @axiom/indicators — volatility/skewKurt.ts
 *
 * Asymétrie (skew) et aplatissement (kurtosis) des RENDEMENTS LOG sur fenêtre
 * glissante — les deux moments d'ordre 3 et 4 de la distribution réalisée.
 *
 *   skew  = m3 / m2^1,5            (0 = symétrique ; < 0 = queue gauche)
 *   kurt  = m4 / m2² − 3           (excès ; 0 = gaussien, > 0 = queues épaisses)
 *   m_k   = (1/N) · Σ (r − r̄)^k
 *
 * Rendements LOG (convention du package : rollingCorrelation / betaRef / rv) :
 *   r[i] = ln(close[i] / close[i−1])
 * Un rendement n'existe que si ses DEUX bornes sont finies et > 0.
 *
 * Lecture crypto : une kurtosis élevée signale un régime à sauts (liquidations en
 * cascade) ; un skew négatif marque la asymétrie des flushs baissiers. Complète la
 * fenêtre DIST (VaR) — mêmes rendements, moments plutôt que quantiles.
 *
 * `undefined` si la fenêtre est incomplète, si un rendement y manque (pas de
 * fenêtre à trous), ou si la variance est nulle (série plate → m2 = 0 : skew et
 * kurtosis n'existent pas). Il faut `length` rendements, donc `length + 1` bougies.
 */

import type { IndicatorDef } from "@axiom/types";
import { clampInt, rendementsLog } from "../utils";

export const skewKurt: IndicatorDef = {
  id: "skewKurt",
  name: "Skew / Kurtosis réalisés",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 100, min: 10, max: 500 },
  ],
  outputs: [
    { key: "skew", name: "Skew", style: "line" },
    { key: "kurt", name: "Kurtosis (excès)", style: "line" },
  ],
  precision: 2,
  calc(candles, params) {
    const length = clampInt(params.length, 100, 10, 500);
    const n = candles.length;
    const skew: Array<number | undefined> = new Array(n).fill(undefined);
    const kurt: Array<number | undefined> = new Array(n).fill(undefined);

    const closes = candles.map((c) => c.close);
    const r = rendementsLog(closes, n);

    // Premier point plein à l'index `length` : la fenêtre porte sur `length` rendements.
    for (let i = length; i < n; i++) {
      let sum = 0;
      let ok = true;
      for (let j = i - length + 1; j <= i; j++) {
        const v = r[j];
        if (v === undefined) {
          ok = false;
          break;
        }
        sum += v;
      }
      if (!ok) continue;
      const moy = sum / length;

      let m2 = 0;
      let m3 = 0;
      let m4 = 0;
      for (let j = i - length + 1; j <= i; j++) {
        const d = r[j]! - moy;
        const d2 = d * d;
        m2 += d2;
        m3 += d2 * d;
        m4 += d2 * d2;
      }
      m2 /= length;
      m3 /= length;
      m4 /= length;
      // Garde RELATIVE : une variance nulle laisse un m2 de bruit (~1e-32) dont la
      // puissance 1,5 donnerait un skew arbitraire. Les rendements sont ≥ 1e-6 en
      // pratique : 1e-18 est très en dessous de toute dispersion réelle.
      if (!(m2 > 1e-18)) continue;

      skew[i] = m3 / Math.pow(m2, 1.5);
      kurt[i] = m4 / (m2 * m2) - 3;
    }

    return { series: { skew, kurt } };
  },
};
