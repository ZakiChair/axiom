/**
 * @axiom/indicators — strategy/stratIchimokuKumo.ts
 *
 * Stratégie Ichimoku kumo (long/short) : close au-dessus du nuage (max de
 * spanA/spanB) → long, close en dessous (min de spanA/spanB) → short, close
 * DANS le nuage → flat. `spanA`/`spanB` sont déjà décalés comme tracés (le
 * nuage à la bougie i est `spanA[i]`/`spanB[i]`) ; displacement standard =
 * valeur `kijun`, comme le def `ichimoku`. Rendu par defStrategie.
 *
 * Résultats de backtest : voir docs/superpowers/research/2026-07-28-backtest-strategies.md
 * (campagne §Task 6) — mesures passées, hors frais, PAS une promesse (formule
 * d'honnêteté du spec v2.3 §2).
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { ichimokuOf } from "../trend/ichimoku";

export const stratIchimokuKumo = defStrategie({
  id: "stratIchimokuKumo",
  name: "Stratégie Ichimoku kumo",
  inputsStrategie: [
    { key: "tenkan", name: "Tenkan", type: "number", default: 9, min: 1 },
    { key: "kijun", name: "Kijun", type: "number", default: 26, min: 1 },
    { key: "senkouB", name: "Senkou B", type: "number", default: 52, min: 1 },
  ],
  position: (candles, params, ctx) => {
    // displacement standard = valeur kijun (26 par défaut), comme le def ichimoku.
    const kijun = Number(params.kijun ?? 26);
    const r = ichimokuOf(candles, Number(params.tenkan ?? 9), kijun, Number(params.senkouB ?? 52), kijun);
    return ctx.source.map((c, i): EtatStrategie | undefined => {
      const a = r.spanA[i];
      const b = r.spanB[i];
      if (a === undefined || b === undefined || c === undefined) return undefined;
      const haut = Math.max(a, b);
      const bas = Math.min(a, b);
      return c > haut ? 1 : c < bas ? -1 : 0; // dans le nuage → flat
    });
  },
  libelles: (params) => ({
    long: `close au-dessus du nuage Ichimoku (${params.tenkan}/${params.kijun}/${params.senkouB})`,
    short: `close sous le nuage Ichimoku (${params.tenkan}/${params.kijun}/${params.senkouB})`,
    sortie: "retour dans/à travers le nuage",
  }),
});
