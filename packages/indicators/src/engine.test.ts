import { describe, expect, it } from "vitest";
import { resolveParams, computeIndicator } from "./engine";
import { ema } from "./trend/ema";
import type { CalcContext, Candle } from "@axiom/types";
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

it("computeIndicator clampe les params hors-borne (min-only) — le calcul reçoit bien la valeur clampée", () => {
  // Vérifie que resolveParams ET computeIndicator produisent le même résultat
  // pour un param hors-borne min quand max est absent.
  // Bug : si resolveParams repassait la valeur brute, le calc recevrait length: -3
  // au lieu de length: 1 → résultats différents.

  // Petite fixture de bougies (EMA sur close)
  const candles: Candle[] = [
    { time: 1000, open: 100, high: 102, low: 99, close: 101, volume: 1000 },
    { time: 2000, open: 101, high: 103, low: 100, close: 102, volume: 1000 },
    { time: 3000, open: 102, high: 104, low: 101, close: 103, volume: 1000 },
    { time: 4000, open: 103, high: 105, low: 102, close: 104, volume: 1000 },
    { time: 5000, open: 104, high: 106, low: 103, close: 105, volume: 1000 },
  ];

  // Calcul avec params hors-borne : length: -3 → clampé à 1 en interne
  const resultOutOfBounds = computeIndicator(ema, candles, { length: -3 });
  // Calcul explicite avec la valeur clampée : length: 1
  const resultClamped = computeIndicator(ema, candles, { length: 1 });

  // Les deux doivent être IDENTIQUES (deep equal) : le clamp s'applique bien
  expect(resultOutOfBounds).toEqual(resultClamped);

  // Vérifier aussi que le résultat n'est pas vide (la courbe a été calculée)
  expect(resultOutOfBounds.series.ema).toBeDefined();
  expect(resultOutOfBounds.series.ema?.length).toBe(candles.length);
  // Au moins une valeur définie (EMA a besoin d'au moins 1 bougie)
  expect(resultOutOfBounds.series.ema?.some((v) => v !== undefined)).toBe(true);
});

describe("computeIndicator — unité de temps (ctx.timeframe)", () => {
  const candles: Candle[] = [
    { time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    { time: 2000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
  ];
  // Def minimal dont la sortie dépend de `ctx.timeframe` (et trace la présence de la clé).
  const defTf = {
    id: "tf", name: "tf", category: "trend", pane: "overlay", inputs: [], outputs: [],
    calc: (c: Candle[], _p: unknown, ctx: CalcContext) => ({
      series: {
        minutes: c.map(() => (ctx.timeframe === "1h" ? 60 : ctx.timeframe === "1d" ? 1440 : undefined)),
        cle: c.map(() => ("timeframe" in ctx ? 1 : 0)),
      },
    }),
  } as never;

  it("expose ctx.timeframe quand l'appelant le fournit", () => {
    expect(computeIndicator(defTf, candles, {}, undefined, "1h").series).toEqual({ minutes: [60, 60], cle: [1, 1] });
    expect(computeIndicator(defTf, candles, {}, undefined, "1d").series.minutes).toEqual([1440, 1440]);
  });

  it("ne pose pas la clé timeframe quand l'appelant ne la fournit pas", () => {
    expect(computeIndicator(defTf, candles, {}).series).toEqual({ minutes: [undefined, undefined], cle: [0, 0] });
    expect(computeIndicator(defTf, candles, {}, { oi: [1, 2] }).series.cle).toEqual([0, 0]);
  });
});
