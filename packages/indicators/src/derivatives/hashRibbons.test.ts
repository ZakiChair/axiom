/** Hash Ribbons : SMA à trous, ratio SMAc/SMAl (≈ 1), régime (−1 / +1 × 10 barres). */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { hashRibbons, smaAux } from "./hashRibbons";

const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: i, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
const ctx = (hashrate: Array<number | undefined>) =>
  ({ hl2: [], hlc3: [], ohlc4: [], source: [], aux: { hashrate } });

describe("smaAux — fenêtre à trous", () => {
  it("ignore les undefined ; fenêtre incomplète → undefined", () => {
    const s = smaAux([1, undefined, 3, 4, 5], 3);
    // i=2 : fenêtre [1, undef, 3] → 2 définis < 3 → undefined ; i=3 : [undef,3,4] idem.
    expect(s[2]).toBeUndefined();
    expect(s[3]).toBeUndefined();
    // i=4 : fenêtre [3,4,5] complète → 4.
    expect(s[4]).toBe(4);
  });
  it("longueur > série → tout undefined", () => {
    expect(smaAux([1, 2], 5)).toEqual([undefined, undefined]);
  });
});

describe("hashRibbons — ratio", () => {
  it("série constante → ratio = 1 exactement, regime 0 (jamais de croisement)", () => {
    const serie = new Array(80).fill(5e20); // échelle H/s réelle — le ratio l'absorbe.
    const r = hashRibbons.calc(candles(80), { courte: 5, longue: 10 }, ctx(serie));
    expect(r.series.ratio?.[79]).toBe(1);
    expect(r.series.regime?.[79]).toBe(0);
  });

  it("ratio < 1 ⇔ regime −1 (série décroissante = capitulation)", () => {
    const serie = Array.from({ length: 80 }, (_, i) => 100 - i);
    const r = hashRibbons.calc(candles(80), { courte: 5, longue: 10 }, ctx(serie));
    expect(r.series.ratio?.[79]).toBeLessThan(1);
    expect(r.series.regime?.[79]).toBe(-1);
    // Les premières barres (fenêtre longue incomplète) restent undefined.
    expect(r.series.ratio?.[8]).toBeUndefined();
    expect(r.series.regime?.[8]).toBeUndefined();
  });

  it("croisement haussier → +1 pendant 10 barres puis 0 ; ratio repasse > 1", () => {
    const serie = [
      ...Array.from({ length: 40 }, (_, i) => 100 - i), // capitulation
      ...Array.from({ length: 40 }, (_, i) => 60 + i * 10), // reprise violente
    ];
    const r = hashRibbons.calc(candles(80), { courte: 5, longue: 10 }, ctx(serie));
    const regime = r.series.regime ?? [];
    const ratio = r.series.ratio ?? [];
    const idxPlus1 = regime.map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0);
    expect(idxPlus1.length).toBeGreaterThan(0);
    expect(idxPlus1.length).toBeLessThanOrEqual(10);
    // Pendant la reprise le ratio est > 1 ; la toute fin retombe à regime 0.
    expect(ratio[idxPlus1[0] ?? 0]).toBeGreaterThan(1);
    expect(regime[79]).toBe(0);
    expect(ratio[79]).toBeGreaterThan(1);
  });

  it("aux absent → séries all-undefined", () => {
    const r = hashRibbons.calc(candles(3), {}, { hl2: [], hlc3: [], ohlc4: [], source: [] });
    expect(r.series.ratio).toEqual([undefined, undefined, undefined]);
    expect(r.series.regime).toEqual([undefined, undefined, undefined]);
  });
});
