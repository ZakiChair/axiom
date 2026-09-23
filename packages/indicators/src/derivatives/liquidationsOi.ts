/** Intensité des liquidations — flux USD exact rapporté à l'OI USD à l'ouverture. */
import type { IndicatorDef } from "@axiom/types";

export const liquidationsOi: IndicatorDef = {
  id: "liquidationsOi",
  name: "Intensité des liquidations — % de l'OI initial",
  category: "derivatives",
  pane: "separate",
  aux: ["liqLongUsd", "liqShortUsd", "oiDebutLiqUsd"],
  precision: 2,
  inputs: [],
  outputs: [
    { key: "longs", name: "Longs liquidés / OI (%)", style: "histogram", color: "--down" },
    { key: "shorts", name: "Shorts liquidés / OI (%)", style: "histogram", color: "--up" },
    { key: "total", name: "Total / OI (%)", style: "line" },
    { key: "net", name: "Net shorts − longs / OI (%)", style: "line" },
  ],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const longs: Array<number | undefined> = Array(n).fill(undefined);
    const shorts: Array<number | undefined> = Array(n).fill(undefined);
    const total: Array<number | undefined> = Array(n).fill(undefined);
    const net: Array<number | undefined> = Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const oi = ctx.aux?.oiDebutLiqUsd?.[i];
      if (oi === undefined || !Number.isFinite(oi) || oi <= 0) continue;
      const l = ctx.aux?.liqLongUsd?.[i];
      const s = ctx.aux?.liqShortUsd?.[i];
      const lValide = l !== undefined && Number.isFinite(l) && l >= 0;
      const sValide = s !== undefined && Number.isFinite(s) && s >= 0;
      if (lValide) {
        const pct = 100 * (l / oi);
        if (Number.isFinite(pct)) longs[i] = pct === 0 ? 0 : -pct;
      }
      if (sValide) {
        const pct = 100 * (s / oi);
        if (Number.isFinite(pct)) shorts[i] = pct;
      }
      if (lValide && sValide) {
        const totalPct = 100 * (l / oi + s / oi);
        const netPct = 100 * ((s - l) / oi);
        if (Number.isFinite(totalPct)) total[i] = totalPct;
        if (Number.isFinite(netPct)) net[i] = netPct;
      }
    }
    return { series: { longs, shorts, total, net } };
  },
};
