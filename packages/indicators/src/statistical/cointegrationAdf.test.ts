import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { cointegrationAdf, SEUIL_EG_5PCT } from "./cointegrationAdf";
import { spreadHalfLife } from "./spreadHalfLife";

/** Bougies dont la clôture est donnée ; les autres champs sont neutres. */
function bougies(closes: number[]): Candle[] {
  return closes.map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 1 }));
}

function ctx(candles: Candle[], ref: number[] | undefined) {
  return {
    hl2: [],
    hlc3: [],
    ohlc4: [],
    source: candles.map((c) => c.close),
    aux: ref === undefined ? undefined : { refClose: ref },
  };
}

/** LCG Numerical Recipes — bruit blanc déterministe (autocorrélation lag-1 ≈ 0). */
function genererBruit(): () => number {
  let seed = 123456789;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296 - 0.5) * 0.004;
  };
}

/**
 * ln(ref) est une rampe douce ; ln(close) = ln(ref) + e avec
 * e_i = rho·e_{i−1} + bruit blanc. rho = 0,8 ⇒ demi-vie théorique 3,1 barres ;
 * rho = 1 ⇒ marche aléatoire (aucun retour à la moyenne).
 */
function jeu(rho: number, n: number): { closes: number[]; ref: number[] } {
  const bruit = genererBruit();
  const closes: number[] = [];
  const ref: number[] = [];
  let e = 0;
  for (let i = 0; i < n; i++) {
    e = rho * e + bruit();
    const x = Math.log(100) + 0.01 * i;
    ref.push(Math.exp(x));
    closes.push(Math.exp(x + e));
  }
  return { closes, ref };
}

describe("cointegrationAdf", () => {
  it("sans référence : aucune valeur, le repère reste tracé", () => {
    const candles = bougies(Array.from({ length: 60 }, (_, i) => 100 + i));
    const { series } = cointegrationAdf.calc(candles, { length: 40, lags: 1 }, ctx(candles, undefined));
    expect(series.t?.every((v) => v === undefined)).toBe(true);
    expect(series.seuil?.[59]).toBe(SEUIL_EG_5PCT);
  });

  it("spread AR(1) ρ = 0,8 : t sous la valeur critique d'Engle-Granger (5 %)", () => {
    const { closes, ref } = jeu(0.8, 200);
    const candles = bougies(closes);
    const { series } = cointegrationAdf.calc(candles, { length: 150, lags: 1 }, ctx(candles, ref));
    const t = series.t?.[199];
    expect(t).toBeDefined();
    expect(t!).toBeLessThan(SEUIL_EG_5PCT);
  });

  it("marche aléatoire (ρ = 1) : aucun faux positif — t au-dessus du repère", () => {
    const { closes, ref } = jeu(1, 200);
    const candles = bougies(closes);
    const { series } = cointegrationAdf.calc(candles, { length: 150, lags: 1 }, ctx(candles, ref));
    const t = series.t?.[199];
    expect(t === undefined || t > SEUIL_EG_5PCT).toBe(true);
  });

  it("référence plate : pente non identifiable, aucune valeur", () => {
    const { closes } = jeu(0.8, 200);
    const candles = bougies(closes);
    const ref = new Array<number>(200).fill(100);
    const { series } = cointegrationAdf.calc(candles, { length: 150, lags: 1 }, ctx(candles, ref));
    expect(series.t?.[199]).toBeUndefined();
  });
});

describe("spreadHalfLife", () => {
  it("spread AR(1) ρ = 0,8 : demi-vie de l'ordre de 2 à 4 barres et β proche de 1", () => {
    // Demi-vie théorique 3,1 barres ; l'estimation sur résidu est biaisée vers le bas
    // en échantillon fini (documenté dans utils-cointegration.ts).
    const { closes, ref } = jeu(0.8, 200);
    const candles = bougies(closes);
    const { series } = spreadHalfLife.calc(candles, { length: 150, lags: 1 }, ctx(candles, ref));
    const hl = series.hl?.[199];
    const beta = series.beta?.[199];
    expect(hl).toBeDefined();
    expect(hl!).toBeGreaterThan(1);
    expect(hl!).toBeLessThan(5);
    expect(beta).toBeDefined();
    expect(Math.abs(beta! - 1)).toBeLessThan(0.05);
  });

  it("marche aléatoire : demi-vie absente ou longue (aucun retour exploitable)", () => {
    const { closes, ref } = jeu(1, 200);
    const candles = bougies(closes);
    const { series } = spreadHalfLife.calc(candles, { length: 150, lags: 1 }, ctx(candles, ref));
    const hl = series.hl?.[199];
    expect(hl === undefined || hl > 5).toBe(true);
  });

  it("sans référence : aucune valeur", () => {
    const { closes } = jeu(0.8, 200);
    const candles = bougies(closes);
    const { series } = spreadHalfLife.calc(candles, { length: 150, lags: 1 }, ctx(candles, undefined));
    expect(series.hl?.[199]).toBeUndefined();
    expect(series.beta?.[199]).toBeUndefined();
  });
});
