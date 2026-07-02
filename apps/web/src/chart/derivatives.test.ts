import { describe, it, expect } from "vitest";
import { forwardFillByTime } from "./derivatives";

const h = 60 * 60 * 1000;

describe("forwardFillByTime (sous-panes dérivés)", () => {
  it("forward-fill la dernière valeur connue ≤ open time de chaque bougie", () => {
    const candles = [{ time: 2 * h }, { time: 3 * h }, { time: 4 * h }];
    const series = [
      { time: 1 * h, value: 6.0e9 },
      { time: 3 * h, value: 6.2e9 },
    ];
    expect(forwardFillByTime(candles, series)).toEqual({
      [2 * h]: 6.0e9,
      [3 * h]: 6.2e9,
      [4 * h]: 6.2e9,
    });
  });

  it("un point unique s'étale sur toute la fenêtre visible", () => {
    const candles = [{ time: 2 * h }, { time: 3 * h }];
    expect(forwardFillByTime(candles, [{ time: 4 * h, value: 0.01 }])).toEqual({
      [2 * h]: 0.01,
      [3 * h]: 0.01,
    });
  });

  it("aucune valeur AVANT le premier point de série (pas d'extrapolation en arrière)", () => {
    const candles = [{ time: 1 * h }, { time: 5 * h }];
    const series = [{ time: 3 * h, value: 42 }, { time: 4 * h, value: 43 }];
    // La bougie 1h précède toute donnée → absente ; la bougie 5h reçoit le dernier point.
    expect(forwardFillByTime(candles, series)).toEqual({ [5 * h]: 43 });
  });

  it("renvoie {} pour des entrées vides", () => {
    expect(forwardFillByTime([], [{ time: 1, value: 1 }])).toEqual({});
    expect(forwardFillByTime([{ time: 1 }], [])).toEqual({});
  });
});
