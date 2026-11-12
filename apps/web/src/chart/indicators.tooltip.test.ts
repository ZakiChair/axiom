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
import type { AnnotationsIndicateur, Candle, IndicatorResult, Timeframe } from "@axiom/types";
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

import { axiomName, ChartIndicators, couperInfo, infosSousReticule, rangeesInfobulle } from "./indicators";

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

// ── Phase 2 d'AXIS (12 novembre 2026) : le texte de ce qui est sous le doigt ──────────────────────
//
// Au téléphone, une rangée de l'infobulle est coupée au bord du canvas : le détail d'une zone ou
// d'un triangle ne se lisait qu'au bureau. `infosSousReticule` rend, en plus des lignes de
// l'infobulle, le texte de CE qui est sous le doigt (`vise`) ; `ChartIndicators.texteVise` le lit
// sur les indicateurs montés, et l'encart du téléphone l'affiche en entier. Annotations du cas de
// référence BTCUSDT 4h, lues par leur STRUCTURE (ruban, marqueur creux), jamais par leur libellé.

/** Une ligne du JSON, colonnes `time`, `open`, `high`, `low`, `close`, `volume`, `buyVolume`. */
type LigneFixture = [time: number, open: number, high: number, low: number, close: number, volume: number, buyVolume: number];
const BTC: Candle[] = (fixtureBtc.bougies as LigneFixture[]).map(([time, open, high, low, close, volume, buyVolume]) => ({
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

/** Annotations telles que le graphe les calcule : `refClose` = les closes, unité du graphe. */
function calculer(defId: string, params: ActiveIndicator["params"] = {}, bougies: Candle[] = BTC, unite: Timeframe = "4h"): AnnotationsIndicateur {
  return computeIndicator(getIndicator(defId)!, bougies, params, { refClose: bougies.map((c) => c.close) }, unite).annotations!;
}

const AXIS_SR = calculer("stratAxisSr");

/**
 * Axe à l'échelle du téléphone : 14 $ par pixel (le pane de 584 px y montre environ 8 000 $).
 * À 1 $ par pixel, aucun marqueur n'est jamais à 24 px du milieu d'une bande de BTC.
 */
const yTelephone = (prix: number): number => (130_000 - prix) / 14;

describe("infosSousReticule — le texte de ce qui est sous le doigt", () => {
  const PRIX = "candle_pane";
  const viser = (annotations: AnnotationsIndicateur, idx: number, prix?: number, pane = PRIX) =>
    infosSousReticule(annotations, { dataIndex: idx, paneId: pane, y: prix === undefined ? undefined : yDe(prix) }, PRIX, AXE_Y.convertToPixel);
  const marqueur = (idx: number, valeur: number, info: string | undefined) =>
    ({ idx, valeur, forme: "triangleHaut", couleur: "--up", cible: "prix", info }) as const;

  it("`infos` est la liste que l'infobulle rend ; hors données, rien", () => {
    const annotations = { marqueurs: [marqueur(2, 95, "marqueur M")], rubans: RUBANS };
    expect(viser(annotations, 1, 85).infos).toEqual(["marqueur M", "faible D", "forte A"]);
    expect(viser(annotations, -1, 85)).toEqual({ infos: [], rang: 3 });
    expect(infosSousReticule(annotations, { paneId: PRIX, y: yDe(85) }, PRIX, AXE_Y.convertToPixel)).toEqual({ infos: [], rang: 3 });
  });

  it("a. marqueur à 1 bougie ou moins et à 24 px ou moins : lui, même dans une bande", () => {
    const annotations = { marqueurs: [marqueur(1, 86, "triangle T")], rubans: RUBANS };
    expect(viser(annotations, 1, 85).vise).toBe("triangle T");
    expect(viser(annotations, 2, 85).vise).toBe("triangle T");
    expect(viser(annotations, 0, 86 + 24).vise).toBe("triangle T");
  });

  it("a. le plus proche en bougies, puis l'ordre du tableau", () => {
    const voisin = marqueur(0, 85, "voisin");
    const pile = marqueur(1, 85, "pile");
    expect(viser({ marqueurs: [voisin, pile] }, 1, 85).vise).toBe("pile");
    expect(viser({ marqueurs: [pile, voisin] }, 1, 85).vise).toBe("pile");
    expect(viser({ marqueurs: [marqueur(1, 85, "premier"), marqueur(1, 86, "second")] }, 1, 85).vise).toBe("premier");
    // Un marqueur sans texte ne masque pas le suivant.
    expect(viser({ marqueurs: [marqueur(1, 85, undefined), marqueur(1, 86, "second")] }, 1, 85).vise).toBe("second");
  });

  it("b. marqueur trop loin (2 bougies, ou 25 px) : la bande qui contient le réticule", () => {
    const large = { deIdx: 0, hauts: [200, 200, 200, 200], bas: [80, 80, 80, 80], couleur: "--up", alpha: 0.2, info: "zone large" };
    expect(viser({ marqueurs: [marqueur(0, 86, "triangle T")], rubans: [large] }, 2, 86).vise).toBe("zone large");
    expect(viser({ marqueurs: [marqueur(1, 86, "triangle T")], rubans: [large] }, 1, 86 + 25).vise).toBe("zone large");
    // Deux bandes sous le réticule : la première dans l'ordre du tableau, celle dont la ligne est réservée.
    expect(viser({ rubans: [bande(100, 110, "forte A"), bande(105, 115, "forte A2")] }, 1, 107).vise).toBe("forte A");
  });

  it("c. hors de toute bande : le premier segment ou marqueur à 3 bougies ou moins ; d. sinon rien", () => {
    const segment = { ...SEGMENT_BASE, aIdx: 3, cible: "prix" as const, info: "segment S" };
    const loin = marqueur(1, 500, "marqueur loin");
    expect(viser({ segments: [segment], marqueurs: [loin], rubans: RUBANS }, 1, 136).vise).toBe("segment S");
    expect(viser({ marqueurs: [loin], rubans: RUBANS }, 1, 136).vise).toBe("marqueur loin");
    expect(viser({ marqueurs: [marqueur(9, 500, "trop loin")], rubans: RUBANS }, 1, 136).vise).toBe(undefined);
    expect(viser({}, 1, 136)).toEqual({ infos: [], vise: undefined, rang: 3 });
  });

  it("`rang` classe le texte visé : 0 ou 1 pour un marqueur sous le doigt (son écart en bougies), 2 pour la bande, 3 pour le voisin ou rien", () => {
    const annotations = { marqueurs: [marqueur(1, 86, "triangle T")], rubans: RUBANS };
    expect(viser(annotations, 1, 85)).toMatchObject({ vise: "triangle T", rang: 0 });
    expect(viser(annotations, 2, 85)).toMatchObject({ vise: "triangle T", rang: 1 });
    expect(viser(annotations, 0, 85)).toMatchObject({ vise: "triangle T", rang: 1 });
    // À 3 bougies du marqueur, dans la bande : la bande. Hors de toute bande : le marqueur, en voisin.
    const large = { deIdx: 0, hauts: [90, 90, 90, 90, 90], bas: [80, 80, 80, 80, 80], couleur: "--up", alpha: 0.2, info: "zone large" };
    expect(viser({ marqueurs: annotations.marqueurs, rubans: [large] }, 4, 85)).toMatchObject({ vise: "zone large", rang: 2 });
    expect(viser(annotations, 1, 136)).toMatchObject({ vise: "triangle T", rang: 3 });
    expect(viser({ rubans: RUBANS }, 1, 136)).toMatchObject({ vise: undefined, rang: 3 });
  });

  it("réticule sur un autre pane ou sans ordonnée : rien n'est visé, les lignes restent", () => {
    const annotations = { marqueurs: [marqueur(1, 85, "triangle T")], rubans: RUBANS };
    expect(viser(annotations, 1, 85, "axiom_volume")).toEqual({ infos: ["triangle T", "forte A", "forte B"], vise: undefined, rang: 3 });
    expect(viser(annotations, 1)).toEqual({ infos: ["triangle T", "forte A", "forte B"], vise: undefined, rang: 3 });
    expect(infosSousReticule(annotations, { dataIndex: 1, paneId: PRIX, y: Number.NaN }, PRIX, AXE_Y.convertToPixel).vise).toBe(undefined);
  });

  const viserAuTelephone = (idx: number, prix: number) =>
    infosSousReticule(AXIS_SR, { dataIndex: idx, paneId: PRIX, y: yTelephone(prix) }, PRIX, yTelephone);

  it("cas de référence : au milieu de chaque bande, la zone — sauf marqueur sous le doigt, qui passe devant", () => {
    const zones = (AXIS_SR.rubans ?? []).filter((r) => r.info !== undefined);
    const porteurs = (AXIS_SR.marqueurs ?? []).filter((m) => m.info !== undefined);
    let zonesVisees = 0;
    let marqueursVises = 0;
    for (const zone of zones) {
      for (let k = 0; k < zone.hauts.length; k++) {
        const idx = zone.deIdx + k;
        const milieu = (zone.hauts[k]! + zone.bas[k]!) / 2;
        const sousLeDoigt = porteurs.filter((m) => Math.abs(m.idx - idx) <= 1 && Math.abs(yTelephone(m.valeur) - yTelephone(milieu)) <= 24);
        const { vise } = viserAuTelephone(idx, milieu);
        if (sousLeDoigt.length === 0) {
          zonesVisees++;
          // Deux bandes peuvent se chevaucher : la zone visée est une de celles qui contiennent le réticule.
          const contenantes = zones.filter((z) => {
            const haut = z.hauts[idx - z.deIdx];
            const bas = z.bas[idx - z.deIdx];
            return idx >= z.deIdx && haut !== undefined && bas !== undefined && milieu <= haut && milieu >= bas;
          });
          expect(contenantes.map((z) => z.info)).toContain(vise);
        } else {
          marqueursVises++;
          // Le plus proche en bougies, puis le premier dans l'ordre du tableau.
          const ecart = Math.min(...sousLeDoigt.map((m) => Math.abs(m.idx - idx)));
          expect(vise).toBe(sousLeDoigt.find((m) => Math.abs(m.idx - idx) === ecart)!.info);
        }
      }
    }
    expect(zonesVisees).toBeGreaterThan(3000);
    // Le cas existe sur la série réelle (60 bougies couvertes à l'écriture du test).
    expect(marqueursVises).toBeGreaterThan(30);
  });

  it("cas de référence : le réticule sur le point de chacun des 120 triangles creux rend son texte", () => {
    const creux = (AXIS_SR.marqueurs ?? []).filter((m) => m.creux === true);
    expect(creux).toHaveLength(120);
    for (const m of creux) {
      expect(viser(AXIS_SR, m.idx, m.valeur).vise).toBe(m.info);
      // À l'échelle du téléphone aussi, où d'autres marqueurs sont à 24 px ou moins.
      expect(viserAuTelephone(m.idx, m.valeur).vise).toBe(m.info);
    }
  });
});

describe("ChartIndicators.texteVise — le texte visé, lu sur les indicateurs montés du pane des prix", () => {
  /**
   * Graphe factice : rend à `getIndicatorByPaneId` ce que `createIndicator` a reçu. `defIds` : les
   * instances montées, dans cet ordre. `convertir` : ordonnée (px) d'un prix sur le pane des prix.
   */
  function monter(defIds: string | string[], bougies: Candle[], convertir: (prix: number) => number = yDe) {
    const ids = [defIds].flat();
    const montes = new Map<string, { extendData?: unknown }>();
    const chart = {
      createIndicator: (c: { name: string; extendData?: unknown }, _s: boolean, opts?: { id: string }) => {
        montes.set(`${opts?.id}/${c.name}`, c);
        return opts?.id ?? null;
      },
      overrideIndicator: () => {},
      removeIndicator: () => {},
      getSize: () => ({ top: 0, left: 0, width: 800, height: 100, right: 800, bottom: 100 }),
      setPaneOptions: () => {},
      getIndicatorByPaneId: (paneId: string, name: string) => montes.get(`${paneId}/${name}`) ?? null,
      convertToPixel: (point: { value: number }, finder: { paneId: string }) => (finder.paneId === "candle_pane" ? { y: convertir(point.value) } : {}),
    };
    const indicateurs = new ChartIndicators(chart as unknown as Chart);
    indicateurs.sync(ids.map((defId, i) => ({ instanceId: `vise-${i}-${defId}`, defId, params: {}, couleurIdx: i })), bougies, "binance");
    const monte = (i: number) => montes.get(`candle_pane/${axiomName(`vise-${i}-${ids[i]}`)}`);
    const annotationsDe = (i: number) => (monte(i)?.extendData as IndicatorResult | undefined)?.annotations;
    return {
      indicateurs,
      /** Annotations de la première instance montée. */
      annotations: annotationsDe(0),
      annotationsDe,
      /** Remplace les annotations de la i-ième instance montée (cas construits). */
      poser: (i: number, annotations: AnnotationsIndicateur) => {
        monte(i)!.extendData = { series: {}, annotations } satisfies IndicatorResult;
      },
    };
  }
  const reticule = (dataIndex: number | undefined, prix: number | undefined, paneId = "candle_pane", convertir: (prix: number) => number = yDe) =>
    ({ dataIndex, paneId, y: prix === undefined ? undefined : convertir(prix) }) as Parameters<ChartIndicators["texteVise"]>[0];

  it("AXIS S/R monté : la zone au milieu de sa bande, le triangle creux sur son point", () => {
    const { indicateurs, annotations } = monter("stratAxisSr", BTC);
    const zone = (annotations?.rubans ?? []).find((r) => r.info !== undefined)!;
    const fin = zone.hauts.length - 1;
    const milieu = (zone.hauts[fin]! + zone.bas[fin]!) / 2;
    const attendu = infosSousReticule(annotations!, { dataIndex: zone.deIdx + fin, paneId: "candle_pane", y: yDe(milieu) }, "candle_pane", AXE_Y.convertToPixel).vise;
    expect(attendu).toBeDefined();
    expect(indicateurs.texteVise(reticule(zone.deIdx + fin, milieu))).toBe(attendu);
    const creux = (annotations?.marqueurs ?? []).filter((m) => m.creux === true);
    expect(creux.length).toBeGreaterThan(0);
    for (const m of creux) expect(indicateurs.texteVise(reticule(m.idx, m.valeur))).toBe(m.info);
  });

  it("autre pane, réticule hors données ou sans ordonnée : rien", () => {
    const { indicateurs, annotations } = monter("stratAxisSr", BTC);
    const m = (annotations?.marqueurs ?? []).find((x) => x.creux === true)!;
    expect(indicateurs.texteVise(reticule(m.idx, m.valeur))).toBe(m.info);
    expect(indicateurs.texteVise(reticule(m.idx, m.valeur, "axiom_rsi"))).toBe(undefined);
    expect(indicateurs.texteVise(reticule(undefined, m.valeur))).toBe(undefined);
    expect(indicateurs.texteVise(reticule(m.idx, undefined))).toBe(undefined);
  });

  it("indicateur sans annotation (SMA) : rien", () => {
    const { indicateurs } = monter("sma", candles);
    expect(indicateurs.texteVise(reticule(1, 1))).toBe(undefined);
  });

  // Revue globale du 12 novembre 2026 (mineur) : l'encart du téléphone ne lisait son texte qu'au
  // changement de réticule. AXIS S/R fermé doigt levé, il gardait le texte d'une zone que le graphe
  // ne dessinait plus. `apresCalcul` prévient l'encart, APRÈS que le montage a changé.
  it("`apresCalcul` : rappelé après chaque recalcul, montage et retrait ; AXIS S/R retiré, plus rien n'est visé au rappel", () => {
    const { indicateurs, annotations } = monter("stratAxisSr", BTC);
    const m = (annotations?.marqueurs ?? []).find((x) => x.creux === true)!;
    const instance = { instanceId: "vise-0-stratAxisSr", defId: "stratAxisSr", params: {}, couleurIdx: 0 };
    const vises: Array<string | undefined> = [];
    indicateurs.apresCalcul = () => vises.push(indicateurs.texteVise(reticule(m.idx, m.valeur)));
    indicateurs.recompute([instance], BTC, "binance");
    expect(vises).toEqual([m.info]);
    // Un second indicateur monté : rappel, le texte visé est le même.
    indicateurs.sync([instance, { instanceId: "vise-1-sma", defId: "sma", params: {}, couleurIdx: 1 }], BTC, "binance");
    expect(vises).toEqual([m.info, m.info]);
    // AXIS S/R retiré : au rappel, son triangle n'est plus visé.
    indicateurs.sync([], BTC, "binance");
    expect(vises).toEqual([m.info, m.info, undefined]);
    // Sans rappel posé : rien ne casse.
    indicateurs.apresCalcul = null;
    indicateurs.sync([instance], BTC, "binance");
    expect(vises).toHaveLength(3);
  });

  // Revue du 12 novembre 2026 (constat majeur) : avec AXIS monté avant AXIS S/R, le doigt DANS une
  // bande sans marqueur dessous lisait « AXIS forte vente … », le texte d'un marqueur d'AXIS à
  // 3 bougies et 370 px plus haut. Chaque instance rendait son meilleur texte, repli (c) compris, et
  // la première dans l'ordre de montage gagnait. La règle a → b → c vaut pour l'ENSEMBLE des
  // instances du pane des prix ; à rang égal, l'ordre de montage.
  describe("plusieurs indicateurs sur le pane des prix : une seule règle pour l'ensemble", () => {
    const marqueur = (idx: number, valeur: number, info: string) => ({ idx, valeur, forme: "triangleHaut", couleur: "--up", cible: "prix", info }) as const;
    /** Deux instances aux annotations construites, `premiere` montée avant `seconde` ; rend le texte visé. */
    function deux(premiere: AnnotationsIndicateur, seconde: AnnotationsIndicateur) {
      const montage = monter(["sma", "sma"], candles);
      montage.poser(0, premiere);
      montage.poser(1, seconde);
      return (idx: number, prix: number) => montage.indicateurs.texteVise(reticule(idx, prix));
    }
    /** Bande [80, 90] sur les bougies 0 à 2. */
    const ZONE = { rubans: [bande(80, 90, "zone Z")] };
    /** Marqueur à la bougie 1, 415 px au-dessus de la bande : à 3 bougies ou moins, pas sous le doigt. */
    const LOIN = { marqueurs: [marqueur(1, 500, "marqueur loin")] };
    /** Marqueur dans la bande, à la bougie 1. */
    const DESSOUS = { marqueurs: [marqueur(1, 86, "triangle T")] };

    it("b avant c : la bande sous le doigt passe avant le marqueur à 3 bougies d'un autre indicateur, quel que soit l'ordre de montage", () => {
      expect(deux(LOIN, ZONE)(1, 85)).toBe("zone Z");
      expect(deux(ZONE, LOIN)(1, 85)).toBe("zone Z");
      // Segment (pré-signal) d'un autre indicateur à 3 bougies ou moins : même rang c.
      const segment = { segments: [{ ...SEGMENT_BASE, aIdx: 2, cible: "prix" as const, info: "segment S" }] };
      expect(deux(segment, ZONE)(1, 85)).toBe("zone Z");
      expect(deux(ZONE, segment)(1, 85)).toBe("zone Z");
    });

    it("a avant b : le marqueur sous le doigt passe avant la bande d'un autre indicateur, quel que soit l'ordre de montage", () => {
      expect(deux(ZONE, DESSOUS)(1, 85)).toBe("triangle T");
      expect(deux(DESSOUS, ZONE)(1, 85)).toBe("triangle T");
      // Marqueur à 30 px sous la bande, donc plus sous le doigt : il n'est que le repli c, la bande passe.
      expect(deux({ marqueurs: [marqueur(1, 55, "sous la bande")] }, ZONE)(1, 85)).toBe("zone Z");
    });

    it("a : le marqueur le plus proche en bougies, tous indicateurs confondus", () => {
      const voisin = { marqueurs: [marqueur(0, 85, "voisin")] };
      const pile = { marqueurs: [marqueur(1, 85, "pile")] };
      expect(deux(voisin, pile)(1, 85)).toBe("pile");
      expect(deux(pile, voisin)(1, 85)).toBe("pile");
    });

    it("à rang égal, l'ordre de montage", () => {
      const A = { marqueurs: [marqueur(1, 85, "marqueur A")], rubans: [bande(80, 90, "zone A")] };
      const B = { marqueurs: [marqueur(1, 86, "marqueur B")], rubans: [bande(82, 92, "zone B")] };
      // a : deux marqueurs sous le doigt, à la même bougie.
      expect(deux(A, B)(1, 85)).toBe("marqueur A");
      expect(deux(B, A)(1, 85)).toBe("marqueur B");
      // b : deux bandes sous le doigt.
      expect(deux({ rubans: A.rubans }, { rubans: B.rubans })(1, 85)).toBe("zone A");
      expect(deux({ rubans: B.rubans }, { rubans: A.rubans })(1, 85)).toBe("zone B");
      // c : deux marqueurs à 3 bougies ou moins, aucun sous le doigt, hors de toute bande.
      const loinA = { marqueurs: [marqueur(2, 500, "loin A")] };
      const loinB = { marqueurs: [marqueur(0, 400, "loin B")] };
      expect(deux(loinA, loinB)(1, 136)).toBe("loin A");
      expect(deux(loinB, loinA)(1, 136)).toBe("loin B");
    });

    it("rien de visé par aucun indicateur : rien ; un premier indicateur sans annotation ne masque pas le second", () => {
      expect(deux({}, {})(1, 85)).toBe(undefined);
      expect(deux({ marqueurs: [marqueur(9, 85, "trop loin")] }, { rubans: [bande(100, 110, "ailleurs")] })(1, 85)).toBe(undefined);
      expect(deux({}, ZONE)(1, 85)).toBe("zone Z");
    });

    it("cas de référence, AXIS et AXIS S/R montés dans les deux ordres : au milieu d'une bande sans marqueur sous le doigt, la zone", () => {
      for (const ordre of [["stratAxis", "stratAxisSr"], ["stratAxisSr", "stratAxis"]]) {
        const montage = monter(ordre, BTC, yTelephone);
        const axis = montage.annotationsDe(ordre.indexOf("stratAxis"))!;
        const axisSr = montage.annotationsDe(ordre.indexOf("stratAxisSr"))!;
        const zones = (axisSr.rubans ?? []).filter((r) => r.info !== undefined);
        // AXIS ne trace aucune bande : toute bande sous le doigt est une zone d'AXIS S/R.
        expect((axis.rubans ?? []).filter((r) => r.info !== undefined)).toEqual([]);
        const marqueurs = [...(axis.marqueurs ?? []), ...(axisSr.marqueurs ?? [])].filter((m) => m.info !== undefined);
        /** Segments et marqueurs d'AXIS porteurs d'un texte : le repli c d'AXIS, qui passait devant la zone. */
        const replisAxis = [
          ...(axis.segments ?? []).filter((s) => s.info !== undefined).map((s) => s.aIdx),
          ...(axis.marqueurs ?? []).filter((m) => m.info !== undefined).map((m) => m.idx),
        ];
        expect(replisAxis.length).toBeGreaterThan(50);
        let cibles = 0;
        let presDUnTexteAxis = 0;
        const autres: string[] = [];
        for (const zone of zones) {
          for (let k = 0; k < zone.hauts.length; k++) {
            const idx = zone.deIdx + k;
            const milieu = (zone.hauts[k]! + zone.bas[k]!) / 2;
            if (marqueurs.some((m) => Math.abs(m.idx - idx) <= 1 && Math.abs(yTelephone(m.valeur) - yTelephone(milieu)) <= 24)) continue;
            cibles++;
            if (replisAxis.some((i) => Math.abs(i - idx) <= 3)) presDUnTexteAxis++;
            // Deux bandes peuvent se chevaucher : la zone visée est une de celles qui contiennent le réticule.
            const contenantes = zones.filter((z) => {
              const haut = z.hauts[idx - z.deIdx];
              const bas = z.bas[idx - z.deIdx];
              return idx >= z.deIdx && haut !== undefined && bas !== undefined && milieu <= haut && milieu >= bas;
            });
            const vise = montage.indicateurs.texteVise(reticule(idx, milieu, "candle_pane", yTelephone));
            if (!contenantes.some((z) => z.info === vise) && autres.length < 5) autres.push(`${ordre[0]} d'abord, bougie ${idx} : ${vise?.slice(0, 40)}`);
          }
        }
        expect(autres).toEqual([]);
        expect(cibles).toBeGreaterThan(10_000);
        // Le cas du constat existe sur la série réelle : un texte d'AXIS à 3 bougies ou moins d'une cible sur cinq.
        expect(presDUnTexteAxis).toBeGreaterThan(1500);
      }
    });
  });
});

// ── Phase 2 d'AXIS (12 novembre 2026) : rangées coupées aux mots entiers ─────────────────────────
//
// Le bord du canvas coupait chaque rangée net, au milieu d'un nombre (« bord à +1 » pour +11.7 %,
// « > 11302 » pour 113028.30). `couperInfo` s'arrête au dernier mot entier et ajoute « … », sans
// jamais retirer un mot que la coupe nette montrait ; `rangeesInfobulle` garde un texte par
// rangée ; le rappel du moteur mesure dans la police de l'infobulle, à la largeur du pane.

/** Textes d'infobulle par famille d'annotation. */
function familles(a: AnnotationsIndicateur) {
  const marqueurs = (a.marqueurs ?? []).filter((m) => m.info !== undefined);
  const infos = (liste: Array<{ info?: string }>) => liste.map((x) => x.info!);
  return {
    zones: infos((a.rubans ?? []).filter((r) => r.info !== undefined)),
    creux: infos(marqueurs.filter((m) => m.creux === true)),
    retournements: infos(marqueurs.filter((m) => m.couleur === "--text-dim")),
    forts: infos(marqueurs.filter((m) => m.couleur === "--accent")),
    confirmes: infos(marqueurs.filter((m) => m.creux !== true && (m.couleur === "--up" || m.couleur === "--down"))),
    preSignal: infos((a.segments ?? []).filter((s) => s.info !== undefined)),
  };
}

const REFERENCE = familles(AXIS_SR);
const RETOURNEMENTS = familles(calculer("stratAxisSr", { detecterRetournements: true })).retournements;
/** Dernière bougie décidée en pré-signal : niveaux 113028.30, 94023.57 et 64024.02 (9 et 8 caractères). */
const PRE_SIGNAUX = [470, 1043, 2289].flatMap((n) => familles(calculer("stratAxisSr", {}, BTC.slice(0, n))).preSignal);

/** Mesure injectée : 6 px par caractère, comme une police à chasse fixe de 10 px. */
const mesure6 = (texte: string): number => texte.length * 6;
/** Largeurs de rangée du brief : 34, 38, 40, 45, 49, 55 et 179 caractères visibles. */
const LARGEURS = [204, 228, 240, 270, 298, 330, 1077];
/** Séparateur resté seul en fin de rangée ; « > » annonce un niveau et ne dit rien sans lui. */
const SEPARATEUR_SEUL = /^[—·;:>]$/;
/** Espace insécable (U+00A0) qui complète une rangée, et ce qu'il reste de la rangée sans lui. */
const INSECABLE = String.fromCharCode(0xa0);
const sansFin = (rangee: string): string => rangee.replace(new RegExp(`${INSECABLE}+$`), "");
const sansPoints = (rangee: string): string => (rangee.endsWith("…") ? rangee.slice(0, -1) : rangee);

/** Ce que la coupe nette d'avant montrait : les caractères entiers qui tenaient dans la rangée. */
const coupeNette = (info: string, largeur: number): string => info.slice(0, Math.floor(largeur / 6));

describe("cas de référence : les textes sont bien ceux que le brief compte", () => {
  it("12 zones, 120 triangles creux, 34 signaux confirmés, 57 forts mouvements, 40 retournements, 3 pré-signaux", () => {
    expect(REFERENCE.zones).toHaveLength(12);
    expect(REFERENCE.creux).toHaveLength(120);
    expect(REFERENCE.confirmes).toHaveLength(34);
    expect(REFERENCE.forts).toHaveLength(57);
    expect(RETOURNEMENTS).toHaveLength(40);
    expect(PRE_SIGNAUX).toHaveLength(3);
    expect(PRE_SIGNAUX[0]).toContain("> 113028.30 —");
  });
});

describe("couperInfo — une rangée s'arrête au dernier mot entier, suivie de « … »", () => {
  const TOUS = [...REFERENCE.zones, ...REFERENCE.creux, ...REFERENCE.confirmes, ...REFERENCE.forts, ...RETOURNEMENTS, ...PRE_SIGNAUX];

  it("un texte qui tient est rendu tel quel, sans « … »", () => {
    expect(couperInfo("AXIS support fort", 17 * 6, mesure6)).toBe("AXIS support fort");
    expect(couperInfo("", 0, mesure6)).toBe("");
  });

  it("préfixe à frontière de mot, qui tient, que le mot suivant ferait déborder, jamais terminé par un séparateur seul", () => {
    let coupes = 0;
    for (const info of TOUS) {
      for (const largeur of LARGEURS) {
        const rangee = couperInfo(info, largeur, mesure6);
        if (mesure6(info) <= largeur) {
          expect(rangee).toBe(info);
          continue;
        }
        coupes++;
        expect(rangee.endsWith("…")).toBe(true);
        const corps = sansPoints(rangee);
        // Préfixe du texte, arrêté juste avant une espace.
        expect(info.startsWith(`${corps} `)).toBe(true);
        expect(mesure6(corps)).toBeLessThanOrEqual(largeur);
        expect(SEPARATEUR_SEUL.test(corps.split(" ").at(-1)!)).toBe(false);
        // Référence indépendante, mot à mot : le plus long préfixe qui tient, séparateurs de fin retirés.
        const mots = info.split(" ");
        let n = 1;
        while (n < mots.length && mesure6(mots.slice(0, n + 1).join(" ")) <= largeur) n++;
        // Le mot suivant ne tiendrait pas.
        expect(mesure6(mots.slice(0, n + 1).join(" "))).toBeGreaterThan(largeur);
        while (n > 1 && SEPARATEUR_SEUL.test(mots[n - 1]!)) n--;
        expect(corps).toBe(mots.slice(0, n).join(" "));
      }
    }
    expect(coupes).toBeGreaterThan(1500);
  });

  it("aucun mot entièrement visible sous la coupe nette n'est retiré pour faire place à « … »", () => {
    for (const info of TOUS) {
      for (const largeur of LARGEURS) {
        const net = coupeNette(info, largeur);
        if (net.length === info.length) continue;
        // Mots entiers de la coupe nette : tous, sauf le dernier quand il est entamé.
        const entiers = info[net.length] === " " ? net : net.slice(0, Math.max(0, net.lastIndexOf(" ")));
        const attendus = entiers.split(" ");
        while (attendus.length > 1 && SEPARATEUR_SEUL.test(attendus.at(-1)!)) attendus.pop();
        expect(sansPoints(couperInfo(info, largeur, mesure6)).split(" ").slice(0, attendus.length)).toEqual(attendus);
      }
    }
  });

  it("doctrine : toute rangée qui montrait « non mesuré » sous la coupe nette le montre encore, à chaque largeur", () => {
    let montraient = 0;
    for (const info of TOUS) {
      for (const largeur of LARGEURS) {
        if (!coupeNette(info, largeur).includes("non mesuré")) continue;
        montraient++;
        expect(couperInfo(info, largeur, mesure6)).toContain("non mesuré");
      }
    }
    // Triangles creux, retournements et pré-signaux, aux sept largeurs.
    expect(montraient).toBeGreaterThanOrEqual((120 + 40 + 3) * LARGEURS.length);
  });

  it("triangles creux et retournements : « non mesuré » dès 34 caractères de large, là où « … » dépasse", () => {
    for (const info of [...REFERENCE.creux, ...RETOURNEMENTS]) {
      expect(coupeNette(info, 204)).toContain("non mesuré");
      expect(couperInfo(info, 204, mesure6)).toContain("non mesuré");
    }
    // 34 caractères exactement : le mot reste, « … » est rogné par le bord (35 caractères rendus).
    expect(couperInfo(REFERENCE.creux[0]!, 204, mesure6)).toBe("AXIS S/R signal précoce non mesuré…");
  });

  it("pré-signal : « non mesuré » dès 26 caractères ; le niveau est entier ou absent, jamais tronqué", () => {
    for (const info of PRE_SIGNAUX) {
      const niveau = /> (\S+) —/.exec(info)![1]!;
      for (let largeur = 26 * 6; largeur <= 60 * 6; largeur += 6) {
        const rangee = couperInfo(info, largeur, mesure6);
        expect(rangee).toContain("non mesuré");
        // Aucun autre chiffre que ceux du niveau dans ce texte : entier, ou aucun chiffre.
        expect(rangee.includes(niveau) || !/\d/.test(rangee)).toBe(true);
      }
    }
    // Le cas qui trompait à 320 px en chasse fixe : « > 11302 » pour 113028.30.
    expect(coupeNette(PRE_SIGNAUX[0]!, 204)).toBe("AXIS pré-signal non mesuré > 11302");
    // Revue du 12 novembre 2026 : « > » restait seul en fin (« non mesuré >… »), sans le niveau qu'il annonce.
    expect(couperInfo(PRE_SIGNAUX[0]!, 204, mesure6)).toBe("AXIS pré-signal non mesuré…");
    expect(couperInfo(PRE_SIGNAUX[0]!, 38 * 6, mesure6)).toBe("AXIS pré-signal non mesuré > 113028.30…");
  });

  it("pré-signal : « > » n'est jamais rendu sans son niveau, à aucune largeur", () => {
    let sansNiveau = 0;
    for (const info of PRE_SIGNAUX) {
      const niveau = /> (\S+) —/.exec(info)![1]!;
      for (let largeur = 26 * 6; largeur <= 60 * 6; largeur += 6) {
        const rangee = couperInfo(info, largeur, mesure6);
        if (!rangee.includes(niveau)) sansNiveau++;
        expect(rangee.includes(">")).toBe(rangee.includes(`> ${niveau}`));
      }
    }
    // Le cas existe : des largeurs où le niveau ne tient pas.
    expect(sansNiveau).toBeGreaterThan(10);
  });

  it("tête d'une zone : plus aucun écart tronqué (« bord à +1 » pour +11.7 %)", () => {
    let ecarts = 0;
    for (const info of REFERENCE.zones) {
      const ecart = /bord à (\S+) %/.exec(info)?.[1];
      if (ecart === undefined) continue;
      ecarts++;
      for (const largeur of LARGEURS) {
        const rangee = couperInfo(info, largeur, mesure6);
        expect(rangee.includes(`bord à ${ecart}`) || !rangee.includes("bord à ")).toBe(true);
      }
    }
    expect(ecarts).toBeGreaterThan(0);
  });

  it("premier mot plus large que la rangée : ce mot seul, suivi de « … » ; séparateurs de fin retirés ensemble", () => {
    expect(couperInfo("Divergence haussière", 12, mesure6)).toBe("Divergence…");
    expect(couperInfo("a — · b", 5 * 6, mesure6)).toBe("a…");
    expect(couperInfo("a ; b", 3 * 6, mesure6)).toBe("a…");
    expect(couperInfo("zone : 12", 6 * 6, mesure6)).toBe("zone…");
    expect(couperInfo("seuil > 12", 7 * 6, mesure6)).toBe("seuil…");
    // « > » suivi de son niveau reste, et un séparateur au milieu du texte n'est pas touché.
    expect(couperInfo("seuil > 12 puis", 10 * 6, mesure6)).toBe("seuil > 12…");
  });

  it("police à chasse variable : même règle, le dernier mot entier qui tient", () => {
    // « i », « l » et l'espace comptent 3 px, les autres caractères 7 px.
    const variable = (texte: string): number => [...texte].reduce((px, c) => px + (c === "i" || c === "l" || c === " " ? 3 : 7), 0);
    for (const info of [...REFERENCE.zones, ...REFERENCE.creux.slice(0, 20)]) {
      for (const largeur of [150, 228, 298]) {
        const corps = sansPoints(couperInfo(info, largeur, variable));
        expect(info.startsWith(`${corps} `)).toBe(true);
        expect(variable(corps)).toBeLessThanOrEqual(largeur);
        // Jusqu'au mot suivant qui n'est pas un séparateur seul : trop large.
        const mots = info.split(" ");
        let n = corps.split(" ").length;
        while (n < mots.length && SEPARATEUR_SEUL.test(mots[n]!)) n++;
        expect(variable(mots.slice(0, n + 1).join(" "))).toBeGreaterThan(largeur);
      }
    }
  });
});

describe("rangeesInfobulle — un texte par rangée dès qu'un texte est coupé", () => {
  it("rien à couper : le tableau reçu, tel quel (les textes courts restent côte à côte)", () => {
    const infos = ["a", "b", "c"];
    expect(rangeesInfobulle(infos, 228, mesure6)).toBe(infos);
    expect(rangeesInfobulle([], 228, mesure6)).toEqual([]);
  });

  it("un texte coupé : chaque rangée sauf la dernière dépasse la largeur à elle seule, la dernière n'est pas complétée", () => {
    let completees = 0;
    for (const largeur of LARGEURS) {
      for (const infos of [
        [REFERENCE.creux[0]!, REFERENCE.zones[0]!, REFERENCE.zones[1]!],
        ["court", REFERENCE.zones[0]!, "aussi court"],
        [REFERENCE.zones[0]!, "court"],
        [REFERENCE.confirmes[0]!],
      ]) {
        const rangees = rangeesInfobulle(infos, largeur, mesure6);
        if (infos.every((info) => mesure6(info) <= largeur)) {
          expect(rangees).toBe(infos);
          continue;
        }
        expect(rangees).toHaveLength(infos.length);
        rangees.forEach((rangee, i) => {
          // Le texte de la rangée est la coupe de son texte ; seules des espaces insécables suivent.
          expect(sansFin(rangee)).toBe(couperInfo(infos[i]!, largeur, mesure6));
          if (i === rangees.length - 1) {
            expect(rangee).toBe(sansFin(rangee));
            return;
          }
          completees++;
          expect(mesure6(rangee)).toBeGreaterThan(largeur);
          // Pas une espace de trop : une de moins, et la rangée ne dépasserait plus.
          expect(mesure6(rangee.slice(0, -1))).toBeLessThanOrEqual(largeur);
        });
      }
    }
    expect(completees).toBeGreaterThan(20);
  });

  it("une rangée déjà plus large que la rangée (premier mot trop long) n'est pas complétée", () => {
    expect(rangeesInfobulle(["Divergence haussière", "b"], 12, mesure6)).toEqual(["Divergence…", "b"]);
  });

  it("espace de largeur nulle : pas de complément, pas de boucle", () => {
    const sansEspace = (texte: string): number => texte.replaceAll(INSECABLE, "").length * 6;
    const infos = [REFERENCE.zones[0]!, REFERENCE.zones[1]!];
    expect(rangeesInfobulle(infos, 228, sansEspace)).toEqual(infos.map((info) => couperInfo(info, 228, sansEspace)));
  });
});

describe("createTooltipDataSource — rangées coupées à la largeur du pane que le moteur passe", () => {
  /** Styles par défaut de l'infobulle d'indicateur du moteur (bundle 9.8.12), police de l'application. */
  const STYLES = {
    tooltip: { offsetLeft: 4, offsetTop: 6, offsetRight: 4, text: { size: 11, family: "serif", weight: "normal", marginLeft: 8, marginTop: 4, marginRight: 8, marginBottom: 4 } },
  };
  const polices: string[] = [];
  /** Canvas factice : 6 px par caractère, la police posée est relevée. */
  const toile = {
    set font(police: string) {
      polices.push(police);
    },
    measureText: (texte: string) => ({ width: texte.length * 6 }),
  };

  /** Rangées rendues pour un pane de `largeurPane` px ; sans largeur, appel sans bornes ni styles. */
  function rangees(annotations: AnnotationsIndicateur, dataIndex: number, largeurPane?: number) {
    const extendData: IndicatorResult = { series: {}, annotations };
    return templateCapture().createTooltipDataSource?.({
      indicator: { extendData },
      crosshair: { dataIndex },
      yAxis: AXE_Y,
      ...(largeurPane === undefined ? {} : { bounding: { width: largeurPane }, defaultStyles: STYLES }),
    } as unknown as IndicatorCreateTooltipDataSourceParams);
  }
  const textes = (res: ReturnType<typeof rangees>): string[] => (res?.values ?? []).map((v) => String(v.value));

  it("pane de 240 px : rangées de 228 px (premier texte à 12 px du bord), un texte par rangée, forme { title, value } inchangée", () => {
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => toile }) });
    try {
      const entiers = textes(rangees(AXIS_SR, 2999));
      expect(entiers.length).toBeGreaterThan(1);
      const res = rangees(AXIS_SR, 2999, 240);
      expect(res?.values).toEqual(rangeesInfobulle(entiers, 228, mesure6).map((value) => ({ title: "", value })));
      expect(textes(res).every((rangee) => sansFin(rangee).endsWith("…"))).toBe(true);
      // La police mesurée est celle que le moteur dessine (`createFont` : graisse, taille, famille).
      expect(polices).toContain("normal 11px serif");
      // Plus large : la coupe suit la largeur du pane.
      expect(textes(rangees(AXIS_SR, 2999, 310))).toEqual(rangeesInfobulle(entiers, 298, mesure6));
      // Textes courts : rien n'est coupé, ils restent tels quels.
      const courts = { segments: ["a", "b"].map((info, i) => ({ ...SEGMENT_BASE, aIdx: 10 + i, cible: "prix" as const, info })) };
      expect(textes(rangees(courts, 10, 240))).toEqual(["a", "b"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sans bornes ni styles (appel hors du moteur) : textes entiers, au caractère près", () => {
    const entiers = textes(rangees(AXIS_SR, 2999));
    expect(entiers.length).toBeGreaterThan(0);
    expect(entiers.every((texte) => REFERENCE.zones.includes(texte) || REFERENCE.preSignal.includes(texte))).toBe(true);
  });
});
