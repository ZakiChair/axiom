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

const DAY_MS = 86_400_000;

/** Fabrique une bougie minimale (open non utilisé par hlc3 mais requis par le type). */
function candle(
  high: number,
  low: number,
  close: number,
  volume: number,
  time = 0
): Candle {
  return { time, open: close, high, low, close, volume };
}

describe("vwap", () => {
  // Toutes les bougies tombent le même jour UTC (time=0..N) : le cumul ne
  // traverse jamais de minuit UTC, donc le comportement ci-dessous est
  // identique avec ou sans reset de session — ce test couvre la formule.
  const candles: Candle[] = [
    candle(10, 10, 10, 0),
    candle(12, 10, 11, 10),
    candle(14, 12, 13, 20),
    candle(16, 14, 15, 30),
  ];

  it("calcule la VWAP cumulative au sein d'une même session (régime établi)", () => {
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

  // Fixture 2 jours (Step 1 du brief) : prouve le reset à `utcDayOf` changeant.
  //
  //   jour | i | high low close |  tp | vol | cumTPV (session) | cumVol | vwap
  //   -----+---+----------------+-----+-----+-------------------+--------+---------
  //    0   | 0 |  12  10   11   |  11 |  10 | 11*10 = 110       |   10   | 11
  //    0   | 1 |  14  12   13   |  13 |  20 | 110+13*20 = 370   |   30   | 370/30 = 12.33333
  //    1   | 2 |  20  16   18   |  18 |   5 | RESET -> 18*5=90  |    5   | 90/5 = 18  == tp[2]
  //    1   | 3 |  22  18   20   |  20 |  15 | 90+20*15 = 390    |   20   | 390/20 = 19.5
  describe("reset de session à `utcDayOf` changeant", () => {
    const twoDayCandles: Candle[] = [
      candle(12, 10, 11, 10, 0),
      candle(14, 12, 13, 20, 1_000),
      candle(20, 16, 18, 5, DAY_MS), // 1re bougie du jour 2
      candle(22, 18, 20, 15, DAY_MS + 1_000),
    ];

    it("VWAP de la 1re bougie du jour 2 == son propre prix typique (cumul reparti à zéro)", () => {
      const { series } = computeIndicator(vwap, twoDayCandles);
      const tpDay2First = (20 + 16 + 18) / 3; // 18
      expect(series.vwap![2]).toBeCloseTo(tpDay2First, 10);
    });

    it("VWAP diffère entre dernière bougie jour 1 et 1re bougie jour 2 (preuve du reset)", () => {
      const { series } = computeIndicator(vwap, twoDayCandles);
      expect(series.vwap![1]).toBeCloseTo(370 / 30, 10); // 12.33333...
      expect(series.vwap![2]).toBeCloseTo(18, 10);
      expect(series.vwap![1]).not.toBeCloseTo(series.vwap![2]!, 5);
    });

    it("le cumul reprend normalement après le reset (2e bougie du jour 2)", () => {
      const { series } = computeIndicator(vwap, twoDayCandles);
      expect(series.vwap![3]).toBeCloseTo(390 / 20, 10); // 19.5
    });
  });
});
