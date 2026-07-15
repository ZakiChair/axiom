/**
 * @axiom/indicators — trend/gmma.ts
 *
 * GMMA (Guppy Multiple Moving Average) — deux faisceaux d'EMA superposés au prix :
 *   - COURT terme (traders)      : EMA 3, 5, 8, 10, 12, 15 ;
 *   - LONG terme (investisseurs) : EMA 30, 35, 40, 45, 50, 60.
 * L'écartement/compression entre les deux faisceaux révèle la force et les
 * retournements de tendance (croisement des faisceaux = changement de régime).
 *
 * Overlay, 12 lignes. Réutilise `ema` (utils, source unique) — aucune math dupliquée.
 */

import type { Candle, CalcContext, IndicatorDef, IndicatorResult } from "@axiom/types";
import { ema } from "../utils";

const COURT = [3, 5, 8, 10, 12, 15];
const LONG = [30, 35, 40, 45, 50, 60];

export const gmma: IndicatorDef = {
  id: "gmma",
  name: "GMMA (Guppy)",
  category: "trend",
  pane: "overlay",
  inputs: [],
  outputs: [
    ...COURT.map((p) => ({ key: `s${p}`, name: `EMA ${p}`, style: "line" as const })),
    ...LONG.map((p) => ({ key: `l${p}`, name: `EMA ${p}`, style: "line" as const })),
  ],
  calc(_candles: Candle[], _params: Record<string, number | boolean | string>, ctx: CalcContext): IndicatorResult {
    const src = ctx.source;
    const series: Record<string, Array<number | undefined>> = {};
    for (const p of COURT) series[`s${p}`] = ema(src, p);
    for (const p of LONG) series[`l${p}`] = ema(src, p);
    return { series };
  },
};
