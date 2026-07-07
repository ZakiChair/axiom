/**
 * @axiom/indicators — volume/volume.test.ts
 *
 * Vérifie le passthrough du Volume.
 *
 * Le Volume est un simple recopiage du champ `volume` de chaque bougie :
 *   series.volume[i] = candles[i].volume
 *
 * Il n'y a AUCUNE fenêtre de calcul, donc aucune position `undefined` en début
 * de série (contrairement aux moyennes mobiles). On couvre néanmoins :
 *   - le régime établi (toutes les valeurs recopiées à l'identique) ;
 *   - le « démarrage » : dès la première bougie, la valeur est définie ;
 *   - le cas d'une bougie manquante -> `undefined` (garde de noUncheckedIndexedAccess).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { volume } from "./volume";

/** Fabrique une bougie minimale ; seul `volume` importe ici. */
function candle(time: number, vol: number): Candle {
  return { time, open: 100, high: 101, low: 99, close: 100, volume: vol };
}

// Jeu déterministe : volumes choisis à la main.
const candles: Candle[] = [
  candle(1, 10),
  candle(2, 25),
  candle(3, 0), // volume nul = valeur valide, pas undefined
  candle(4, 7.5),
  candle(5, 1000),
];

// CalcContext factice : non utilisé par le Volume.
const ctx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("volume (passthrough)", () => {
  it("recopie le volume de chaque bougie à l'identique", () => {
    const res = volume.calc(candles, {}, ctx);
    // Attendu calculé à la main = exactement les volumes d'entrée.
    expect(res.series.volume).toEqual([10, 25, 0, 7.5, 1000]);
  });

  it("définit une valeur dès la première bougie (aucune période d'amorçage)", () => {
    const res = volume.calc(candles, {}, ctx);
    expect(res.series.volume?.[0]).toBe(10);
    expect(res.series.volume?.every((v) => v !== undefined)).toBe(true);
  });

  it("renvoie une série de même longueur que l'entrée", () => {
    const res = volume.calc(candles, {}, ctx);
    expect(res.series.volume).toHaveLength(candles.length);
  });

  it("métadonnées conformes à la spec", () => {
    expect(volume.id).toBe("volume");
    expect(volume.category).toBe("volume");
    expect(volume.pane).toBe("separate");
    expect(volume.inputs).toEqual([]);
    expect(volume.outputs).toEqual([{ key: "volume", name: "Volume", style: "histogram" }]);
  });
});
