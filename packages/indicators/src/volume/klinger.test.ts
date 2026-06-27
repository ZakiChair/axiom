/**
 * @axiom/indicators — volume/klinger.test.ts
 *
 * Klinger : indicateur complexe (Volume Force + double EMA + signal). On teste
 * longueur, amorçage undefined et finitude — PAS de valeur de référence fabriquée
 * (politique anti fausse-précision §15.4). Le signal (EMA13 d'une ligne démarrant
 * à slow-1=54) apparaît tard : ~90 bougies pour le couvrir.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { klinger } from "./klinger";

function candle(high: number, low: number, close: number, vol: number): Candle {
  return { time: 0, open: close, high, low, close, volume: vol };
}

const ctx = { hl2: [], hlc3: [], ohlc4: [] };

const candles: Candle[] = Array.from({ length: 90 }, (_, i) => {
  const base = 100 + Math.sin(i / 3) * 8;
  return candle(base + 3, base - 3, base + Math.cos(i / 2), 100 + (i % 7) * 25);
});

describe("klinger", () => {
  it("expose deux séries de la longueur d'entrée", () => {
    const res = klinger.calc(candles, {}, ctx);
    expect(res.series.klinger).toHaveLength(candles.length);
    expect(res.series.signal).toHaveLength(candles.length);
  });

  it("KVO : amorçage undefined avant slow-1 puis valeurs finies", () => {
    const slow = 55;
    const res = klinger.calc(candles, {}, ctx);
    const k = res.series.klinger!;
    expect(k[slow - 2]).toBeUndefined();
    for (let i = slow - 1; i < k.length; i++) expect(Number.isFinite(k[i])).toBe(true);
  });

  it("signal : démarre après le KVO et reste fini une fois amorcé", () => {
    const res = klinger.calc(candles, {}, ctx);
    const sig = res.series.signal!;
    // Le signal doit exister sur la dernière bougie (séquence assez longue).
    expect(Number.isFinite(sig[sig.length - 1])).toBe(true);
    // ...mais pas tout au début (au moins quelques undefined en tête).
    expect(sig[0]).toBeUndefined();
  });

  it("métadonnées conformes", () => {
    expect(klinger.id).toBe("klinger");
    expect(klinger.pane).toBe("separate");
    expect(klinger.outputs.map((o) => o.key)).toEqual(["klinger", "signal"]);
  });
});
