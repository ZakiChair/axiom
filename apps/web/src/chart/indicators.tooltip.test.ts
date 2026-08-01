/**
 * Tooltip d'annotations du pont (`createTooltipDataSource` de `ensureRegistered`).
 *
 * Régression couverte : une divergence produit DEUX segments porteurs de la MÊME
 * chaîne `info` — un cible "prix" (aIdx = idxTo) et un cible "pane" (aIdx =
 * oscIdxTo), distants de ≤ 3 barres (packages/indicators/src/utils-annotations.ts:82-83).
 * Sans déduplication, le tooltip affichait deux fois la même ligne et saturait son
 * budget de 3. La dédup porte sur la chaîne `info`, PAS sur `cible` : les rubans
 * n'ont pas ce champ et seraient perdus par un filtre par cible.
 *
 * Le template KLineChart est CAPTURÉ au vol par le mock de `registerIndicator`
 * (`vi.hoisted` : la factory de `vi.mock` est hissée au-dessus des imports), puis
 * son callback est appelé DIRECTEMENT : il est pur — aucun DOM, aucun canvas.
 */
import { describe, expect, it, vi } from "vitest";
import type { Chart, IndicatorCreateTooltipDataSourceParams, IndicatorTemplate } from "klinecharts";
import type { AnnotationsIndicateur, Candle, IndicatorResult } from "@axiom/types";
import type { ActiveIndicator } from "../store/indicators";

const capture = vi.hoisted(() => ({ template: null as IndicatorTemplate | null }));

vi.mock("klinecharts", () => ({
  registerIndicator: (t: IndicatorTemplate) => {
    capture.template = t;
  },
  registerOverlay: () => {},
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
}));

import { ChartIndicators } from "./indicators";

const candles: Candle[] = [
  { time: 1_000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
  { time: 2_000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
];

/** Monte une instance SMA (def simple, sans aux) pour capturer le template générique. */
function templateCapture(): IndicatorTemplate {
  const chart = {
    createIndicator: (_c: unknown, _s: boolean, opts?: { id: string }) => opts?.id ?? null,
    overrideIndicator: () => {},
    removeIndicator: () => {},
    // Géométrie : lue par l'équilibrage de hauteur des panes (chart/paneBudget.ts).
    getSize: () => ({ top: 0, left: 0, width: 800, height: 100, right: 800, bottom: 100 }),
    setPaneOptions: () => {},
  };
  const instance: ActiveIndicator = { instanceId: "sma-tooltip", defId: "sma", params: { length: 1 } , couleurIdx: 0 };
  new ChartIndicators(chart as unknown as Chart).sync([instance], candles, "binance");
  const template = capture.template;
  if (template === null) throw new Error("registerIndicator n'a pas été appelé");
  return template;
}

/** Appelle le callback capturé avec les 2 champs qu'il lit (sur 8) — d'où le cast. */
function tooltip(template: IndicatorTemplate, annotations: AnnotationsIndicateur, dataIndex: number) {
  const extendData: IndicatorResult = { series: {}, annotations };
  return template.createTooltipDataSource?.({
    indicator: { extendData },
    crosshair: { dataIndex },
  } as unknown as IndicatorCreateTooltipDataSourceParams);
}

const SEGMENT_BASE = { deIdx: 0, deValeur: 1, aValeur: 2, trait: "plein", couleur: "--up" } as const;

describe("createTooltipDataSource — annotations sous le crosshair", () => {
  it("les deux segments d'UNE divergence (même info, cibles prix/pane) ne donnent qu'UNE ligne", () => {
    const template = templateCapture();
    const info = "Divergence haussière régulière — prix 100 → 90 vs RSI 30 → 40";
    const res = tooltip(
      template,
      {
        segments: [
          { ...SEGMENT_BASE, aIdx: 10, cible: "prix", info },
          { ...SEGMENT_BASE, aIdx: 12, cible: "pane", info }, // pivot oscillateur, ≤ 3 barres
        ],
      },
      10,
    );
    expect(res?.values).toEqual([{ title: "", value: info }]);
  });

  it("budget de 3 lignes : au-delà, les infos distinctes supplémentaires sont ignorées", () => {
    const template = templateCapture();
    const res = tooltip(
      template,
      {
        segments: ["a", "b", "c", "d"].map((info, i) => ({
          ...SEGMENT_BASE,
          aIdx: 10 + i,
          cible: "prix" as const,
          info,
        })),
      },
      10,
    );
    expect(res?.values).toEqual([
      { title: "", value: "a" },
      { title: "", value: "b" },
      { title: "", value: "c" },
    ]);
  });
});
