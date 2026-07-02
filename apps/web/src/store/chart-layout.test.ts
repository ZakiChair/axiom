/**
 * Tests de la disposition multi-chart : helpers purs (visibleSlotCount, linkedTargets)
 * et logique du store (bornage du focus au mode, patch des slots secondaires, liaison).
 * Aucun DOM requis (la persistance localStorage est best-effort et tolère son absence).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  chartLayoutStore,
  linkedTargets,
  visibleSlotCount,
} from "./chart-layout";

beforeEach(() => {
  // État connu avant chaque test (le store est un singleton module-scope).
  chartLayoutStore.setState({
    layout: "1",
    focus: 0,
    linked: false,
    slots: [
      { exchange: "binance", symbol: "ETHUSDT", timeframe: "1m" },
      { exchange: "binance", symbol: "SOLUSDT", timeframe: "1m" },
      { exchange: "binance", symbol: "BNBUSDT", timeframe: "1m" },
    ],
  });
});

describe("visibleSlotCount", () => {
  it("mappe chaque mode au bon nombre de slots", () => {
    expect(visibleSlotCount("1")).toBe(1);
    expect(visibleSlotCount("2h")).toBe(2);
    expect(visibleSlotCount("2v")).toBe(2);
    expect(visibleSlotCount("2x2")).toBe(4);
  });
});

describe("linkedTargets", () => {
  it("renvoie tous les autres slots visibles", () => {
    expect(linkedTargets(0, "2x2")).toEqual([1, 2, 3]);
    expect(linkedTargets(2, "2x2")).toEqual([0, 1, 3]);
    expect(linkedTargets(0, "2h")).toEqual([1]);
    expect(linkedTargets(0, "1")).toEqual([]); // aucun autre slot visible en mode 1
  });
});

describe("chartLayoutStore — focus", () => {
  it("borne le focus aux slots visibles quand le mode rétrécit", () => {
    chartLayoutStore.getState().setLayout("2x2");
    chartLayoutStore.getState().setFocus(3);
    expect(chartLayoutStore.getState().focus).toBe(3);

    // Retour en mode 2h : le focus 3 est hors bornes → ramené au dernier visible (1).
    chartLayoutStore.getState().setLayout("2h");
    expect(chartLayoutStore.getState().focus).toBe(1);

    chartLayoutStore.getState().setLayout("1");
    expect(chartLayoutStore.getState().focus).toBe(0);
  });

  it("ignore un focus hors bornes", () => {
    chartLayoutStore.getState().setLayout("2h");
    chartLayoutStore.getState().setFocus(5);
    expect(chartLayoutStore.getState().focus).toBe(1); // borné au dernier visible
    chartLayoutStore.getState().setFocus(-2);
    expect(chartLayoutStore.getState().focus).toBe(0);
  });
});

describe("chartLayoutStore — slots secondaires", () => {
  it("patche le symbole d'un slot secondaire (grille 1..3) en majuscules", () => {
    chartLayoutStore.getState().setSlotSymbol(1, "adausdt");
    expect(chartLayoutStore.getState().slots[0].symbol).toBe("ADAUSDT");
  });

  it("laisse le slot 0 (maître) hors de ce store", () => {
    const before = chartLayoutStore.getState().slots;
    chartLayoutStore.getState().setSlotSymbol(0, "XRPUSDT"); // slot maître : ignoré ici
    expect(chartLayoutStore.getState().slots).toEqual(before);
  });

  it("patche TF et source d'un slot secondaire", () => {
    chartLayoutStore.getState().setSlotTimeframe(2, "1h");
    chartLayoutStore.getState().setSlotExchange(2, "kraken");
    expect(chartLayoutStore.getState().slots[1].timeframe).toBe("1h");
    expect(chartLayoutStore.getState().slots[1].exchange).toBe("kraken");
  });

  it("ignore un symbole vide", () => {
    chartLayoutStore.getState().setSlotSymbol(1, "   ");
    expect(chartLayoutStore.getState().slots[0].symbol).toBe("ETHUSDT");
  });
});

describe("chartLayoutStore — liaison", () => {
  it("bascule le drapeau linked", () => {
    expect(chartLayoutStore.getState().linked).toBe(false);
    chartLayoutStore.getState().toggleLinked();
    expect(chartLayoutStore.getState().linked).toBe(true);
  });
});
