/**
 * Tests EMA — valeurs de référence calculées À LA MAIN depuis la formule.
 *
 * Formule (cf. ../utils `ema`) :
 *   k = 2 / (length + 1)
 *   amorce = SMA des `length` premières clôtures, placée à l'index length-1
 *   ema[i] = close[i] * k + ema[i-1] * (1 - k)   pour i >= length
 *
 * Jeu déterministe : length = 3, clôtures = [1, 2, 3, 4, 5, 6].
 *   k = 2 / (3 + 1) = 0.5
 *   idx 0,1 -> undefined (fenêtre incomplète)
 *   idx 2 (amorce) = (1 + 2 + 3) / 3 = 2
 *   idx 3 = 4*0.5 + 2*0.5 = 3
 *   idx 4 = 5*0.5 + 3*0.5 = 4
 *   idx 5 = 6*0.5 + 4*0.5 = 5
 * => [undefined, undefined, 2, 3, 4, 5]
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { ema } from "./ema";

/** Construit des bougies minimales à partir d'une série de clôtures. */
function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));
}

/** Contexte factice : non utilisé par l'EMA (calcul sur les clôtures seules). */
const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };

describe("EMA", () => {
  it("expose le bon métadonnée déclarative", () => {
    expect(ema.id).toBe("ema");
    expect(ema.category).toBe("trend");
    expect(ema.pane).toBe("overlay");
    expect(ema.outputs).toEqual([{ key: "ema", name: "EMA", style: "line" }]);
  });

  it("calcule l'EMA en régime établi + undefined avant fenêtre pleine", () => {
    const candles = candlesFromCloses([1, 2, 3, 4, 5, 6]);
    const result = ema.calc(candles, { length: 3 }, ctx);
    expect(result.series.ema).toEqual([undefined, undefined, 2, 3, 4, 5]);
  });

  it("utilise length=20 par défaut quand le paramètre est absent", () => {
    // 19 bougies < fenêtre de 20 -> aucune valeur calculable.
    const candles = candlesFromCloses(Array.from({ length: 19 }, (_, i) => i + 1));
    const result = ema.calc(candles, {}, ctx);
    expect(result.series.ema).toEqual(new Array(19).fill(undefined));
  });
});
