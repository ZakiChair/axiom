/**
 * macdDivergence v2 — tests de CONTRAT + CÂBLAGE (même patron que
 * rsiDivergence.test.ts). La géométrie des annotations est dérivée à la main
 * dans utils-annotations.test.ts et le MACD dans macd.test.ts : ici on vérifie
 * que le def assemble bien ces briques hand-testées (comparaison aux fonctions
 * pures composées), plus un garde-fou anti-tautologie : la fixture produit
 * RÉELLEMENT une divergence (vérifié empiriquement en exécutant le code réel —
 * une rampe trop lente ne franchit pas les fenêtres fast/slow/signal par défaut,
 * d'où des périodes réduites ici pour raccourcir l'amorçage EMA).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { construireAnnotationsDivergence } from "../utils-annotations";
import { highOf, lowOf } from "../utils";
import { macdOf } from "../trend/macd";
import { macdDivergence } from "./macdDivergence";

/** Série linéaire par morceaux : coins aux points de contrôle, monotone entre eux. */
function rampe(n: number, points: ReadonlyArray<readonly [number, number]>): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let seg = 0;
    while (seg < points.length - 1 && points[seg + 1]![0] <= i) seg++;
    const a = points[seg]!;
    const b = points[seg + 1] ?? a;
    const t = b[0] === a[0] ? 0 : (i - a[0]) / (b[0] - a[0]);
    out.push(a[1] + t * (b[1] - a[1]));
  }
  return out;
}

/** Bougies minimales : high = close + 1, low = close − 1 (pivots de prix alignés sur les closes). */
function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  }));
}

describe("macdDivergence v2", () => {
  it("contrat : pane séparé, sortie unique osc, inputs osc + communs", () => {
    expect(macdDivergence.pane).toBe("separate");
    expect(macdDivergence.outputs).toEqual([{ key: "osc", name: "MACD", style: "line" }]);
    expect(macdDivergence.inputs.map((i) => i.key)).toEqual([
      "fast", "slow", "signal", "source", "oscSource", "gauche", "droite", "maxEcart", "cachees",
    ]);
  });

  it("câblage : série = macdOf(source, fast, slow, signal).macd, annotations = moteur commun sur la ligne MACD", () => {
    // Fixture éprouvée empiriquement (creux prix idx24 close 62, idx48 close 58 → LL ;
    // périodes réduites fast=3/slow=6/signal=2 pour que la ligne MACD réponde assez vite
    // et fasse un plus-bas plus HAUT → divergence haussière régulière avec les pivots
    // par défaut gauche/droite=5).
    const closes = rampe(60, [[0, 100], [10, 108], [24, 62], [36, 88], [48, 58], [59, 74]]);
    const candles = candlesFromCloses(closes);
    const params = { fast: 3, slow: 6, signal: 2 };
    const r = computeIndicator(macdDivergence, candles, params);
    const macdAttendu = macdOf(closes, 3, 6, 2).macd;
    expect(r.series["osc"]).toEqual(macdAttendu);
    // `?? {}` : la fabrique omet la clé `annotations` quand le moteur renvoie {}
    // — l'égalité doit tenir dans les deux cas (divergence présente ou non).
    const attendu = construireAnnotationsDivergence(highOf(candles), lowOf(candles), macdAttendu, {
      gauche: 5, droite: 5, maxEcart: 60, cachees: true, nomOsc: "MACD",
    });
    expect(r.annotations ?? {}).toEqual(attendu);
    // Garde-fou anti-tautologie : la fixture produit RÉELLEMENT une divergence
    // (sinon `attendu` serait {} et l'égalité ci-dessus passerait sans rien vérifier).
    expect(attendu.segments?.length ?? 0).toBeGreaterThan(0);
  });

  it("câblage : oscSource = histogramme bascule la série sur macdOf(...).hist", () => {
    const closes = rampe(60, [[0, 100], [10, 108], [24, 62], [36, 88], [48, 58], [59, 74]]);
    const candles = candlesFromCloses(closes);
    const params = { fast: 3, slow: 6, signal: 2, oscSource: "histogramme" };
    const r = computeIndicator(macdDivergence, candles, params);
    const histAttendu = macdOf(closes, 3, 6, 2).hist;
    expect(r.series["osc"]).toEqual(histAttendu);
  });
});
