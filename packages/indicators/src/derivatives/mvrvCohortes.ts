/**
 * @axiom/indicators — derivatives/mvrvCohortes.ts
 *
 * MVRV STH / LTH — ratio valeur de marché / valeur réalisée des cohortes de détenteurs
 * COURT TERME (< 155 j) et LONG TERME (≥ 155 j), recopiées de BGeometrics
 * (`sth-mvrv`, `lth-mvrv`, journalier, BTC — embargo J-7 de l'offre gratuite).
 * STH > 1 = les mains récentes sont en profit ; LTH mesure la conviction ancienne.
 */
import type { IndicatorDef } from "@axiom/types";

export const mvrvCohortes: IndicatorDef = {
  id: "mvrvCohortes",
  name: "MVRV STH / LTH",
  category: "derivatives",
  pane: "separate",
  aux: ["sthMvrv", "lthMvrv"],
  minTimeframe: "1d",
  precision: 2,
  inputs: [],
  outputs: [
    { key: "sth", name: "MVRV STH", style: "line" },
    { key: "lth", name: "MVRV LTH", style: "line" },
  ],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const sth: Array<number | undefined> = new Array(n).fill(undefined);
    const lth: Array<number | undefined> = new Array(n).fill(undefined);
    const s = ctx.aux?.sthMvrv;
    const l = ctx.aux?.lthMvrv;
    if (!s && !l) return { series: { sth, lth } };
    for (let i = 0; i < n; i++) {
      const sv = s?.[i];
      const lv = l?.[i];
      if (sv !== undefined && Number.isFinite(sv)) sth[i] = sv;
      if (lv !== undefined && Number.isFinite(lv)) lth[i] = lv;
    }
    return { series: { sth, lth } };
  },
};
