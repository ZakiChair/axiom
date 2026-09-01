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

it("clamp min-only (pas de max défini) : valeur brute ne doit pas echapper", () => {
  // Bug: quand max était absent, resolveParams repassait la valeur brute au lieu de la clamper au min.
  // Surfaces affectées : chart calc, alertes, backtest, screener (utilisent tous resolveParams).
  const defMinOnly = {
    id: "ema", name: "EMA", category: "trend", pane: "overlay", outputs: [],
    inputs: [
      { key: "length", name: "L", type: "number", default: 20, min: 1 }, // min SEUL, pas max
      { key: "source", name: "S", type: "source", default: "close", options: ["close", "open"] },
    ],
    calc: () => ({ series: {} }),
  } as never;

  // Cas hors-borne basse : -3 doit être clampé à 1, pas repassé brut
  expect(resolveParams(defMinOnly, { length: -3 })).toEqual({ length: 1, source: "close" });
  // Cas in-bounds : 20 reste 20
  expect(resolveParams(defMinOnly, { length: 20 })).toEqual({ length: 20, source: "close" });
  // Cas NaN : revert au défaut 20
  expect(resolveParams(defMinOnly, { length: Number.NaN })).toEqual({ length: 20, source: "close" });
});
