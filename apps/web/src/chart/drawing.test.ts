/**
 * Tests du garde `suppressPersist` (drawing.ts) — protège les dessins persistés
 * d'un écrasement par le `onRemoved` de teardown que klinecharts déclenche sur
 * CHAQUE overlay au `dispose()` de l'ancienne instance (changement symbole/TF).
 * Mock minimal de KLineChartInstance : seuls createOverlay/onDrawEnd/onRemoved
 * sont exercés par drawing.ts, pas besoin du vrai klinecharts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chart as KLineChartInstance } from "klinecharts";
import { bindChart, restoreDrawings, selectTool, unbindChart } from "./drawing";

// fibonacci.ts (importé par drawing.ts) appelle `registerOverlay` au chargement du
// module ; le build UMD de klinecharts ne s'évalue pas correctement hors navigateur
// (pas de `window`), donc on stub l'unique export runtime utilisé pour pouvoir
// importer drawing.ts dans cet environnement de test Node. (vi.mock est hissé par
// Vitest avant les imports statiques ci-dessus, peu importe l'ordre dans le fichier.)
vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));

const DRAWINGS_KEY = "axiom:drawings:v1";
const SYMBOL = "BTCUSDT"; // symbole par défaut de marketStore (store/market.ts)
// Clé composite « exchange:symbole » (source par défaut = binance ; cf. store/market.ts).
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

  const chart = {
    createOverlay(opts: Record<string, unknown>) {
      const id = `ov-${counter++}`;
      callbacks.set(id, opts as unknown as Record<string, OverlayCallback>);
      return id;
    },
    removeOverlay() {},
    overrideOverlay() {},
  } as unknown as KLineChartInstance;

  return {
    chart,
    /** Simule la fin d'un tracé interactif (l'utilisateur termine son dessin). */
    finishDraw(id: string, points: Array<{ timestamp?: number; value?: number }>) {
      callbacks.get(id)?.onDrawEnd?.({ overlay: { id, points } });
    },
    /** Simule le `onRemoved` que klinecharts déclenche sur CET overlay au dispose(). */
    teardown(id: string, points: Array<{ timestamp?: number; value?: number }>) {
      callbacks.get(id)?.onRemoved?.({ overlay: { id, points } });
    },
  };
}

function readStoredCount(localStorage: Storage): number {
  const all = JSON.parse(localStorage.getItem(DRAWINGS_KEY) ?? "{}") as Record<string, unknown[]>;
  return all[COMPOSITE_KEY]?.length ?? 0;
}

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
    bindChart(a.chart);
    restoreDrawings(SYMBOL); // réinitialise liveOverlays (storage vide ici)

    selectTool("trendLine");
    a.finishDraw("ov-0", [
      { timestamp: 1, value: 100 },
      { timestamp: 2, value: 110 },
    ]);

    expect(readStoredCount(localStorage)).toBe(1);
  });

  it("un onRemoved de teardown déclenché APRÈS unbindChart ne doit PAS écraser les dessins persistés", () => {
    const a = createMockChart();
    bindChart(a.chart);
    restoreDrawings(SYMBOL);

    selectTool("trendLine");
    a.finishDraw("ov-0", [
      { timestamp: 1, value: 100 },
      { timestamp: 2, value: 110 },
    ]);
    expect(readStoredCount(localStorage)).toBe(1);

    // Changement de symbole/TF : Chart.tsx appelle unbindChart() PUIS dispose() sur
    // l'ANCIENNE instance, ce qui déclenche onRemoved pour chacun de ses overlays.
    unbindChart(a.chart);
    a.teardown("ov-0", [
      { timestamp: 1, value: 100 },
      { timestamp: 2, value: 110 },
    ]);

    expect(readStoredCount(localStorage)).toBe(1); // PAS écrasé à vide par le teardown
  });

  it("sans le garde (onRemoved AVANT unbindChart), le teardown écraserait bien le stockage à vide — justifie suppressPersist", () => {
    const a = createMockChart();
    bindChart(a.chart);
    restoreDrawings(SYMBOL);

    selectTool("trendLine");
    a.finishDraw("ov-0", [{ timestamp: 1, value: 100 }]);
    expect(readStoredCount(localStorage)).toBe(1);

    // Scénario SANS unbindChart préalable (suppressPersist resté false) : c'est
    // exactement le cas que le garde empêche en usage normal (test précédent).
    a.teardown("ov-0", [{ timestamp: 1, value: 100 }]);

    expect(readStoredCount(localStorage)).toBe(0);
  });

  it("bindChart d'une nouvelle instance réactive la persistance (nouvelle session de dessin)", () => {
    const a = createMockChart();
    bindChart(a.chart);
    restoreDrawings(SYMBOL);
    selectTool("trendLine");
    a.finishDraw("ov-0", [{ timestamp: 1, value: 100 }]);
    unbindChart(a.chart);
    a.teardown("ov-0", [{ timestamp: 1, value: 100 }]);
    expect(readStoredCount(localStorage)).toBe(1); // protégé par le garde (cf. test 2)

    // Nouvelle instance (recréée par Chart.tsx) : bindChart relève le garde et
    // restoreDrawings rejoue le dessin existant sur la nouvelle instance.
    const b = createMockChart();
    bindChart(b.chart);
    restoreDrawings(SYMBOL);

    selectTool("rect");
    b.finishDraw("ov-1", [
      { timestamp: 5, value: 50 },
      { timestamp: 6, value: 60 },
    ]);

    // Le trendLine rejoué + le nouveau rect tracé : la persistance fonctionne à nouveau.
    expect(readStoredCount(localStorage)).toBe(2);
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
    // Pré-remplit le stockage à l'ANCIEN schéma (indexé par symbole seul).
    localStorage.setItem(
      DRAWINGS_KEY,
      JSON.stringify({
        [SYMBOL]: [
          { name: "segment", points: [{ timestamp: 1, value: 100 }, { timestamp: 2, value: 110 }] },
        ],
      })
    );

    const a = createMockChart();
    bindChart(a.chart);
    restoreDrawings(SYMBOL); // déclenche la migration + rejoue le dessin sur l'instance

    const all = JSON.parse(localStorage.getItem(DRAWINGS_KEY) ?? "{}") as Record<string, unknown[]>;
    expect(all[COMPOSITE_KEY]?.length).toBe(1); // repris sous la clé composite
    expect(all[SYMBOL]).toBeUndefined(); // ancienne clé plate retirée
  });

  it("ne migre PAS quand la source courante n'est pas Binance (l'héritage reste intact)", () => {
    // marketStore reste sur binance par défaut : on simule ici l'absence de migration en
    // vérifiant qu'une clé plate d'un AUTRE symbole (jamais restauré sous binance) survit.
    localStorage.setItem(
      DRAWINGS_KEY,
      JSON.stringify({
        ETHUSDT: [{ name: "rect", points: [{ timestamp: 3, value: 30 }] }],
      })
    );

    const a = createMockChart();
    bindChart(a.chart);
    restoreDrawings(SYMBOL); // restaure BTCUSDT (aucune migration de ETHUSDT)

    const all = JSON.parse(localStorage.getItem(DRAWINGS_KEY) ?? "{}") as Record<string, unknown[]>;
    expect(all["ETHUSDT"]?.length).toBe(1); // héritage d'un autre symbole non touché
  });
});
