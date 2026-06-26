/**
 * Tests VWAP — valeurs de référence calculées À LA MAIN depuis la formule.
 *
 * Prix typique tp = hlc3 = (high + low + close) / 3 (construit par le moteur).
 * VWAP cumulative : vwap[i] = Σ(tp*vol)[0..i] / Σ(vol)[0..i].
 *
 * Jeu déterministe (4 bougies). La bougie 0 a un volume nul -> démarrage :
 * volume cumulé = 0, VWAP non définie (undefined).
 *
 *   i | high low close |  tp | vol | cumTPV               | cumVol | vwap
 *   --+----------------+-----+-----+----------------------+--------+----------------
 *   0 |  10  10   10   |  10 |   0 | 0                    |   0    | undefined
 *   1 |  12  10   11   |  11 |  10 | 11*10 = 110          |  10    | 110/10 = 11
 *   2 |  14  12   13   |  13 |  20 | 110 + 13*20 = 370    |  30    | 370/30 = 12.33333
 *   3 |  16  14   15   |  15 |  30 | 370 + 15*30 = 820    |  60    | 820/60 = 13.66667
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { vwap } from "./vwap";

/** Fabrique une bougie minimale (open non utilisé par hlc3 mais requis par le type). */
function candle(high: number, low: number, close: number, volume: number): Candle {
  return { time: 0, open: close, high, low, close, volume };
}

describe("vwap", () => {
  const candles: Candle[] = [
    candle(10, 10, 10, 0),
    candle(12, 10, 11, 10),
    candle(14, 12, 13, 20),
    candle(16, 14, 15, 30),
  ];

  it("calcule la VWAP cumulative de session (régime établi)", () => {
    const { series } = computeIndicator(vwap, candles);
    const out = series.vwap;
    expect(out).toBeDefined();
    expect(out![1]).toBeCloseTo(11, 10);
    expect(out![2]).toBeCloseTo(370 / 30, 10); // 12.33333...
    expect(out![3]).toBeCloseTo(820 / 60, 10); // 13.66667...
  });

  it("laisse undefined au démarrage tant que le volume cumulé vaut 0", () => {
    const { series } = computeIndicator(vwap, candles);
    expect(series.vwap![0]).toBeUndefined();
  });

  it("expose la longueur et la clé de sortie attendues", () => {
    const { series } = computeIndicator(vwap, candles);
    expect(Object.keys(series)).toEqual(["vwap"]);
    expect(series.vwap!.length).toBe(candles.length);
  });
});
