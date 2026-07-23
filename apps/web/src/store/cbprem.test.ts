/**
 * Tests de la portion PURE du store CBPREM : `versPointsClos` écarte la bougie en
 * formation (`closed === false`) avant l'alignement — exigence critique du plan que
 * `serieCbprem` (signature `{t, close}`) ne peut structurellement pas assurer.
 * Le run réseau n'est pas testé unitairement (convention repo).
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { versPointsClos } from "./cbprem";

/** Bougie minimale (les champs OHLC non pertinents sont posés à des valeurs neutres). */
function candle(time: number, close: number, closed?: boolean): Candle {
  return { time, open: close, high: close, low: close, close, volume: 0, closed };
}

describe("versPointsClos — filtrage de clôture", () => {
  it("écarte la bougie non clôturée (closed === false) et projette en {t, close}", () => {
    const candles = [
      candle(1_000, 101, true),
      candle(2_000, 102, true),
      candle(3_000, 103, false), // en formation → EXCLUE
    ];
    expect(versPointsClos(candles)).toEqual([
      { t: 1_000, close: 101 },
      { t: 2_000, close: 102 },
    ]);
  });

  it("conserve les bougies dont `closed` est undefined (convention finaliser)", () => {
    // Coinbase/Binance REST peuvent renvoyer closed=true|false ; une source sans le
    // drapeau (undefined) ne doit PAS être écartée — seul `closed === false` l'est.
    const candles = [candle(1_000, 101, undefined), candle(2_000, 102, undefined)];
    expect(versPointsClos(candles)).toEqual([
      { t: 1_000, close: 101 },
      { t: 2_000, close: 102 },
    ]);
  });

  it("série vide → tableau vide", () => {
    expect(versPointsClos([])).toEqual([]);
  });
});
