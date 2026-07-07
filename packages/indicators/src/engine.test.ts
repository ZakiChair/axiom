import { describe, expect, it } from "vitest";
import { resolveParams } from "./engine";
const def = {
  id: "t", name: "t", category: "trend", pane: "overlay", outputs: [],
  inputs: [{ key: "period", name: "P", type: "number", default: 14, min: 1, max: 500 }],
  calc: () => ({ series: {} }),
} as never;
it("clamp et assainit les paramètres numériques", () => {
  expect(resolveParams(def, { period: 0 })).toEqual({ period: 1 });      // < min → min
  expect(resolveParams(def, { period: 10_000 })).toEqual({ period: 500 }); // > max → max
  expect(resolveParams(def, { period: Number.NaN })).toEqual({ period: 14 }); // NaN → défaut
  expect(resolveParams(def, { period: 21 })).toEqual({ period: 21 });    // valide → inchangé
});
