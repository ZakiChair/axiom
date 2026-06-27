/**
 * @axiom/indicators — volume/volumeMa.test.ts
 *
 * Volume MA = SMA(volume) : valeurs exactes + amorçage undefined.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { volumeMa } from "./volumeMa";

function candle(vol: number): Candle {
  return { time: 0, open: 1, high: 1, low: 1, close: 1, volume: vol };
}

const ctx = { hl2: [], hlc3: [], ohlc4: [] };
const candles: Candle[] = [10, 20, 30, 40, 50].map(candle);

describe("volumeMa", () => {
  it("SMA(volume, 3) — valeurs exactes et amorçage undefined", () => {
    const res = volumeMa.calc(candles, { length: 3 }, ctx);
    // idx0,1 fenêtre incomplète ; (10+20+30)/3=20 ; 30 ; 40
    expect(res.series.volumeMa).toEqual([undefined, undefined, 20, 30, 40]);
  });

  it("longueur de sortie = longueur d'entrée", () => {
    const res = volumeMa.calc(candles, { length: 3 }, ctx);
    expect(res.series.volumeMa).toHaveLength(candles.length);
  });

  it("métadonnées conformes", () => {
    expect(volumeMa.id).toBe("volumeMa");
    expect(volumeMa.category).toBe("volume");
    expect(volumeMa.pane).toBe("separate");
  });
});
