/**
 * @axiom/indicators — derivatives/hlWhalesNet.ts
 *
 * Positionnement net des gros comptes HL (%) — par instantané du collecteur daemon
 * (`/hl/liqheat`) : `100 × (longUsd − shortUsd) / (longUsd + shortUsd)`, donc
 * borné [−100, +100] ; −100 = échantillon entièrement short.
 *
 * ⚠️ ÉCHANTILLON : le daemon ne suit que le top du leaderboard Hyperliquid
 * (~470 adresses), jamais le marché entier — la couverture OI mesurée est affichée
 * par la légende LIQHL. Sans daemon / sans collecte → série vide (UNUSABLE via
 * lib/indicatorUsability.ts).
 */
import type { IndicatorDef } from "@axiom/types";

export const hlWhalesNet: IndicatorDef = {
  id: "hlWhalesNet",
  name: "Positionnement net gros comptes HL (%)",
  category: "derivatives",
  pane: "separate",
  aux: ["hlWhalesNet"],
  precision: 1,
  inputs: [],
  outputs: [{ key: "net", name: "Net longs − shorts (%)", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const serie = ctx.aux?.hlWhalesNet;
    if (serie) {
      for (let i = 0; i < n; i++) {
        const v = serie[i];
        if (v !== undefined && Number.isFinite(v)) out[i] = Math.max(-100, Math.min(100, v));
      }
    }
    return { series: { net: out } };
  },
};
