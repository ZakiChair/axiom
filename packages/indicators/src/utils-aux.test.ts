/**
 * @axiom/indicators — utils-aux.test.ts
 */

import { describe, it, expect } from "vitest";
import { alignAux } from "./utils-aux";

describe("alignAux", () => {
  it("aligne la dernière valeur connue ≤ t (two-pointer)", () => {
    // candleTimes = [10, 20, 30, 40], points = [{15,1}, {30,2}]
    // t=10 : aucun point ≤ 10 -> undefined
    // t=20 : dernier point ≤ 20 est {15,1} -> 1
    // t=30 : point exactement à t=30 ({30,2}) est inclus -> 2
    // t=40 : dernier point ≤ 40 reste {30,2} -> 2
    const result = alignAux(
      [10, 20, 30, 40],
      [
        { time: 15, value: 1 },
        { time: 30, value: 2 },
      ]
    );
    expect(result).toEqual([undefined, 1, 2, 2]);
  });

  it("points vide -> tout undefined", () => {
    const result = alignAux([10, 20, 30], []);
    expect(result).toEqual([undefined, undefined, undefined]);
  });

  it("un point exactement à t est inclus dès ce t (pas seulement après)", () => {
    // candleTimes = [10, 20], points = [{10, 5}]
    // t=10 : point exactement à 10 -> visible dès t=10, pas undefined
    // t=20 : dernière valeur connue reste 5
    const result = alignAux([10, 20], [{ time: 10, value: 5 }]);
    expect(result).toEqual([5, 5]);
  });
});
