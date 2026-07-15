/**
 * @axiom/indicators — derivatives/reserveRisk.ts
 *
 * Reserve Risk — confiance des détenteurs long terme rapportée au prix : mesure le
 * rapport risque/récompense d'un achat. BAS = forte conviction pour un prix faible
 * (récompense attractive, creux de cycle) ; HAUT = faible conviction à prix élevé
 * (récompense faible, sommets de cycle).
 *
 * Série aux `reserveRisk` (bitcoin-data.com / BGeometrics, journalier, BTC uniquement,
 * gratuit). Valeurs typiquement petites (~1e-3). Recopie directe : moteur pur.
 */

import type { IndicatorDef } from "@axiom/types";

export const reserveRisk: IndicatorDef = {
  id: "reserveRisk",
  name: "Reserve Risk",
  category: "derivatives",
  pane: "separate",
  aux: ["reserveRisk"],
  minTimeframe: "1d",
  precision: 6,
  inputs: [],
  outputs: [{ key: "reserveRisk", name: "Reserve Risk", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.reserveRisk;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) {
      for (let i = 0; i < n; i++) out[i] = series[i];
    }
    return { series: { reserveRisk: out } };
  },
};
