/**
 * @axiom/indicators — derivatives/fundingNotional.ts
 *
 * Funding notionnel (funding × OI) — flux monétaire approximatif transféré à chaque
 * fenêtre de funding : pondère le TAUX de funding par l'open interest en USD, pour
 * distinguer un funding élevé sur marché fin (peu significatif) d'un funding élevé
 * adossé à un OI massif (positionnement réellement encombré).
 *
 *   notional[i] = funding[i] · oi[i]   (USD)
 * `funding` = taux (série aux Coinalyze), `oi` = open interest en USD (série aux).
 * Signe = côté qui paie : > 0 longs paient (crowded long), < 0 shorts paient.
 * `undefined` si l'une des deux séries manque à l'index. PURE (lecture de ctx.aux).
 */

import type { IndicatorDef } from "@axiom/types";

export const fundingNotional: IndicatorDef = {
  id: "fundingNotional",
  name: "Funding notionnel (funding × OI)",
  category: "derivatives",
  pane: "separate",
  aux: ["funding", "oi"],
  minTimeframe: "1h",
  precision: 0,
  inputs: [],
  outputs: [{ key: "fundingNotional", name: "Funding × OI", style: "histogram" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const funding = ctx.aux?.funding;
    const oi = ctx.aux?.oi;
    if (!funding || !oi) return { series: { fundingNotional: out } };

    for (let i = 0; i < n; i++) {
      const f = funding[i];
      const o = oi[i];
      if (f === undefined || o === undefined || !Number.isFinite(f) || !Number.isFinite(o)) continue;
      out[i] = f * o;
    }
    return { series: { fundingNotional: out } };
  },
};
