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
 *
 * Ligne réservée (11 novembre 2026) : réticule DANS une bande, sa zone garde une des
 * 3 lignes ; segments et marqueurs proches n'en prennent alors que deux. Avant, trois
 * marqueurs à 3 bougies ou moins prenaient tout, même le doigt posé sur la bande. Hors
 * de toute bande, sur un autre pane ou sans ordonnée, rien ne change.
 */
import { describe, expect, it, vi } from "vitest";
import type { Chart, IndicatorCreateTooltipDataSourceParams, IndicatorTemplate } from "klinecharts";
import type { AnnotationsIndicateur, Candle, IndicatorResult } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import type { ActiveIndicator } from "../store/indicators";
import fixtureBtc from "../../../../packages/indicators/src/strategy/fixtures/btcusdt-4h-3000.json";

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

describe("createTooltipDataSource — une ligne réservée à la bande sous le réticule", () => {
  const lignes = (res: ReturnType<typeof tooltip>) => (res?.values ?? []).map((v) => v.value);
  const marqueur = (idx: number, info: string) =>
    ({ idx, valeur: 95, forme: "triangleHaut", couleur: "--up", cible: "prix", info }) as const;
  /** Trois marqueurs à 3 bougies ou moins de la bougie 1 : de quoi prendre les trois lignes. */
  const TROIS = [marqueur(0, "M1"), marqueur(1, "M2"), marqueur(2, "M3")];
  const DANS_D = { paneId: "candle_pane", y: yDe(85) };

  it("trois marqueurs proches, réticule dans une bande : deux marqueurs, puis la zone de cette bande", () => {
    const template = templateCapture();
    expect(lignes(tooltip(template, { marqueurs: TROIS, rubans: RUBANS }, 1, DANS_D))).toEqual(["M1", "M2", "faible D"]);
  });

  it("segments et marqueurs partagent les deux lignes restantes, dans l'ordre d'avant", () => {
    const template = templateCapture();
    const segments = ["S1", "S2"].map((info) => ({ ...SEGMENT_BASE, aIdx: 1, cible: "prix" as const, info }));
    expect(lignes(tooltip(template, { segments, marqueurs: TROIS, rubans: RUBANS }, 1, DANS_D))).toEqual(["S1", "S2", "faible D"]);
    expect(lignes(tooltip(template, { segments: segments.slice(0, 1), marqueurs: TROIS, rubans: RUBANS }, 1, DANS_D))).toEqual([
      "S1",
      "M1",
      "faible D",
    ]);
  });

  it("réticule hors de toute bande, sur un autre pane ou sans ordonnée : les trois marqueurs, comme avant", () => {
    const template = templateCapture();
    const annotations = { marqueurs: TROIS, rubans: RUBANS };
    const attendu = ["M1", "M2", "M3"];
    expect(lignes(tooltip(template, annotations, 1, { paneId: "candle_pane", y: yDe(136) }))).toEqual(attendu);
    expect(lignes(tooltip(template, annotations, 1, { paneId: "axiom_volume", y: yDe(85) }))).toEqual(attendu);
    expect(lignes(tooltip(template, annotations, 1))).toEqual(attendu);
  });

  it("une bande sans info (zone cassée) sous le réticule ne réserve rien", () => {
    const template = templateCapture();
    const cassee = { deIdx: 0, hauts: [90, 90, 90], bas: [80, 80, 80], couleur: "--up", alpha: 0.09 };
    expect(lignes(tooltip(template, { marqueurs: TROIS, rubans: [bande(100, 110, "forte A"), cassee] }, 1, DANS_D))).toEqual([
      "M1",
      "M2",
      "M3",
    ]);
  });

  it("deux bandes sous le réticule : une seule ligne réservée, à la première dans l'ordre du tableau", () => {
    const template = templateCapture();
    const rubans = [bande(100, 110, "forte A"), bande(105, 115, "forte A2")];
    const res = tooltip(template, { marqueurs: TROIS, rubans }, 1, { paneId: "candle_pane", y: yDe(107) });
    expect(lignes(res)).toEqual(["M1", "M2", "forte A"]);
  });

  it("moins de trois marqueurs proches : rien ne change, les zones complètent", () => {
    const template = templateCapture();
    expect(lignes(tooltip(template, { marqueurs: TROIS.slice(0, 2), rubans: RUBANS }, 1, DANS_D))).toEqual(["M1", "M2", "faible D"]);
    expect(lignes(tooltip(template, { marqueurs: TROIS.slice(0, 1), rubans: RUBANS }, 1, DANS_D))).toEqual(["M1", "faible D", "forte A"]);
  });
});

describe("createTooltipDataSource — AXIS S/R sur le cas de référence BTCUSDT 4h (3 000 bougies closes)", () => {
  /** Une ligne du JSON, colonnes `time`, `open`, `high`, `low`, `close`, `volume`, `buyVolume`. */
  type LigneBougie = [time: number, open: number, high: number, low: number, close: number, volume: number, buyVolume: number];
  const btc: Candle[] = (fixtureBtc.bougies as LigneBougie[]).map(([time, open, high, low, close, volume, buyVolume]) => ({
    time,
    open,
    high,
    low,
    close,
    volume,
    buyVolume,
    sellVolume: volume - buyVolume,
    closed: true,
  }));
  /** Calcul complet tel que le graphe le fait : réglages par défaut, `refClose` = les closes, unité 4h. */
  const annotations = computeIndicator(getIndicator("stratAxisSr")!, btc, {}, { refClose: btc.map((c) => c.close) }, "4h").annotations!;

  it("réticule au milieu de la bande d'une zone tracée : sa ligne est rendue à chaque bougie couverte, même près de trois marqueurs", () => {
    const template = templateCapture();
    const zones = (annotations.rubans ?? []).filter((r) => r.info !== undefined);
    expect(zones.length).toBeGreaterThan(0);
    // Une ligne de zone se reconnaît à ce qu'un ruban la porte, jamais à son libellé.
    const infosZones = new Set(zones.map((zone) => zone.info));
    let couvertes = 0;
    let presDeTroisMarqueurs = 0;
    const sansLigne: string[] = [];
    for (const zone of zones) {
      for (let k = 0; k < zone.hauts.length; k++) {
        const idx = zone.deIdx + k;
        const milieu = (zone.hauts[k]! + zone.bas[k]!) / 2;
        const rendues = (tooltip(template, annotations, idx, { paneId: "candle_pane", y: yDe(milieu) })?.values ?? []).map((v) => v.value);
        couvertes++;
        if (!rendues.includes(zone.info!)) sansLigne.push(`${idx} : ${zone.info}`);
        // Sans ordonnée, rien n'est réservé : trois lignes sans zone = trois marqueurs proches.
        const sansReticule = (tooltip(template, annotations, idx)?.values ?? []).map((v) => String(v.value));
        if (sansReticule.length === 3 && sansReticule.every((ligne) => !infosZones.has(ligne))) presDeTroisMarqueurs++;
      }
    }
    expect(sansLigne).toEqual([]);
    // Le cas visé existe bien sur la série réelle, et les bandes couvrent l'essentiel des bougies.
    expect(presDeTroisMarqueurs).toBeGreaterThan(0);
    expect(couvertes).toBeGreaterThan(3000);
  });
});
