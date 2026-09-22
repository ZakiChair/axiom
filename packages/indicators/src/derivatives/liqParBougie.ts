/**
 * @axiom/indicators — derivatives/liqParBougie.ts
 *
 * Liquidations par bougie (Coinalyze) — flux USD de liquidations EXÉCUTÉES agrégées
 * par l'intervalle du chart (`liquidation-history`, perp Binance via le proxy) :
 *   shorts  : volume de positions SHORT liquidées (histogramme positif, --up)
 *   longs   : volume de positions LONG liquidées, affiché en NÉGATIF (--down)
 *   net     : shorts − longs (ligne) — le solde du flux forcé
 *
 * Séries aux `liqLongUsd` / `liqShortUsd` (fetch à l'intervalle du chart, apparié
 * 1:1). Requiert une clé Coinalyze — l'indicateur est UNUSABLE sans elle
 * (cf. lib/indicatorUsability.ts).
 */
import type { IndicatorDef } from "@axiom/types";

export const liqParBougie: IndicatorDef = {
  id: "liqParBougie",
  name: "Liquidations par bougie (Coinalyze)",
  category: "derivatives",
  pane: "separate",
  aux: ["liqLongUsd", "liqShortUsd"],
  precision: 0,
  inputs: [],
  outputs: [
    { key: "shorts", name: "Shorts liquidés", style: "histogram", color: "--up" },
    { key: "longs", name: "Longs liquidés", style: "histogram", color: "--down" },
    { key: "net", name: "Net (shorts − longs)", style: "line" },
  ],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const shorts: Array<number | undefined> = new Array(n).fill(undefined);
    const longs: Array<number | undefined> = new Array(n).fill(undefined);
    const net: Array<number | undefined> = new Array(n).fill(undefined);
    const l = ctx.aux?.liqLongUsd;
    const s = ctx.aux?.liqShortUsd;
    if (!l && !s) return { series: { shorts, longs, net } };
    for (let i = 0; i < n; i++) {
      const lv = l?.[i];
      const sv = s?.[i];
      const long = lv !== undefined && Number.isFinite(lv) ? lv : 0;
      const short = sv !== undefined && Number.isFinite(sv) ? sv : 0;
      if (lv === undefined && sv === undefined) continue;
      shorts[i] = short;
      // Convention : longs liquidés sous l'axe (pression vendeuse). `0 - long` sur
      // long = 0 produirait −0 (faux zéro qui casse `toEqual` et les min/max).
      longs[i] = long === 0 ? 0 : -long;
      net[i] = short - long;
    }
    return { series: { shorts, longs, net } };
  },
};
