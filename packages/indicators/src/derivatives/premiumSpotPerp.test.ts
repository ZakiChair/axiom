/**
 * Dérivation à la main (seuil 0,05 %, closes constants à 100) :
 * mark = [100, 100, 100, 100.1, 100.1, 100.1, 100.1, 99.9, 99.9, 99.9]
 * prime% = [0, 0, 0, +0.1, +0.1, +0.1, +0.1, −0.1, −0.1, −0.1]
 * → run 1 : idx 3..6 (4 bougies, signe +, |0.1| ≥ 0.05) → ruban --up,
 *   hauts = mark (100.1), bas = close (100), moyenne +0.10, extrême +0.10 ;
 * → bascule de signe à idx 7 → run 2 : idx 7..9 (3 bougies) → ruban --down,
 *   hauts = close (100), bas = mark (99.9), moyenne −0.10.
 * Un run de longueur 1 est ignoré (polygone dégénéré invisible).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { premiumSpotPerp } from "./premiumSpotPerp";

function candles100(n: number): Candle[] {
  return Array.from({ length: n }, (_v, i) => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: 100, high: 100, low: 100, close: 100, volume: 1,
  }));
}

const mark = [100, 100, 100, 100.1, 100.1, 100.1, 100.1, 99.9, 99.9, 99.9];

describe("premiumSpotPerp", () => {
  it("contrat : overlay derivatives, aux mark, sortie ligne mark, input seuilPct", () => {
    expect(premiumSpotPerp.pane).toBe("overlay");
    expect(premiumSpotPerp.category).toBe("derivatives");
    expect(premiumSpotPerp.aux).toEqual(["mark"]);
    expect(premiumSpotPerp.minTimeframe).toBe("15m");
    expect(premiumSpotPerp.outputs).toEqual([{ key: "mark", name: "Mark perp", style: "line" }]);
    expect(premiumSpotPerp.inputs).toEqual([
      { key: "seuilPct", name: "Seuil prime (%)", type: "number", default: 0.05, min: 0, max: 5 },
    ]);
  });

  it("deux runs signés : rubans --up puis --down, bornes et infos exactes", () => {
    const r = computeIndicator(premiumSpotPerp, candles100(10), {}, { mark });
    expect(r.series["mark"]).toEqual(mark);
    expect(r.annotations?.rubans).toEqual([
      {
        deIdx: 3, hauts: [100.1, 100.1, 100.1, 100.1], bas: [100, 100, 100, 100],
        couleur: "--up", alpha: 0.15,
        info: "Prime perp moyenne +0.10 % sur 4 bougies (extrême +0.10 %)",
      },
      {
        deIdx: 7, hauts: [100, 100, 100], bas: [99.9, 99.9, 99.9],
        couleur: "--down", alpha: 0.15,
        info: "Prime perp moyenne -0.10 % sur 3 bougies (extrême -0.10 %)",
      },
    ]);
  });

  it("sous le seuil / run de longueur 1 : aucun ruban", () => {
    const sousSeuil = new Array<number>(10).fill(100.02); // prime +0.02 < 0.05
    expect(computeIndicator(premiumSpotPerp, candles100(10), {}, { mark: sousSeuil }).annotations).toBeUndefined();
    const runDe1 = [100, 100, 100, 100.1, 100, 100, 100, 100, 100, 100];
    expect(computeIndicator(premiumSpotPerp, candles100(10), {}, { mark: runDe1 }).annotations).toBeUndefined();
  });

  it("aux absent : série mark toute undefined, aucune annotation, aucun throw", () => {
    const r = computeIndicator(premiumSpotPerp, candles100(10), {});
    expect(r.series["mark"]).toEqual(new Array(10).fill(undefined));
    expect(r.annotations).toBeUndefined();
  });
});
