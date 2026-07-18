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

function readStoredCount(localStorage: Storage, key = COMPOSITE_KEY): number {
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

    expect(readStoredCount(localStorage, "binance:ETHUSDT")).toBe(1);
    expect(readStoredCount(localStorage, "binance:BTCUSDT")).toBe(0); // slot maître intact

    // Bascule le focus sur le slot 0 → l'outil trace sur l'instance a (BTCUSDT).
    setFocusChart(0);
    selectTool("rect");
    a.finishDraw("a-ov-0", [
      { timestamp: 3, value: 30 },
      { timestamp: 4, value: 40 },
    ]);
    expect(readStoredCount(localStorage, "binance:BTCUSDT")).toBe(1);
    expect(readStoredCount(localStorage, "binance:ETHUSDT")).toBe(1); // inchangé

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
    expect(all[COMPOSITE_KEY]?.length).toBe(1); // repris sous la clé composite
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
