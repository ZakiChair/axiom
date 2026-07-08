/**
 * @axiom/indicators — derivatives/fundingZScore.test.ts
 *
 * Funding Z-Score : z[i] = (funding[i] - mean(fenêtre)) / stdev(fenêtre) sur les
 * `window` derniers points DÉFINIS de ctx.aux.funding. `undefined` tant que
 * moins de `window` points définis ne sont disponibles en remontant depuis i.
 *
 * Valeurs choisies pour un calcul exact en flottant : 0.25 = 1/4, exactement
 * représentable en binaire (comme ses puissances), donc somme/moyenne/variance
 * sur des copies identiques sont exactes (pas de bruit flottant) — voir
 * hand-calc ci-dessous pour le test du pic.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { fundingZScore } from "./fundingZScore";

function candle(): Candle {
  return { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 };
}

function candles(n: number): Candle[] {
  return new Array(n).fill(0).map(candle);
}

const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("fundingZScore", () => {
  it("ctx.aux absent → série entièrement undefined, jamais de throw", () => {
    const c = candles(35);
    expect(() => fundingZScore.calc(c, { window: 30 }, baseCtx)).not.toThrow();
    const res = fundingZScore.calc(c, { window: 30 }, baseCtx);
    expect(res.series.fundingZScore).toEqual(new Array(35).fill(undefined));
  });

  it("ctx.aux.funding absent (autre clé présente) → série entièrement undefined", () => {
    const c = candles(35);
    const res = fundingZScore.calc(c, { window: 30 }, { ...baseCtx, aux: { oi: new Array(35).fill(1) } });
    expect(res.series.fundingZScore).toEqual(new Array(35).fill(undefined));
  });

  it("35 points constants → undefined avant le 30e point (fenêtre incomplète), z=0 à partir du 30e (index 29)", () => {
    const c = candles(35);
    const funding = new Array(35).fill(0.25);
    const res = fundingZScore.calc(c, { window: 30 }, { ...baseCtx, aux: { funding } });
    // idx 0..28 (29 points) : < 30 points définis dispo → undefined
    // idx 29..34 : 30 points constants → mean = valeur, stdev = 0 → z = 0 (garde 0/0)
    const expected: Array<number | undefined> = new Array(35).fill(undefined);
    for (let i = 29; i < 35; i++) expected[i] = 0;
    expect(res.series.fundingZScore).toEqual(expected);
  });

  it("pic isolé sur fond constant → z(dernier point) = sqrt(29) (calcul à la main vérifié)", () => {
    // 35 points : indices 0..33 = 0.25 (constant), index 34 = 1.25 (pic).
    // Fenêtre de 30 se terminant à l'index 34 = indices 5..34 :
    //   29 copies de 0.25 + 1 copie de 1.25.
    //   sum = 29*0.25 + 1.25 = 8.5 ; mean = 8.5/30
    //   sumSq = 29*0.0625 + 1.5625 = 3.375
    //   variance (population, /30) = (3.375 - 8.5^2/30) / 30 = (3.375 - 2.408333...) / 30
    //                               = 0.966666.../30 = 0.032222...
    //   stdev = sqrt(0.032222...) ; numérateur = 1.25 - mean = 0.966666...
    //   z = 0.966666.../stdev = sqrt(29) ≈ 5.385164807134504
    //   (propriété générale : pour n-1 valeurs égales à c et 1 valeur à c+d dans
    //   une fenêtre de taille n, le z-score du point isolé vaut toujours
    //   sqrt(n-1), indépendamment de c et d — ici n=30 → sqrt(29).)
    const c = candles(35);
    const funding = new Array(35).fill(0.25);
    funding[34] = 1.25;
    const res = fundingZScore.calc(c, { window: 30 }, { ...baseCtx, aux: { funding } });
    const z = res.series.fundingZScore?.[34];
    expect(z).toBeDefined();
    expect(z as number).toBeCloseTo(Math.sqrt(29), 9);
    // Points antérieurs à la fenêtre incomplète toujours undefined.
    expect(res.series.fundingZScore?.[28]).toBeUndefined();
  });

  it("window par défaut = 30 si non fourni", () => {
    const c = candles(35);
    const funding = new Array(35).fill(0.25);
    const res = fundingZScore.calc(c, {}, { ...baseCtx, aux: { funding } });
    expect(res.series.fundingZScore?.[28]).toBeUndefined();
    expect(res.series.fundingZScore?.[29]).toBe(0);
  });

  it("métadonnées conformes", () => {
    expect(fundingZScore.id).toBe("fundingZScore");
    expect(fundingZScore.category).toBe("derivatives");
    expect(fundingZScore.pane).toBe("separate");
    expect(fundingZScore.aux).toEqual(["funding"]);
    expect(fundingZScore.minTimeframe).toBe("1h");
    expect(fundingZScore.inputs).toEqual([
      { key: "window", name: expect.any(String), type: "number", default: 30, min: 5, max: 500 },
    ]);
  });
});
