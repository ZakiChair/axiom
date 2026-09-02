/**
 * @axiom/indicators — volume/vwapBands.test.ts
 *
 * VWAP Bands : invariant d'ordre (upper ≥ basis ≥ lower), amorçage undefined
 * tant que le volume cumulé de la session est nul, et basis = VWAP cumulée
 * DEPUIS LE DÉBUT DE LA SESSION (reset à chaque changement de jour UTC).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { vwapBands } from "./vwapBands";

const DAY_MS = 86_400_000;

function candle(
  high: number,
  low: number,
  close: number,
  vol: number,
  time = 0
): Candle {
  return { time, open: close, high, low, close, volume: vol };
}

// Construit le ctx avec hlc3 comme le ferait le moteur.
function makeCtx(candles: Candle[]) {
  const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
  return { hl2: [], hlc3, ohlc4: [], source: [] };
}

const candles: Candle[] = [
  candle(105, 95, 100, 0), // volume nul : VWAP non définie
  candle(110, 100, 108, 50),
  candle(112, 104, 106, 30),
  candle(120, 110, 118, 80),
  candle(115, 108, 110, 20),
];

describe("vwapBands", () => {
  it("undefined tant que le volume cumulé est nul, puis défini", () => {
    const res = vwapBands.calc(candles, { mult: 1 }, makeCtx(candles));
    expect(res.series.basis?.[0]).toBeUndefined();
    expect(res.series.upper?.[0]).toBeUndefined();
    expect(res.series.lower?.[0]).toBeUndefined();
    expect(res.series.basis?.[1]).toBeDefined();
  });

  it("invariant : upper ≥ basis ≥ lower partout où c'est défini", () => {
    const res = vwapBands.calc(candles, { mult: 2 }, makeCtx(candles));
    const { basis, upper, lower } = res.series;
    for (let i = 0; i < candles.length; i++) {
      const b = basis![i];
      const u = upper![i];
      const l = lower![i];
      if (b !== undefined && u !== undefined && l !== undefined) {
        expect(u).toBeGreaterThanOrEqual(b);
        expect(b).toBeGreaterThanOrEqual(l);
      }
    }
  });

  it("basis = VWAP cumulée (vérif manuelle sur la 2e bougie)", () => {
    const res = vwapBands.calc(candles, { mult: 1 }, makeCtx(candles));
    // Seule la bougie idx1 porte du volume jusque-là : VWAP = hlc3 de idx1.
    const tp1 = (110 + 100 + 108) / 3;
    expect(res.series.basis?.[1]).toBeCloseTo(tp1, 9);
    // Une seule observation pondérée -> variance nulle -> bandes collées à la base.
    expect(res.series.upper?.[1]).toBeCloseTo(tp1, 9);
    expect(res.series.lower?.[1]).toBeCloseTo(tp1, 9);
  });

  it("longueur de sortie = longueur d'entrée", () => {
    const res = vwapBands.calc(candles, {}, makeCtx(candles));
    expect(res.series.basis).toHaveLength(candles.length);
    expect(res.series.upper).toHaveLength(candles.length);
    expect(res.series.lower).toHaveLength(candles.length);
  });

  it("métadonnées conformes", () => {
    expect(vwapBands.id).toBe("vwapBands");
    expect(vwapBands.category).toBe("volume");
    expect(vwapBands.pane).toBe("overlay");
    expect(vwapBands.outputs.map((o) => o.key)).toEqual(["basis", "upper", "lower"]);
  });

  // Fixture 2 jours : prouve le reset des 3 accumulateurs (cumTPV/cumVol/cumTP2V)
  // à `utcDayOf` changeant, en phase avec vwap.ts.
  //
  //   jour | i | high low close | vol |  tp      | cumVol (session) | vwap (basis)
  //   -----+---+----------------+-----+----------+-------------------+-------------
  //    0   | 0 | 105  95  100   |  0  | 100      |   0                | undefined
  //    0   | 1 | 110 100  108   | 50  | 106      |  50                | 106
  //    0   | 2 | 112 104  106   | 30  | 107.33333|  80                | 8520/80=106.5
  //    1   | 3 | 120 110  118   | 80  | 116      |  80 (RESET)        | 116  == tp[3]
  //    1   | 4 | 115 108  110   | 20  | 111      | 100                | 11500/100=115
  //
  // Variance pondérée sur (jour 2, mult=1) :
  //   moyenne pondérée = 115 ; var = [80*(116-115)² + 20*(111-115)²]/100
  //                          = [80*1 + 20*16]/100 = 400/100 = 4 -> sd = 2
  //   -> upper[4] = 117, lower[4] = 113
  describe("reset de session à `utcDayOf` changeant", () => {
    const twoDayCandles: Candle[] = [
      candle(105, 95, 100, 0, 0),
      candle(110, 100, 108, 50, 0),
      candle(112, 104, 106, 30, 1_000),
      candle(120, 110, 118, 80, DAY_MS), // 1re bougie du jour 2
      candle(115, 108, 110, 20, DAY_MS + 1_000),
    ];

    it("basis de la 1re bougie du jour 2 == son propre prix typique (cumul reparti à zéro)", () => {
      const res = vwapBands.calc(twoDayCandles, { mult: 1 }, makeCtx(twoDayCandles));
      const tpDay2First = (120 + 110 + 118) / 3; // 116
      expect(res.series.basis?.[3]).toBeCloseTo(tpDay2First, 10);
      // Une seule observation pondérée dans la nouvelle session -> variance nulle.
      expect(res.series.upper?.[3]).toBeCloseTo(tpDay2First, 10);
      expect(res.series.lower?.[3]).toBeCloseTo(tpDay2First, 10);
    });

    it("basis diffère entre dernière bougie jour 1 et 1re bougie jour 2 (preuve du reset)", () => {
      const res = vwapBands.calc(twoDayCandles, { mult: 1 }, makeCtx(twoDayCandles));
      expect(res.series.basis?.[2]).toBeCloseTo(8520 / 80, 10); // 106.5
      expect(res.series.basis?.[3]).toBeCloseTo(116, 10);
      expect(res.series.basis?.[2]).not.toBeCloseTo(res.series.basis![3]!, 5);
    });

    it("les bandes se rouvrent normalement après le reset (2e bougie du jour 2)", () => {
      const res = vwapBands.calc(twoDayCandles, { mult: 1 }, makeCtx(twoDayCandles));
      expect(res.series.basis?.[4]).toBeCloseTo(115, 10);
      expect(res.series.upper?.[4]).toBeCloseTo(117, 10);
      expect(res.series.lower?.[4]).toBeCloseTo(113, 10);
    });
  });

  // Buffer démarrant EN MILIEU DE JOURNÉE : même convention que vwap.ts —
  // valeurs conservées, session étiquetée « partielle ».
  describe("session partielle (buffer démarrant en milieu de journée)", () => {
    const HOUR_MS = 3_600_000;
    const partiel: Candle[] = [
      candle(110, 100, 108, 50, 5 * HOUR_MS),
      candle(112, 104, 106, 30, 6 * HOUR_MS),
    ];

    it("émet une étiquette « session partielle » sur la première bougie", () => {
      const res = vwapBands.calc(partiel, { mult: 1 }, makeCtx(partiel));
      const labels = res.annotations?.labels ?? [];
      expect(labels.length).toBe(1);
      expect(labels[0]!.idx).toBe(0);
      expect(labels[0]!.cible).toBe("prix");
      expect(labels[0]!.texte.toLowerCase()).toContain("partielle");
    });

    it("laisse les valeurs inchangées et n'annote pas un buffer démarrant à 00:00 UTC", () => {
      const res = vwapBands.calc(partiel, { mult: 1 }, makeCtx(partiel));
      expect(res.series.basis?.[0]).toBeCloseTo((110 + 100 + 108) / 3, 10);
      const plein = vwapBands.calc(candles, { mult: 1 }, makeCtx(candles));
      expect(plein.annotations).toBeUndefined();
    });
  });
});
