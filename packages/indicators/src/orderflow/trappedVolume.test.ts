import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { trappedVolume } from "./trappedVolume";

function c(partial: Partial<Candle> & Pick<Candle, "time" | "close">): Candle {
  return {
    open: partial.close,
    high: partial.close,
    low: partial.close,
    volume: 0,
    ...partial,
  };
}

const ctx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("trappedVolume", () => {
  it("undefined tant que la fenêtre n'est pas pleine", () => {
    const candles = [
      c({ time: 1, close: 100, high: 100, low: 90, volume: 10, buyVolume: 6, sellVolume: 4 }),
      c({ time: 2, close: 100, high: 100, low: 90, volume: 10, buyVolume: 6, sellVolume: 4 }),
    ];
    const { series } = trappedVolume.calc(candles, { length: 3 }, ctx);
    expect(series.trappedLong).toEqual([undefined, undefined]);
    expect(series.trappedShort).toEqual([undefined, undefined]);
  });

  it("au nord : seul le volume ACHETEUR agressif traité au-dessus du close courant compte", () => {
    // Fenêtre pleine à i=2, close courant 95 : les deux barres [100,110] sont
    // entièrement au-dessus → tout leur buyVolume = longs piégés (60 + 30) ;
    // leur sellVolume, lui, a des acheteurs makers en face — il ne compte pas
    // au nord. La barre courante [94,96] est coupée en 2 : 8 × 0,5 = 4.
    const candles = [
      c({ time: 1, close: 105, high: 110, low: 100, volume: 100, buyVolume: 60, sellVolume: 40 }),
      c({ time: 2, close: 105, high: 110, low: 100, volume: 50, buyVolume: 30, sellVolume: 20 }),
      c({ time: 3, close: 95, high: 96, low: 94, volume: 20, buyVolume: 8, sellVolume: 12 }),
    ];
    const { series } = trappedVolume.calc(candles, { length: 3 }, ctx);
    expect(series.trappedLong?.[2]).toBeCloseTo(94);
    // Au sud : seul le sellVolume compte → 12 × 0,5 = 6 (c1/c2 n'ont rien sous 95).
    expect(series.trappedShort?.[2]).toBeCloseTo(-6);
  });

  it("au sud : seul le volume VENDEUR agressif sous le close courant compte", () => {
    // Close courant 120 : les deux barres [100,110] sont entièrement en-dessous
    // → tout leur sellVolume = shorts piégés (40 + 20) ; la barre courante
    // [118,122] est coupée en 2 : 12 × 0,5 = 6 au sud, 8 × 0,5 = 4 au nord.
    const candles = [
      c({ time: 1, close: 105, high: 110, low: 100, volume: 100, buyVolume: 60, sellVolume: 40 }),
      c({ time: 2, close: 105, high: 110, low: 100, volume: 50, buyVolume: 30, sellVolume: 20 }),
      c({ time: 3, close: 120, high: 122, low: 118, volume: 20, buyVolume: 8, sellVolume: 12 }),
    ];
    const { series } = trappedVolume.calc(candles, { length: 3 }, ctx);
    expect(series.trappedLong?.[2]).toBeCloseTo(4);
    expect(series.trappedShort?.[2]).toBeCloseTo(-66);
  });

  it("ne compte jamais le volume total deux fois", () => {
    const candles = [
      c({ time: 1, close: 100, high: 110, low: 90, volume: 40, buyVolume: 25, sellVolume: 15 }),
      c({ time: 2, close: 100, high: 110, low: 90, volume: 40, buyVolume: 25, sellVolume: 15 }),
      c({ time: 3, close: 100, high: 110, low: 90, volume: 40, buyVolume: 25, sellVolume: 15 }),
    ];
    const { series } = trappedVolume.calc(candles, { length: 3 }, ctx);
    // P = 100, milieu de [90,110] → moitié au-dessus : 25×0,5×3 au nord,
    // 15×0,5×3 au sud. 60 < Σ volume 120 : le volume maker n'est jamais compté.
    expect(series.trappedLong?.[2]).toBeCloseTo(37.5);
    expect(series.trappedShort?.[2]).toBeCloseTo(-22.5);
    const totalPiege = (series.trappedLong?.[2] ?? 0) + Math.abs(series.trappedShort?.[2] ?? 0);
    expect(totalPiege).toBeLessThan(120);
  });

  it("RÉGRESSION : au plus haut de la fenêtre, |shorts| = Σ volume VENDEUR, pas Σ volume", () => {
    // Ancien bug : au plus haut 24 h, 100 % du volume de la fenêtre était
    // déclaré « shorts piégés ». Ici la dernière barre clôture au-dessus de
    // tous les highs précédents → fracAbove = 0 partout → longs = 0 et
    // |shorts| = 70 + 60 + 50 = 180, strictement sous le volume total (300).
    const candles = [
      c({ time: 1, close: 95, high: 100, low: 90, volume: 100, buyVolume: 30, sellVolume: 70 }),
      c({ time: 2, close: 102, high: 105, low: 98, volume: 100, buyVolume: 40, sellVolume: 60 }),
      c({ time: 3, close: 120, high: 120, low: 110, volume: 100, buyVolume: 50, sellVolume: 50 }),
    ];
    const { series } = trappedVolume.calc(candles, { length: 3 }, ctx);
    expect(series.trappedLong?.[2]).toBeCloseTo(0);
    expect(series.trappedShort?.[2]).toBeCloseTo(-180);
    expect(Math.abs(series.trappedShort?.[2] ?? 0)).toBeLessThan(300);
  });

  it("bougie sans split : ignorée ; fenêtre sans aucun split : undefined", () => {
    const sansSplit = [
      c({ time: 1, close: 105, high: 110, low: 100, volume: 100 }),
      c({ time: 2, close: 105, high: 110, low: 100, volume: 50 }),
      c({ time: 3, close: 95, high: 96, low: 94, volume: 20 }),
    ];
    const resSans = trappedVolume.calc(sansSplit, { length: 3 }, ctx);
    expect(resSans.series.trappedLong?.[2]).toBeUndefined();
    expect(resSans.series.trappedShort?.[2]).toBeUndefined();

    // Une SEULE bougie sans split (au milieu) : ignorée comme un trou —
    // le calcul est celui du cas « au nord » avec c2 retirée :
    // longs = 60 (c1 tout au-dessus) + 8×0,5 (c3) = 64 ; shorts = −(12×0,5) = −6.
    const avecTrou = [
      c({ time: 1, close: 105, high: 110, low: 100, volume: 100, buyVolume: 60, sellVolume: 40 }),
      c({ time: 2, close: 105, high: 110, low: 100, volume: 50 }),
      c({ time: 3, close: 95, high: 96, low: 94, volume: 20, buyVolume: 8, sellVolume: 12 }),
    ];
    const resTrou = trappedVolume.calc(avecTrou, { length: 3 }, ctx);
    expect(resTrou.series.trappedLong?.[2]).toBeCloseTo(64);
    expect(resTrou.series.trappedShort?.[2]).toBeCloseTo(-6);
  });

  it("ignore un trou de bougie (undefined) dans la fenêtre", () => {
    // c2 est undefined (trou de données) : ignorée comme une bougie sans split.
    // Le calcul est donc celui du cas « au nord » avec c1 et c3 seules :
    // longs = 60 (c1 [100,110] tout au-dessus du close 95) + 8×0,5 (c3 coupée)
    // = 64 ; shorts = −(12×0,5) = −6.
    const candles = [
      c({ time: 1, close: 105, high: 110, low: 100, volume: 100, buyVolume: 60, sellVolume: 40 }),
      undefined,
      c({ time: 3, close: 95, high: 96, low: 94, volume: 20, buyVolume: 8, sellVolume: 12 }),
    ] as Candle[];
    const { series } = trappedVolume.calc(candles, { length: 3 }, ctx);
    expect(series.trappedLong?.[2]).toBeCloseTo(64);
    expect(series.trappedShort?.[2]).toBeCloseTo(-6);
  });

  it("bougie-point (high = low) : tout-ou-rien, appliqué au split", () => {
    const candles = [
      c({ time: 1, close: 105, high: 105, low: 105, volume: 30, buyVolume: 20, sellVolume: 10 }),
      c({ time: 2, close: 105, high: 105, low: 105, volume: 30, buyVolume: 20, sellVolume: 10 }),
      c({ time: 3, close: 100, high: 100, low: 100, volume: 10, buyVolume: 4, sellVolume: 6 }),
    ];
    const { series } = trappedVolume.calc(candles, { length: 3 }, ctx);
    // 105 > 100 → les deux points sont entièrement au nord : 20×2 = 40 de
    // buyVolume piégé. Le point courant : low = P → fracAbove 0 → tout le
    // sellVolume (6) compte au sud.
    expect(series.trappedLong?.[2]).toBeCloseTo(40);
    expect(series.trappedShort?.[2]).toBeCloseTo(-6);
  });

  it("glisse la fenêtre : une barre sortie de la fenêtre ne compte plus", () => {
    const candles = [
      c({ time: 1, close: 105, high: 110, low: 100, volume: 100, buyVolume: 60, sellVolume: 40 }), // sort à i=2
      c({ time: 2, close: 105, high: 110, low: 100, volume: 50, buyVolume: 30, sellVolume: 20 }),
      c({ time: 3, close: 95, high: 96, low: 94, volume: 20, buyVolume: 8, sellVolume: 12 }),
    ];
    const { series } = trappedVolume.calc(candles, { length: 2 }, ctx);
    // À i=2, fenêtre = barres 1..2, P = 95 : barre 1 [100,110] tout au nord
    // → buyVolume 30 ; barre 2 [94,96] coupée → 8×0,5 = 4 au nord, 12×0,5 = 6
    // au sud. La barre 0 (60 de buyVolume au nord) est exclue.
    expect(series.trappedLong?.[2]).toBeCloseTo(34);
    expect(series.trappedShort?.[2]).toBeCloseTo(-6);
    // À i=1, fenêtre = barres 0..1, P = 105 : chaque barre [100,110] est coupée
    // en 2 → buyVolume (60+30)×0,5 = 45 au nord, sellVolume (40+20)×0,5 = 30
    // au sud.
    expect(series.trappedLong?.[1]).toBeCloseTo(45);
    expect(series.trappedShort?.[1]).toBeCloseTo(-30);
  });
});
