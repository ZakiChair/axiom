import { describe, expect, it } from "vitest";
import { calculerDispersionFunding, fundingDispersion } from "./fundingDispersion";

const PAR_APR = 24 * 365 * 100;

describe("dispersion de funding, cohorte fixe quatre venues", () => {
  it("la variance d'APR extrême reste finie lorsque le résultat est représentable", () => {
    const r = calculerDispersionFunding([1e200, 0, 0, 0]);
    expect(r.knownCount).toBe(4);
    expect(Number.isFinite(r.sigma)).toBe(true);
    expect(r.sigma! / (1e200 * PAR_APR)).toBeCloseTo(Math.sqrt(3) / 4, 12);
  });
  it("APR débordant reste inconnu, y compris dans le compte des venues", () => {
    expect(calculerDispersionFunding([1e308, 1e308, 1e308, 1e308])).toEqual({
      knownCount: 0, sigma: undefined, min: undefined, max: undefined,
    });
  });
  it("oracle APR [0,2,4,6] : sigma √5, min 0, max 6", () => {
    const r = calculerDispersionFunding([0, 2 / PAR_APR, 4 / PAR_APR, 6 / PAR_APR]);
    expect(r.sigma).toBeCloseTo(Math.sqrt(5), 12);
    expect(r.min).toBeCloseTo(0, 12);
    expect(r.max).toBeCloseTo(6, 12);
    expect(r.knownCount).toBe(4);
  });

  it("une venue manquante interdit sigma/min/max et n'est pas remplacée par zéro", () => {
    expect(calculerDispersionFunding([0, 0, undefined, 0])).toEqual({ sigma: undefined, min: undefined, max: undefined, knownCount: 3 });
    expect(calculerDispersionFunding([0, 0, 0, 0]).sigma).toBe(0);
  });

  it("le def ne trace pas le nombre de venues sur l'axe APR", () => {
    const candle = [{ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
    const r = fundingDispersion.calc(candle, {}, { hl2: [], hlc3: [], ohlc4: [], source: [], aux: {
      fundingHistBinance: [0], fundingHistBybit: [0], fundingHistOkx: [0], fundingHistHl: [0],
    } });
    expect(Object.keys(r.series).sort()).toEqual(["max", "min", "sigma"]);
    expect(r.series.sigma).toEqual([0]);
  });
  it("un trou terminal garde le diagnostic 0/4 ancré sur la dernière valeur tracée", () => {
    const candles = [0, 1].map((time) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
    const r = fundingDispersion.calc(candles, {}, { hl2: [], hlc3: [], ohlc4: [], source: [], aux: {
      fundingHistBinance: [25 / PAR_APR, undefined], fundingHistBybit: [100 / PAR_APR, undefined],
      fundingHistOkx: [100 / PAR_APR, undefined], fundingHistHl: [100 / PAR_APR, undefined],
    } });
    expect(r.series.sigma?.[1]).toBeUndefined();
    expect(r.annotations?.labels?.[0]).toMatchObject({ idx: 1, texte: "0/4 venues", ancrageY: "haut-pane" });
  });
});
