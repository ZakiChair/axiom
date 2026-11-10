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
 *
 * Rubans (zones d'AXIS S/R, revue finale du 10 novembre 2026) : quand le réticule est
 * sur le pane de l'indicateur (`crosshair.paneId`, `crosshair.y` relatif à ce pane),
 * les rubans qui couvrent la bougie sont rangés par distance verticale de leur bande au
 * réticule, en pixels via `yAxis.convertToPixel` : la bande survolée vient en tête.
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

/** Axe des prix factice : 1 px par unité de prix, les prix hauts en haut (y petit). */
const AXE_Y = { convertToPixel: (v: number) => 1000 - v, convertFromPixel: (px: number) => 1000 - px };

/**
 * Appelle le callback capturé avec les champs qu'il lit (sur 8) — d'où le cast. `reticule` : pane
 * survolé et ordonnée du réticule, relative à ce pane (absent = réticule sans ordonnée).
 */
function tooltip(
  template: IndicatorTemplate,
  annotations: AnnotationsIndicateur,
  dataIndex: number,
  reticule?: { paneId: string; y: number },
) {
  const extendData: IndicatorResult = { series: {}, annotations };
  return template.createTooltipDataSource?.({
    indicator: { extendData },
    crosshair: { dataIndex, ...reticule },
    yAxis: AXE_Y,
  } as unknown as IndicatorCreateTooltipDataSourceParams);
}

const SEGMENT_BASE = { deIdx: 0, deValeur: 1, aValeur: 2, trait: "plein", couleur: "--up" } as const;

/** Bande constante [bas, haut] sur 3 bougies (0 à 2), avec son info. */
const bande = (bas: number, haut: number, info: string) => ({
  deIdx: 0,
  hauts: [haut, haut, haut],
  bas: [bas, bas, bas],
  couleur: "--up",
  alpha: 0.2,
  info,
});
/** Ordre du tableau, comme AXIS S/R : fortes par proximité au dernier cours, puis la faible, en dernier. */
const RUBANS = [
  bande(100, 110, "forte A"),
  bande(120, 130, "forte B"),
  bande(140, 150, "forte C"),
  bande(80, 90, "faible D"),
];
/** Ordonnée (px du pane, axe factice) d'un prix. */
const yDe = (prix: number) => AXE_Y.convertToPixel(prix);

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

describe("createTooltipDataSource — rubans rangés par distance verticale au réticule", () => {
  const lignes = (res: ReturnType<typeof tooltip>) => (res?.values ?? []).map((v) => v.value);

  it("réticule sur la bande d'une zone rangée en dernier (faible) : sa ligne vient en tête, puis les autres par distance", () => {
    const template = templateCapture();
    const res = tooltip(template, { rubans: RUBANS }, 1, { paneId: "candle_pane", y: yDe(85) });
    expect(lignes(res)).toEqual(["faible D", "forte A", "forte B"]);
  });

  it("réticule entre deux bandes : la plus proche verticalement d'abord, au-dessus comme au-dessous", () => {
    const template = templateCapture();
    expect(lignes(tooltip(template, { rubans: RUBANS }, 1, { paneId: "candle_pane", y: yDe(136) }))).toEqual([
      "forte C",
      "forte B",
      "forte A",
    ]);
  });

  it("réticule sur un autre pane (ordonnée relative à ce pane-là) ou sans ordonnée : ordre du tableau", () => {
    const template = templateCapture();
    const attendu = ["forte A", "forte B", "forte C"];
    expect(lignes(tooltip(template, { rubans: RUBANS }, 1, { paneId: "axiom_volume", y: yDe(85) }))).toEqual(attendu);
    expect(lignes(tooltip(template, { rubans: RUBANS }, 1))).toEqual(attendu);
  });

  it("les marqueurs à 3 bougies ou moins passent toujours avant les rubans ; la bande survolée mène les rubans", () => {
    const template = templateCapture();
    const marqueurs = [{ idx: 2, valeur: 95, forme: "triangleHaut", couleur: "--up", cible: "prix", info: "marqueur M" } as const];
    const res = tooltip(template, { marqueurs, rubans: RUBANS }, 1, { paneId: "candle_pane", y: yDe(85) });
    expect(lignes(res)).toEqual(["marqueur M", "faible D", "forte A"]);
  });

  it("bornes lues à la bougie survolée : une bande qui se déplace est rangée selon ses bornes à cette bougie", () => {
    const template = templateCapture();
    const deplacee = { deIdx: 0, hauts: [200, 95, 95], bas: [190, 86, 86], couleur: "--down", alpha: 0.2, info: "zone E" };
    const rubans = [bande(100, 110, "forte A"), deplacee];
    const a = (idx: number) => lignes(tooltip(template, { rubans }, idx, { paneId: "candle_pane", y: yDe(90) }));
    expect(a(1)).toEqual(["zone E", "forte A"]);
    expect(a(0)).toEqual(["forte A", "zone E"]);
  });

  it("deux bandes qui contiennent toutes deux le réticule gardent l'ordre du tableau", () => {
    const template = templateCapture();
    const a = bande(100, 110, "forte A");
    const a2 = bande(105, 115, "forte A2");
    const reticule = { paneId: "candle_pane", y: yDe(107) };
    expect(lignes(tooltip(template, { rubans: [a, a2] }, 1, reticule))).toEqual(["forte A", "forte A2"]);
    expect(lignes(tooltip(template, { rubans: [a2, a] }, 1, reticule))).toEqual(["forte A2", "forte A"]);
  });
});
