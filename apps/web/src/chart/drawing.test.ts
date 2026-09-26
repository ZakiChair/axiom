/**
 * Tests du registre de dessin multi-chart (drawing.ts) :
 *  - garde `suppressPersist` : le `onRemoved` de teardown que klinecharts déclenche
 *    sur CHAQUE overlay au `dispose()` ne doit pas écraser les dessins persistés ;
 *  - migration douce de la clé « symbole » → « exchange:symbole » ;
 *  - ISOLATION multi-chart : deux instances liées ont des dessins/persistances propres,
 *    et les outils s'appliquent à l'instance FOCUS (setFocusChart).
 * Mock minimal de KLineChartInstance : seuls createOverlay/onDrawEnd/onRemoved/removeOverlay
 * sont exercés par drawing.ts, pas besoin du vrai klinecharts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chart as KLineChartInstance } from "klinecharts";
import {
  bindChart,
  coinsRectangle,
  drawingStore,
  exportChartImage,
  restoreDrawings,
  selectTool,
  setFocusChart,
  unbindChart,
  versPointGraphe,
  versPointSauve,
} from "./drawing";
import { indicatorsStore } from "../store/indicators";

// fibonacci.ts (importé par drawing.ts) appelle `registerOverlay` au chargement du
// module ; le build UMD de klinecharts ne s'évalue pas correctement hors navigateur
// (pas de `window`), donc on stub l'unique export runtime utilisé pour pouvoir
// importer drawing.ts dans cet environnement de test Node. (vi.mock est hissé par
// Vitest avant les imports statiques ci-dessus, peu importe l'ordre dans le fichier.)
// `registeredOverlayNames` capture les noms enregistrés au chargement du module (fib
// custom, VPFR, picker AVWAP, rect) pour vérifier que « rect » y figure bien.
const { registeredOverlayNames } = vi.hoisted(() => ({ registeredOverlayNames: [] as string[] }));
vi.mock("klinecharts", () => ({
  registerOverlay: (opts: { name: string }) => {
    registeredOverlayNames.push(opts.name);
  },
}));

const DRAWINGS_KEY = "axiom:drawings:v1";
const SYMBOL = "BTCUSDT";
const EXCHANGE = "binance";
const COMPOSITE_KEY = "binance:BTCUSDT";
const SLOT0_KEY = "0:binance:BTCUSDT";

type OverlayCallback = (event: { overlay: { id: string; points: unknown[] } }) => unknown;

/** Mock localStorage en mémoire (environnement de test Node, pas de DOM ici). */
function installMockLocalStorage(): Storage {
  const data = new Map<string, string>();
  const mock: Storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = mock;
  return mock;
}

/** Mock minimal d'une instance KLineChart : capture les callbacks de chaque overlay créé. */
function createMockChart() {
  let counter = 0;
  const callbacks = new Map<string, Record<string, OverlayCallback>>();
  let idPrefix = "";

  const chart = {
    createOverlay(opts: Record<string, unknown>) {
      const id = `${idPrefix}ov-${counter++}`;
      callbacks.set(id, opts as unknown as Record<string, OverlayCallback>);
      return id;
    },
    removeOverlay() {},
    overrideOverlay() {},
  } as unknown as KLineChartInstance;

  return {
    chart,
    /** Préfixe les ids d'overlay (distingue les instances dans les tests multi-chart). */
    setIdPrefix(p: string) {
      idPrefix = p;
    },
    finishDraw(id: string, points: Array<{ timestamp?: number; value?: number }>) {
      callbacks.get(id)?.onDrawEnd?.({ overlay: { id, points } });
    },
    teardown(id: string, points: Array<{ timestamp?: number; value?: number }>) {
      callbacks.get(id)?.onRemoved?.({ overlay: { id, points } });
    },
  };
}

function readStoredCount(localStorage: Storage, key = SLOT0_KEY): number {
  const all = JSON.parse(localStorage.getItem(DRAWINGS_KEY) ?? "{}") as Record<string, unknown[]>;
  return all[key]?.length ?? 0;
}

describe("drawing.ts — exportChartImage sans graphe actif", () => {
  // Aucun chart lié (état initial du module, `activeChart === null`) : l'export sort
  // en amont avec `false` SANS toucher au DOM (pas de `document` en env. Node de test).
  it("renvoie false quand aucun graphe n'est actif", () => {
    expect(exportChartImage("BTCUSDT", "1h")).toBe(false);
  });
});

describe("drawing.ts — suppressPersist", () => {
  let localStorage: Storage;

  beforeEach(() => {
    localStorage = installMockLocalStorage();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("persiste un dessin tracé normalement", () => {
    const a = createMockChart();
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    setFocusChart(0);
    restoreDrawings(a.chart, EXCHANGE, SYMBOL);

    selectTool("trendLine");
    a.finishDraw("ov-0", [
      { timestamp: 1, value: 100 },
      { timestamp: 2, value: 110 },
    ]);

    expect(readStoredCount(localStorage)).toBe(1);
    unbindChart(a.chart);
  });

  it("un onRemoved de teardown déclenché APRÈS unbindChart ne doit PAS écraser les dessins persistés", () => {
    const a = createMockChart();
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    setFocusChart(0);
    restoreDrawings(a.chart, EXCHANGE, SYMBOL);

    selectTool("trendLine");
    a.finishDraw("ov-0", [
      { timestamp: 1, value: 100 },
      { timestamp: 2, value: 110 },
    ]);
    expect(readStoredCount(localStorage)).toBe(1);

    // Changement de symbole/TF : ChartInstance appelle unbindChart() PUIS dispose() sur
    // l'ANCIENNE instance, ce qui déclenche onRemoved pour chacun de ses overlays.
    unbindChart(a.chart);
    a.teardown("ov-0", [
      { timestamp: 1, value: 100 },
      { timestamp: 2, value: 110 },
    ]);

    expect(readStoredCount(localStorage)).toBe(1); // PAS écrasé à vide par le teardown
  });

  it("sans le garde (onRemoved AVANT unbindChart), le teardown écraserait bien le stockage à vide", () => {
    const a = createMockChart();
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    setFocusChart(0);
    restoreDrawings(a.chart, EXCHANGE, SYMBOL);

    selectTool("trendLine");
    a.finishDraw("ov-0", [{ timestamp: 1, value: 100 }]);
    expect(readStoredCount(localStorage)).toBe(1);

    // Scénario SANS unbindChart préalable (suppressPersist resté false) : c'est
    // exactement le cas que le garde empêche en usage normal (test précédent).
    a.teardown("ov-0", [{ timestamp: 1, value: 100 }]);

    expect(readStoredCount(localStorage)).toBe(0);
    unbindChart(a.chart);
  });

  it("bindChart d'une nouvelle instance réactive la persistance (nouvelle session de dessin)", () => {
    const a = createMockChart();
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    setFocusChart(0);
    restoreDrawings(a.chart, EXCHANGE, SYMBOL);
    selectTool("trendLine");
    a.finishDraw("ov-0", [{ timestamp: 1, value: 100 }]);
    unbindChart(a.chart);
    a.teardown("ov-0", [{ timestamp: 1, value: 100 }]);
    expect(readStoredCount(localStorage)).toBe(1); // protégé par le garde

    // Nouvelle instance (recréée par ChartInstance) : bindChart + restoreDrawings
    // rejoue le dessin existant sur la nouvelle instance.
    const b = createMockChart();
    b.setIdPrefix("b-");
    bindChart(b.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    setFocusChart(0);
    restoreDrawings(b.chart, EXCHANGE, SYMBOL);

    selectTool("rect");
    // restoreDrawings a déjà consommé "b-ov-0" (trendLine rejoué) → le rect neuf est "b-ov-1".
    b.finishDraw("b-ov-1", [
      { timestamp: 5, value: 50 },
      { timestamp: 6, value: 60 },
    ]);

    expect(readStoredCount(localStorage)).toBe(2); // trendLine rejoué + rect neuf
    unbindChart(b.chart);
  });
});

describe("drawing.ts — isolation multi-chart (focus)", () => {
  let localStorage: Storage;

  beforeEach(() => {
    localStorage = installMockLocalStorage();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("les outils s'appliquent à l'instance FOCUS ; chaque slot persiste sous son propre symbole", () => {
    const a = createMockChart(); // slot 0 = BTCUSDT
    a.setIdPrefix("a-");
    const b = createMockChart(); // slot 1 = ETHUSDT
    b.setIdPrefix("b-");
    bindChart(a.chart, { exchange: EXCHANGE, symbol: "BTCUSDT" }, 0);
    bindChart(b.chart, { exchange: EXCHANGE, symbol: "ETHUSDT" }, 1);
    restoreDrawings(a.chart, EXCHANGE, "BTCUSDT");
    restoreDrawings(b.chart, EXCHANGE, "ETHUSDT");

    // Focus sur le slot 1 → l'outil trace sur l'instance b (ETHUSDT).
    setFocusChart(1);
    selectTool("trendLine");
    b.finishDraw("b-ov-0", [
      { timestamp: 1, value: 100 },
      { timestamp: 2, value: 110 },
    ]);

    expect(readStoredCount(localStorage, "1:binance:ETHUSDT")).toBe(1);
    expect(readStoredCount(localStorage, "0:binance:BTCUSDT")).toBe(0); // slot maître intact

    // Bascule le focus sur le slot 0 → l'outil trace sur l'instance a (BTCUSDT).
    setFocusChart(0);
    selectTool("rect");
    a.finishDraw("a-ov-0", [
      { timestamp: 3, value: 30 },
      { timestamp: 4, value: 40 },
    ]);
    expect(readStoredCount(localStorage, "0:binance:BTCUSDT")).toBe(1);
    expect(readStoredCount(localStorage, "1:binance:ETHUSDT")).toBe(1); // inchangé

    unbindChart(a.chart);
    unbindChart(b.chart);
  });
});

describe("drawing.ts — picker d'ancrage AVWAP", () => {
  let localStorage: Storage;

  beforeEach(() => {
    localStorage = installMockLocalStorage();
    indicatorsStore.getState().setAll([]); // isole l'état des indicateurs entre tests
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    indicatorsStore.getState().setAll([]);
  });

  it("au clic, ajoute une instance anchoredVwap ancrée au timestamp cliqué et retire l'overlay (rien ne persiste comme dessin)", async () => {
    const a = createMockChart();
    const removeSpy = vi.spyOn(a.chart, "removeOverlay");
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    setFocusChart(0);
    restoreDrawings(a.chart, EXCHANGE, SYMBOL);

    // Sélectionne le picker puis simule le clic (1 point) sur une bougie à t=1 700 000.
    selectTool("avwapAnchor");
    a.finishDraw("ov-0", [{ timestamp: 1_700_000, value: 42 }]);

    // Une instance anchoredVwap ancrée au timestamp cliqué a été ajoutée.
    const list = indicatorsStore.getState().indicators;
    expect(list).toHaveLength(1);
    expect(list[0]?.defId).toBe("anchoredVwap");
    expect(list[0]?.params.anchorTime).toBe(1_700_000);

    // Aucun DESSIN persisté (le picker n'est pas un overlay tracé).
    expect(readStoredCount(localStorage)).toBe(0);

    // L'overlay picker est retiré (retrait différé via queueMicrotask).
    await Promise.resolve();
    expect(removeSpy).toHaveBeenCalledWith({ id: "ov-0" });

    unbindChart(a.chart);
  });

  it("un clic sans timestamp exploitable n'ajoute aucune instance mais retire quand même l'overlay", async () => {
    const a = createMockChart();
    const removeSpy = vi.spyOn(a.chart, "removeOverlay");
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    setFocusChart(0);
    restoreDrawings(a.chart, EXCHANGE, SYMBOL);

    selectTool("avwapAnchor");
    a.finishDraw("ov-0", [{ value: 42 }]); // pas de timestamp

    expect(indicatorsStore.getState().indicators).toHaveLength(0);
    await Promise.resolve();
    expect(removeSpy).toHaveBeenCalledWith({ id: "ov-0" });

    unbindChart(a.chart);
  });
});

describe("drawing.ts — outil « measure »", () => {
  it("selectTool(\"measure\") met à jour drawingStore sans créer d'overlay", () => {
    const a = createMockChart();
    const createSpy = vi.spyOn(a.chart, "createOverlay");
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    setFocusChart(0);

    selectTool("measure");

    expect(drawingStore.getState().tool).toBe("measure");
    expect(createSpy).not.toHaveBeenCalled();

    unbindChart(a.chart);
  });
});

describe("coinsRectangle — rectangle 2 points", () => {
  it("dérive les 4 coins de la diagonale", () => {
    expect(coinsRectangle([{ x: 10, y: 20 }, { x: 30, y: 5 }])).toEqual([
      { x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 5 }, { x: 10, y: 5 },
    ]);
  });
  it("null tant que les 2 points ne sont pas posés", () => {
    expect(coinsRectangle([])).toBeNull();
    expect(coinsRectangle([{ x: 1, y: 1 }])).toBeNull();
  });
});

describe("drawing.ts — enregistrement de l'overlay custom « rect »", () => {
  // klinecharts 9.8.12 n'a PAS de template intégré « rect » (seulement la FIGURE
  // rect) : sans cet enregistrement au chargement du module, createOverlay renvoie
  // null et l'outil Rectangle ne trace rien (cf. registerAvwapPicker, même pattern).
  it("« rect » est enregistré au chargement du module, comme le picker AVWAP", () => {
    expect(registeredOverlayNames).toContain("rect");
    expect(registeredOverlayNames).toContain("avwapAnchorPick");
  });
});

describe("drawing.ts — migration douce de la clé « symbole » → « exchange:symbole »", () => {
  let localStorage: Storage;

  beforeEach(() => {
    localStorage = installMockLocalStorage();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("reprend les dessins de l'ancienne clé plate vers « binance:symbole » (une seule fois) puis retire l'héritage", () => {
    localStorage.setItem(
      DRAWINGS_KEY,
      JSON.stringify({
        [SYMBOL]: [
          { name: "segment", points: [{ timestamp: 1, value: 100 }, { timestamp: 2, value: 110 }] },
        ],
      })
    );

    const a = createMockChart();
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    restoreDrawings(a.chart, EXCHANGE, SYMBOL); // déclenche la migration + rejoue le dessin

    const all = JSON.parse(localStorage.getItem(DRAWINGS_KEY) ?? "{}") as Record<string, unknown[]>;
    expect(all[SLOT0_KEY]?.length).toBe(1); // repris sous la clé scellée au slot
    expect(all[COMPOSITE_KEY]?.length).toBe(1); // clé partagée semée (héritage des autres slots)
    expect(all[SYMBOL]).toBeUndefined(); // ancienne clé plate retirée
    unbindChart(a.chart);
  });

  it("ne migre PAS quand la source courante n'est pas Binance (l'héritage reste intact)", () => {
    localStorage.setItem(
      DRAWINGS_KEY,
      JSON.stringify({
        ETHUSDT: [{ name: "rect", points: [{ timestamp: 3, value: 30 }] }],
      })
    );

    const a = createMockChart();
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    restoreDrawings(a.chart, EXCHANGE, SYMBOL); // restaure BTCUSDT (aucune migration de ETHUSDT)

    const all = JSON.parse(localStorage.getItem(DRAWINGS_KEY) ?? "{}") as Record<string, unknown[]>;
    expect(all["ETHUSDT"]?.length).toBe(1); // héritage d'un autre symbole non touché
    unbindChart(a.chart);
  });
});

describe("drawing.ts — slots scellés : même actif affiché sur deux slots", () => {
  let localStorage: Storage;

  beforeEach(() => {
    localStorage = installMockLocalStorage();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("un dessin posé sur le slot 1 n'efface pas le dessin persisté du slot 0 (grille liée, même symbole)", () => {
    const a = createMockChart(); // slot 0 = binance:BTCUSDT
    a.setIdPrefix("a-");
    const b = createMockChart(); // slot 1 = binance:BTCUSDT (liaison ⛓ : même actif)
    b.setIdPrefix("b-");
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    bindChart(b.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 1);
    restoreDrawings(a.chart, EXCHANGE, SYMBOL);
    restoreDrawings(b.chart, EXCHANGE, SYMBOL);

    setFocusChart(0);
    selectTool("trendLine");
    a.finishDraw("a-ov-0", [{ timestamp: 1, value: 100 }, { timestamp: 2, value: 110 }]);
    expect(readStoredCount(localStorage, "0:binance:BTCUSDT")).toBe(1);

    // AVANT le fix : persistEntry(slot 1) réécrivait la clé PARTAGÉE « binance:BTCUSDT »
    // avec la map du slot 1 (qui n'a jamais vu le segment du slot 0) → perte silencieuse.
    setFocusChart(1);
    selectTool("rect");
    b.finishDraw("b-ov-0", [{ timestamp: 3, value: 30 }, { timestamp: 4, value: 40 }]);

    expect(readStoredCount(localStorage, "0:binance:BTCUSDT")).toBe(1); // intact
    expect(readStoredCount(localStorage, "1:binance:BTCUSDT")).toBe(1);
    unbindChart(a.chart);
    unbindChart(b.chart);
  });

  it("migration : la clé partagée « exchange:symbole » existante est COPIÉE vers la clé du slot à la première lecture (et conservée pour les autres slots)", () => {
    localStorage.setItem(
      DRAWINGS_KEY,
      JSON.stringify({
        "binance:BTCUSDT": [{ name: "segment", points: [{ timestamp: 1, value: 100 }] }],
      })
    );

    const a = createMockChart();
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    restoreDrawings(a.chart, EXCHANGE, SYMBOL);

    const all = JSON.parse(localStorage.getItem(DRAWINGS_KEY) ?? "{}") as Record<string, unknown[]>;
    expect(all["0:binance:BTCUSDT"]?.length).toBe(1); // copié vers la clé scellée au slot
    expect(all["binance:BTCUSDT"]?.length).toBe(1); // conservé : source d'héritage des AUTRES slots
    unbindChart(a.chart);
  });
});

// ───────────── Bogue « rectangles déplacés en passant d'un graphe à un autre » ─────────────
//
// klinecharts 9.8 : un point posé à droite de la dernière bougie (ou avant la première) n'a
// qu'un `dataIndex` (`dataIndexToTimestamp` → null). L'ancienne sauvegarde ne gardait que
// {timestamp, value} : ce point revenait sans abscisse au rejeu (changement d'actif, d'unité
// de temps, de disposition ou rechargement) et le rectangle se déformait vers le bord gauche.

const H = 3_600_000;
/** 10 bougies 1h à partir de t0 (timestamps klinecharts). */
const T0 = Date.UTC(2026, 8, 20, 0);
const bougies = (n = 10, depuis = T0) => Array.from({ length: n }, (_, i) => ({ timestamp: depuis + i * H }));

describe("versPointSauve / versPointGraphe — ancrage temporel hors des bougies", () => {
  it("un point dans les bougies garde son instant ; un point dans le futur reçoit l'instant extrapolé", () => {
    const data = bougies();
    expect(versPointSauve({ timestamp: T0 + 3 * H, dataIndex: 3, value: 100 }, data)).toEqual({ timestamp: T0 + 3 * H, value: 100 });
    // Dernière bougie à l'indice 9 (T0 + 9h) : l'indice 14 est 5 bougies plus loin.
    expect(versPointSauve({ dataIndex: 14, value: 120 }, data)).toEqual({ timestamp: T0 + 14 * H, value: 120 });
    // Avant la première bougie : extrapolation vers le passé.
    expect(versPointSauve({ dataIndex: -2, value: 90 }, data)).toEqual({ timestamp: T0 - 2 * H, value: 90 });
  });

  it("le pas ignore un trou (week-end) : plus petit écart positif des dernières bougies", () => {
    const data = [...bougies(5), { timestamp: T0 + 60 * H }];
    expect(versPointSauve({ dataIndex: 7, value: 1 }, data)).toEqual({ timestamp: T0 + 62 * H, value: 1 });
  });

  it("sans bougies, un point sans instant reste tel quel (aucune invention)", () => {
    expect(versPointSauve({ dataIndex: 3, value: 1 }, [])).toEqual({ value: 1 });
  });

  it("au rejeu : instant dans les bougies → par instant ; au-delà → indice extrapolé, jamais rabattu sur la dernière bougie", () => {
    const data = bougies();
    expect(versPointGraphe({ timestamp: T0 + 3 * H, value: 100 }, data)).toEqual({ timestamp: T0 + 3 * H, value: 100 });
    expect(versPointGraphe({ timestamp: T0 + 14 * H, value: 120 }, data)).toEqual({ dataIndex: 14, value: 120 });
    expect(versPointGraphe({ timestamp: T0 - 2 * H, value: 90 }, data)).toEqual({ dataIndex: -2, value: 90 });
    // Autre unité de temps (4h) : même instant, indice recalculé sur ce pas.
    const quatreHeures = Array.from({ length: 10 }, (_, i) => ({ timestamp: T0 + i * 4 * H }));
    expect(versPointGraphe({ timestamp: T0 + 44 * H, value: 120 }, quatreHeures)).toEqual({ dataIndex: 11, value: 120 });
  });
});

describe("drawing.ts — un rectangle prolongé dans le futur survit au changement de graphe", () => {
  let localStorage: Storage;
  beforeEach(() => { localStorage = installMockLocalStorage(); });
  afterEach(() => { delete (globalThis as { localStorage?: Storage }).localStorage; });

  /** Chart simulé avec bougies et abonnement aux actions (onDataReady). */
  function chartAvecDonnees(data: Array<{ timestamp: number }>) {
    const base = createMockChart();
    const crees: Array<Record<string, unknown>> = [];
    const surcharges: Array<Record<string, unknown>> = [];
    const actions = new Map<string, () => void>();
    const chart = base.chart as unknown as Record<string, unknown>;
    const creer = chart.createOverlay as (opts: Record<string, unknown>) => string;
    chart.createOverlay = (opts: Record<string, unknown>) => { crees.push(opts); return creer(opts); };
    chart.overrideOverlay = (opts: Record<string, unknown>) => { surcharges.push(opts); };
    chart.getDataList = () => data;
    chart.subscribeAction = (type: string, cb: () => void) => { actions.set(type, cb); };
    chart.unsubscribeAction = (type: string) => { actions.delete(type); };
    return { ...base, crees, surcharges, donneesPretes: () => actions.get("onDataReady")?.(), setData: (d: typeof data) => { data = d; chart.getDataList = () => data; } };
  }

  it("le coin futur est sauvegardé avec son instant et rejoué à son indice (plus au bord gauche)", () => {
    const a = chartAvecDonnees(bougies());
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    setFocusChart(0);
    restoreDrawings(a.chart, EXCHANGE, SYMBOL);
    selectTool("rect");
    a.finishDraw("ov-0", [{ timestamp: T0 + 2 * H, dataIndex: 2, value: 100 } as never, { dataIndex: 15, value: 120 } as never]);
    const sauve = (JSON.parse(localStorage.getItem(DRAWINGS_KEY) ?? "{}") as Record<string, Array<{ points: unknown[] }>>)[SLOT0_KEY];
    expect(sauve?.[0]?.points).toEqual([{ timestamp: T0 + 2 * H, value: 100 }, { timestamp: T0 + 15 * H, value: 120 }]);
    unbindChart(a.chart);

    // Autre graphe (remontage, rechargement) : une bougie de plus est arrivée entre-temps.
    const b = chartAvecDonnees(bougies(11));
    bindChart(b.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    restoreDrawings(b.chart, EXCHANGE, SYMBOL);
    expect(b.crees.at(-1)?.points).toEqual([{ timestamp: T0 + 2 * H, value: 100 }, { dataIndex: 15, value: 120 }]);
    unbindChart(b.chart);
  });

  it("historique préfixé par applyNewData (extension de session, resync) : le coin futur est réancré", () => {
    const a = chartAvecDonnees(bougies());
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    localStorage.setItem(DRAWINGS_KEY, JSON.stringify({ [SLOT0_KEY]: [{ name: "rect", points: [{ timestamp: T0 + 2 * H, value: 100 }, { timestamp: T0 + 15 * H, value: 120 }] }] }));
    restoreDrawings(a.chart, EXCHANGE, SYMBOL);
    const id = "ov-0";
    // 100 bougies plus anciennes préfixées : l'indice 15 désignerait désormais une bougie passée.
    a.setData(bougies(110, T0 - 100 * H));
    a.donneesPretes();
    expect(a.surcharges).toEqual([{ id, points: [{ timestamp: T0 + 2 * H, value: 100 }, { dataIndex: 115, value: 120 }] }]);
    // Simple tick (même première bougie) : aucune surcharge supplémentaire.
    a.donneesPretes();
    expect(a.surcharges).toHaveLength(1);
    unbindChart(a.chart);
  });
});

describe("drawing.ts — revue du 26/09 : réancrage, abonnements, calendrier", () => {
  let localStorage: Storage;
  beforeEach(() => { localStorage = installMockLocalStorage(); });
  afterEach(() => { delete (globalThis as { localStorage?: Storage }).localStorage; });

  /** Chart simulé : bougies modifiables, abonnements comptés par référence (comme klinecharts). */
  function chartCompte(data: Array<{ timestamp: number }>) {
    const base = createMockChart();
    const surcharges: Array<Record<string, unknown>> = [];
    const abonnes: Array<() => void> = [];
    const crees: Array<Record<string, unknown>> = [];
    const chart = base.chart as unknown as Record<string, unknown>;
    const creer = chart.createOverlay as (opts: Record<string, unknown>) => string;
    chart.createOverlay = (opts: Record<string, unknown>) => { crees.push(opts); return creer(opts); };
    chart.overrideOverlay = (opts: Record<string, unknown>) => { surcharges.push(opts); };
    chart.getDataList = () => data;
    chart.subscribeAction = (_type: string, cb: () => void) => { abonnes.push(cb); };
    chart.unsubscribeAction = (_type: string, cb: () => void) => { const i = abonnes.indexOf(cb); if (i >= 0) abonnes.splice(i, 1); };
    return {
      ...base, surcharges, abonnes, crees,
      setData: (d: typeof data) => { data = d; chart.getDataList = () => data; },
      donneesPretes: () => { for (const cb of [...abonnes]) cb(); },
    };
  }

  it("BLOQUANT : un coin passé rejoué en indice qui RENTRE dans la plage après un préfixe est recalé sur son instant", () => {
    const a = chartCompte(bougies());
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    localStorage.setItem(DRAWINGS_KEY, JSON.stringify({ [SLOT0_KEY]: [{ name: "rect", points: [{ timestamp: T0 - 2 * H, value: 100 }, { timestamp: T0 + 5 * H, value: 120 }] }] }));
    restoreDrawings(a.chart, EXCHANGE, SYMBOL);
    expect(a.crees.at(-1)?.points).toEqual([{ dataIndex: -2, value: 100 }, { timestamp: T0 + 5 * H, value: 120 }]);
    // Extension de session : 100 bougies préfixées ; klinecharts (Init) ne décale pas l'indice -2.
    a.setData(bougies(110, T0 - 100 * H));
    a.donneesPretes();
    expect(a.surcharges).toEqual([{ id: "ov-0", points: [{ timestamp: T0 - 2 * H, value: 100 }, { timestamp: T0 + 5 * H, value: 120 }] }]);
    unbindChart(a.chart);
  });

  it("un re-bindChart (changement d'actif ou d'unité de temps) ne laisse qu'un abonnement onDataReady, retiré au démontage", () => {
    const a = chartCompte(bougies());
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    bindChart(a.chart, { exchange: EXCHANGE, symbol: "ETHUSDT" }, 0);
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL, timeframe: "4h" }, 0);
    expect(a.abonnes).toHaveLength(1);
    unbindChart(a.chart);
    expect(a.abonnes).toHaveLength(0);
  });

  it("1M et plus : extrapolation en mois UTC, pas au plus petit écart (février)", () => {
    const mois = Array.from({ length: 20 }, (_, i) => ({ timestamp: Date.UTC(2025, i, 1) }));
    expect(versPointSauve({ dataIndex: 19 + 12, value: 1 }, mois, "1M")).toEqual({ timestamp: Date.UTC(2026, 7 + 12, 1), value: 1 });
    expect(versPointGraphe({ timestamp: Date.UTC(2027, 7, 1), value: 1 }, mois, "1M")).toEqual({ dataIndex: 31, value: 1 });
    const trimestres = Array.from({ length: 8 }, (_, i) => ({ timestamp: Date.UTC(2024, 3 * i, 1) }));
    expect(versPointSauve({ dataIndex: -1, value: 1 }, trimestres, "3M")).toEqual({ timestamp: Date.UTC(2023, 9, 1), value: 1 });
    expect(versPointGraphe({ timestamp: Date.UTC(2023, 9, 1), value: 1 }, trimestres, "3M")).toEqual({ dataIndex: -1, value: 1 });
  });

  it("Hyperliquid « 1M » = paquets de 30 j alignés sur l'époque, pas des mois civils : pas mesuré conservé", () => {
    const PAQUET = 2_592_000_000;
    const hl = Array.from({ length: 20 }, (_, i) => ({ timestamp: (671 + i) * PAQUET }));
    expect(versPointSauve({ dataIndex: 19 + 12, value: 1 }, hl, "1M")).toEqual({ timestamp: (690 + 12) * PAQUET, value: 1 });
    expect(versPointGraphe({ timestamp: (690 + 12) * PAQUET, value: 1 }, hl, "1M")).toEqual({ dataIndex: 31, value: 1 });
  });

  it("une seule bougie : le pas vient de l'unité de temps, le coin futur garde un instant", () => {
    expect(versPointSauve({ dataIndex: 3, value: 1 }, [{ timestamp: T0 }], "1h")).toEqual({ timestamp: T0 + 3 * H, value: 1 });
    expect(versPointGraphe({ timestamp: T0 + 3 * H, value: 1 }, [{ timestamp: T0 }], "1h")).toEqual({ dataIndex: 3, value: 1 });
  });
});
