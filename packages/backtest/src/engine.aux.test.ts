/**
 * @axiom/backtest — engine.aux.test.ts
 *
 * `ParamsBacktest.aux` : séries auxiliaires facultatives fournies par l'appelant,
 * alignées sur `candles` (10 octobre 2026). Le moteur reste pur — il ne fetch
 * jamais ; sans `aux`, les indicateurs calculent sans (AXIS : garde-fou de
 * régime non appliqué, condition de la v2). Vérifié : (1) un indicateur qui
 * lit `ctx.aux` change de sortie selon `params.aux` ; (2) sur la fixture dorée
 * d'AXIS (EMA de tendance 50), un `refClose` toujours sous sa propre EMA
 * supprime les entrées, un `refClose` toujours au-dessus laisse les trades
 * d'ouverture 61/108/281 identiques.
 */
import { describe, expect, it } from "vitest";
import type { Candle, IndicatorDef } from "@axiom/types";
import { getIndicator, INDICATORS } from "@axiom/indicators";
import fixtureRaw from "../../indicators/src/golden/fixture-ohlcv.json";
import { runBacktest } from "./engine";
import type { ParamsBacktest, StrategieDef } from "./types";

const fixture = fixtureRaw as Candle[];
const params: ParamsBacktest = { fraisPct: 0, slippagePct: 0, capitalInitial: 1000, timeframe: "4h" };
const axisEtat = { type: "indicateur" as const, indicateurId: "stratAxis", params: { emaTendance: 50 }, output: "etat" };
const stratAxis: StrategieDef = {
  direction: "long", tailleFixe: 100,
  reglesEntree: [{ type: "comparaison", gauche: axisEtat, comparateur: ">=", droite: { type: "constante", valeur: 1 } }],
  reglesSortie: [{ type: "comparaison", gauche: axisEtat, comparateur: "<=", droite: { type: "constante", valeur: 0 } }],
};

describe("ParamsBacktest.aux — séries auxiliaires facultatives", () => {
  it("un indicateur qui lit ctx.aux voit les séries passées par params.aux", () => {
    const testDef: IndicatorDef = {
      id: "testAuxLit", name: "t", category: "strategy", pane: "overlay",
      inputs: [], outputs: [{ key: "x", name: "x", style: "line" }],
      calc: (candles, _params, ctx) => ({
        series: { x: candles.map((_c, i) => ctx.aux?.refClose?.[i] ?? -1) },
      }),
    };
    INDICATORS.push(testDef);
    try {
      const strat: StrategieDef = {
        direction: "long", tailleFixe: 100,
        reglesEntree: [{ type: "comparaison", gauche: { type: "indicateur", indicateurId: "testAuxLit", params: {}, output: "x" }, comparateur: ">", droite: { type: "constante", valeur: 0 } }],
        reglesSortie: [],
      };
      const candles = fixture.slice(0, 10);
      const aux = { refClose: candles.map(() => 1) };
      // Avec aux : l'entrée « x > 0 » est vraie dès la première décision ; sans aux : jamais.
      const sans = runBacktest(candles, strat, params);
      const avec = runBacktest(candles, strat, { ...params, aux });
      expect(sans.trades).toHaveLength(0);
      expect(avec.trades.length).toBeGreaterThan(0);
    } finally {
      INDICATORS.pop();
    }
  });

  it("stratAxis : refClose toujours sous son EMA → aucun trade ; au-dessus → trades de la v2 (61/108/281)", () => {
    const sans = runBacktest(fixture, stratAxis, params);
    // Fills à l'open de la bougie suivant le signal (61, 108, 281) — voir backtest-indicateurs.test.ts.
    expect(sans.trades.map((t) => t.tempsEntree)).toEqual([fixture[61]!.time, fixture[108]!.time, fixture[281]!.time]);
    const dessous = { refClose: fixture.map((_c, i) => 5000 - i) };
    const dessus = { refClose: fixture.map((_c, i) => 1000 + i * 10) };
    // EMA 100 de la référence amorcée à i=99 : le seul trade conservé est celui de 61
    // (décision avant l'amorce → garde-fou non appliqué) ; 108 et 281 sont refusés.
    const refRefusee = runBacktest(fixture, stratAxis, { ...params, aux: dessous }).trades;
    expect(refRefusee.map((t) => t.tempsEntree)).toEqual([fixture[61]!.time]);
    expect(runBacktest(fixture, stratAxis, { ...params, aux: dessus }).trades.map((t) => t.tempsEntree))
      .toEqual(sans.trades.map((t) => t.tempsEntree));
    expect(getIndicator("stratAxis")?.auxFacultatives).toEqual(["oi", "refClose"]);
  });
});
