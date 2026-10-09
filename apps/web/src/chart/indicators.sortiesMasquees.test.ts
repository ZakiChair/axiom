/**
 * Sorties masquées (`IndicatorOutput.masquee`, 9 octobre 2026) : calculées et
 * présentes dans `extendData` (alertes, fenêtre BT, screener) mais JAMAIS
 * tracées — ni figure KLineChart, ni point émis par le `calc` du template, ni
 * jeton de couleur, ni statut « tracé » quand elles sont seules définies.
 *
 * Def réelle sous test : `stratAxis` (4 sorties, dont `etat`/`score` masquées).
 * Deux defs synthétiques, poussées dans `INDICATORS` le temps du test, isolent
 * « vide » et le mapping du template hors stratégie overlay (pour laquelle le
 * statut reste `null` même à plat, par convention).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import type { Candle, IndicatorDef } from "@axiom/types";
import { INDICATORS } from "@axiom/indicators";
import { ChartIndicators, statutIndicateur } from "./indicators";
import { auxProvider, type AuxStatus } from "./auxProvider";
import { jetonsConsommes, type ActiveIndicator } from "../store/indicators";

// Même contrainte que indicators.aux.test.ts : le build UMD de klinecharts
// n'est pas évaluable hors navigateur — on stub les exports runtime.
vi.mock("klinecharts", () => ({
  registerIndicator: vi.fn(),
  registerOverlay: () => {},
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
}));
import { registerIndicator } from "klinecharts";

const candles: Candle[] = [100, 100, 110, 90, 90].map((close, i) => ({
  time: i * 3_600_000, open: close, high: close + 2, low: close - 2,
  close, volume: 1_000, closed: true,
}));

interface TemplateStub {
  figures?: Array<{ key: string }>;
  calc?: (dataList: unknown[], indicator: { extendData?: unknown }) => Array<Record<string, number>>;
}

function monter(instance: ActiveIndicator) {
  const chart = {
    createIndicator: vi.fn((_config: unknown, _stack: boolean, options?: { id: string }) => options?.id ?? "candle_pane"),
    overrideIndicator: vi.fn(), removeIndicator: vi.fn(), setPaneOptions: vi.fn(),
    getSize: () => ({ top: 0, left: 0, width: 800, height: 100, right: 800, bottom: 100 }),
  };
  const controller = new ChartIndicators(chart as unknown as Chart);
  controller.setMarket("BTCUSDT", "1h");
  controller.sync([instance], candles, "binance");
  return chart;
}

/** Def de test : sortie masquée toujours définie, sortie tracée pilotée par `tracee`. */
const defMasquee = (tracee: boolean): IndicatorDef => ({
  id: `testMasquee${tracee}`,
  name: "Test masquée",
  category: "momentum",
  pane: "separate",
  inputs: [],
  outputs: [
    { key: "etat", name: "État", style: "line", masquee: true },
    { key: "tracee", name: "Tracée", style: "line" },
  ],
  calc: (cs) => ({
    series: {
      etat: cs.map(() => 0),
      tracee: cs.map((_c, i) => (tracee ? i : undefined)),
    },
  }),
});

const ajoutees: IndicatorDef[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(registerIndicator).mockClear();
  for (const d of ajoutees.splice(0)) {
    const i = INDICATORS.indexOf(d);
    if (i >= 0) INDICATORS.splice(i, 1);
  }
});

describe("sorties masquées", () => {
  it("stratAxis : seules prixSignal et stop deviennent des figures et des points tracés", () => {
    vi.spyOn(auxProvider, "getAligned").mockReturnValue({ status: "error", message: "test" } as AuxStatus);
    monter({ instanceId: "axis-1", defId: "stratAxis", params: { emaTendance: 50 }, couleurIdx: 0 });

    const template = vi.mocked(registerIndicator).mock.calls.at(-1)?.[0] as unknown as TemplateStub;
    expect(template.figures?.map((f) => f.key)).toEqual(["prixSignal", "stop"]);

    // Le calc du template n'émet que les clés tracées : etat/score, présents
    // dans extendData, ne passent jamais dans le point KLineChart.
    const points = template.calc?.([{}, {}], {
      extendData: { series: { prixSignal: [1, 2], stop: [3, 4], etat: [0, 1], score: [5, -6] } },
    });
    expect(points).toEqual([{ prixSignal: 1, stop: 3 }, { prixSignal: 2, stop: 4 }]);
  });

  it("un résultat dont seules les sorties masquées sont finies est « vide », pas « tracé »", () => {
    const def = defMasquee(false);
    INDICATORS.push(def);
    ajoutees.push(def);
    const chart = monter({ instanceId: "m-1", defId: def.id, params: {}, couleurIdx: 0 });
    expect(statutIndicateur(chart as unknown as Chart, "m-1")?.etat).toBe("vide");
  });

  it("une sortie tracée finie suffit : statut « tracé » même avec des masquées à côté", () => {
    const def = defMasquee(true);
    INDICATORS.push(def);
    ajoutees.push(def);
    const chart = monter({ instanceId: "m-2", defId: def.id, params: {}, couleurIdx: 0 });
    expect(statutIndicateur(chart as unknown as Chart, "m-2")).toBeNull();
  });

  it("jetonsConsommes : les sorties masquées ne consomment pas de couleur (AXIS = 2, pas 4)", () => {
    expect(jetonsConsommes("stratAxis")).toBe(2);
    const def = defMasquee(true);
    INDICATORS.push(def);
    ajoutees.push(def);
    expect(jetonsConsommes(def.id)).toBe(1);
  });
});
