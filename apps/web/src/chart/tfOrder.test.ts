/**
 * Tests de `tfAtLeast` — comparaison d'ordre de granularité entre deux Timeframe.
 */
import { describe, expect, it } from "vitest";
import { tfAtLeast } from "./tfOrder";

describe("tfAtLeast", () => {
  it("un TF plus grossier que le minimum satisfait la contrainte", () => {
    expect(tfAtLeast("4h", "1h")).toBe(true);
  });

  it("un TF plus fin que le minimum ne satisfait PAS la contrainte", () => {
    expect(tfAtLeast("15m", "1h")).toBe(false);
  });

  it("un TF égal au minimum satisfait la contrainte (inclusif)", () => {
    expect(tfAtLeast("1d", "1d")).toBe(true);
  });
});
