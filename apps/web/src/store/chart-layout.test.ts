/**
 * Tests de la disposition multi-chart : helpers purs (visibleSlotCount, linkedTargets)
 * et logique du store (bornage du focus au mode, patch des slots secondaires, liaison).
 * Aucun DOM requis (la persistance localStorage est best-effort et tolère son absence).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chartLayoutStore,
  linkedTargets,
  sanitizeSlotConfig,
  visibleSlotCount,
} from "./chart-layout";

beforeEach(() => {
  // État connu avant chaque test (le store est un singleton module-scope).
  chartLayoutStore.setState({
    layout: "1",
    focus: 0,
    linked: false,
    syncTimeframe: false,
    syncViewport: false,
    syncCrosshair: true,
    slots: [
      { exchange: "binance", symbol: "ETHUSDT", timeframe: "1m" },
      { exchange: "binance", symbol: "SOLUSDT", timeframe: "1m" },
      { exchange: "binance", symbol: "BNBUSDT", timeframe: "1m" },
    ],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chartLayoutStore — persistance de la synchronisation", () => {
  async function restaurer(payload: unknown) {
    const storage = new Map<string, string>();
    if (payload !== undefined) storage.set("axiom:chartLayout:v1", JSON.stringify(payload));
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.resetModules();
    const { chartLayoutStore: restored } = await import("./chart-layout");
    return { restored, storage };
  }

  it("migre une disposition v1 sans activer les unités ni le zoom", async () => {
    const { restored } = await restaurer({ layout: "2h", linked: true });
    expect(restored.getState()).toMatchObject({
      layout: "2h", linked: true,
      syncTimeframe: false, syncViewport: false, syncCrosshair: true,
    });
  });

  it("restaure des booléens valides et écarte les valeurs corrompues", async () => {
    const { restored } = await restaurer({
      syncTimeframe: "true", syncViewport: 1, syncCrosshair: "false",
    });
    expect(restored.getState()).toMatchObject({
      syncTimeframe: false, syncViewport: false, syncCrosshair: true,
    });
  });

  it("conserve les trois préférences après rechargement", async () => {
    const { restored, storage } = await restaurer(undefined);
    restored.getState().setSyncOption("syncTimeframe", true);
    restored.getState().setSyncOption("syncViewport", true);
    restored.getState().setSyncOption("syncCrosshair", false);
    const persisted = JSON.parse(storage.get("axiom:chartLayout:v1") ?? "{}");
    const { restored: reloaded } = await restaurer(persisted);
    expect(reloaded.getState()).toMatchObject({
      syncTimeframe: true, syncViewport: true, syncCrosshair: false,
    });
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
  it("conserve une identité HL explicite même si la source du slot est inchangée", () => {
    chartLayoutStore.setState({ slots: [
      { exchange: "hyperliquid", symbol: "BTCUSDT", timeframe: "1h" },
      { exchange: "binance", symbol: "SOLUSDT", timeframe: "1m" },
      { exchange: "binance", symbol: "BNBUSDT", timeframe: "1m" },
    ] });
    chartLayoutStore.getState().setSlotMarket(1, { exchange: "hyperliquid", symbol: "ETHUSDT", timeframe: "4h" });
    expect(chartLayoutStore.getState().slots[0]).toEqual({ exchange: "hyperliquid", symbol: "ETHUSDT", timeframe: "4h" });
  });

  it("une sélection de symbole seule distingue perp explicite et spot, même sur un ancien slot HL", () => {
    chartLayoutStore.getState().setSlotSymbol(1, "BTC-PERP");
    expect(chartLayoutStore.getState().slots[0]).toMatchObject({ exchange: "hyperliquid", symbol: "BTC-PERP" });
    chartLayoutStore.getState().setSlotMarket(1, { exchange: "hyperliquid", symbol: "BTCUSDT", timeframe: "1h" });
    expect(chartLayoutStore.getState().slots[0]).toMatchObject({ exchange: "hyperliquid", symbol: "BTCUSDT" });
    chartLayoutStore.getState().setSlotSymbol(1, "BTCUSDT");
    expect(chartLayoutStore.getState().slots[0]).toMatchObject({ exchange: "binance", symbol: "BTCUSDT" });
  });

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

  it("remplace source, symbole et TF d'un slot en une seule mutation", () => {
    chartLayoutStore.getState().setSlotMarket(1, {
      exchange: "kraken",
      symbol: "ethusd",
      timeframe: "5m",
    });
    expect(chartLayoutStore.getState().slots[0]).toEqual({
      exchange: "kraken",
      symbol: "ETHUSD",
      timeframe: "5m",
    });
  });

  it("préserve les ids de source minuscules d'un symbole synthétique", () => {
    chartLayoutStore.getState().setSlotMarket(1, {
      exchange: "synthetic",
      symbol: "binance:BTCUSDT|/|twelvedata:GLD",
      timeframe: "1h",
    });
    expect(chartLayoutStore.getState().slots[0]).toEqual({
      exchange: "synthetic",
      symbol: "binance:BTCUSDT|/|twelvedata:GLD",
      timeframe: "1h",
    });
  });

  it("ignore un symbole vide", () => {
    chartLayoutStore.getState().setSlotSymbol(1, "   ");
    expect(chartLayoutStore.getState().slots[0].symbol).toBe("ETHUSDT");
  });
});

describe("sanitizeSlotConfig", () => {
  const fallback = { exchange: "binance" as const, symbol: "ETHUSDT", timeframe: "1m" as const };

  it("restaure une ancienne identité HL sans la transformer en spot", () => {
    expect(sanitizeSlotConfig({ exchange: "hyperliquid", symbol: "BTCUSDT", timeframe: "1h" }, fallback))
      .toEqual({ exchange: "hyperliquid", symbol: "BTCUSDT", timeframe: "1h" });
  });

  it("rejette une source injectée depuis un stockage corrompu", () => {
    expect(sanitizeSlotConfig({ exchange: "evil", symbol: "BTCUSDT", timeframe: "1m" }, fallback)).toEqual(
      fallback,
    );
  });

  it("remplace une timeframe non supportée par la nouvelle source", () => {
    expect(sanitizeSlotConfig({ exchange: "kraken", symbol: "BTCUSD", timeframe: "3d" }, fallback)).toEqual({
      exchange: "kraken",
      symbol: "BTCUSD",
      timeframe: "1m",
    });
  });

  it("rejette un symbole synthétique mal formé", () => {
    expect(sanitizeSlotConfig({ exchange: "synthetic", symbol: "invalide|", timeframe: "1m" }, fallback)).toEqual(
      fallback,
    );
  });

  it("répare une incohérence persistée AVANT le correctif (source réelle + symbole synthétique)", () => {
    // Un vieux localStorage a pu écrire binance+TOTAL (accepté par l'ancien
    // sanitizeSlotConfig, qui ne vérifiait exchange et symbol qu'indépendamment) →
    // sans réparation à l'hydratation, le pane reste en erreur permanente à chaque boot.
    expect(
      sanitizeSlotConfig({ exchange: "binance", symbol: "TOTAL", timeframe: "1h" }, fallback),
    ).toEqual({
      exchange: "synthetic",
      symbol: "TOTAL",
      timeframe: "1h",
    });
  });
});

describe("chartLayoutStore — liaison", () => {
  it("bascule le drapeau linked", () => {
    expect(chartLayoutStore.getState().linked).toBe(false);
    chartLayoutStore.getState().toggleLinked();
    expect(chartLayoutStore.getState().linked).toBe(true);
  });
});

describe("chartLayoutStore — dérivation de source sur symbole synthétique (parité avec le maître)", () => {
  it("« TOTAL » tapé dans un slot binance bascule le slot sur la source synthetic", () => {
    // Avant : binance+TOTAL était ACCEPTÉ par sanitizeSlotConfig et PERSISTÉ →
    // backfill Binance 400 « Invalid symbol » → pane en erreur à chaque boot.
    chartLayoutStore.getState().setSlotSymbol(1, "TOTAL");

    const slot = chartLayoutStore.getState().slots[0];
    expect(slot.symbol).toBe("TOTAL");
    expect(slot.exchange).toBe("synthetic");
  });

  it("un symbole SYN encodé bascule sur synthetic ; quitter le ratio revient à la jambe A", () => {
    chartLayoutStore.getState().setSlotSymbol(1, "kraken:ETHUSD|/|binance:BTCUSDT");
    expect(chartLayoutStore.getState().slots[0].exchange).toBe("synthetic");

    chartLayoutStore.getState().setSlotSymbol(1, "ETHUSD");
    const slot = chartLayoutStore.getState().slots[0];
    expect(slot.exchange).toBe("kraken"); // jambe A du ratio quitté (même règle que market.ts)
    expect(slot.symbol).toBe("ETHUSD");
  });

  it("une identité incohérente source réelle / symbole TOTAL est réparée", () => {
    chartLayoutStore
      .getState()
      .setSlotMarket(1, { exchange: "binance", symbol: "TOTAL", timeframe: "1h" });
    expect(chartLayoutStore.getState().slots[0].exchange).toBe("synthetic");
  });

  it("un changement de source EXPLICITE reste prioritaire (pas de dérivation)", () => {
    chartLayoutStore
      .getState()
      .setSlotMarket(1, { exchange: "kraken", symbol: "ETHUSD", timeframe: "1h" });
    expect(chartLayoutStore.getState().slots[0].exchange).toBe("kraken");
  });

  it("une source réelle sur TOTAL reste synthétique ; sélectionner ensuite le spot quitte TOTAL", () => {
    // Étape 1 : slot déjà synthetic+TOTAL.
    chartLayoutStore.getState().setSlotSymbol(1, "TOTAL");
    const s1 = chartLayoutStore.getState().slots[0];
    expect(s1).toEqual({ exchange: "synthetic", symbol: "TOTAL", timeframe: "1h" });

    // Étape 2 : l'utilisateur choisit EXPLICITEMENT « kraken » en en-tête PENDANT que le
    // symbole reste TOTAL (spread de l'état courant, exchange changé). Le maître tolère
    // kraken+TOTAL transitoirement en mémoire (setExchange n'y dérive jamais, cf. sa
    // docstring dans market.ts) ; le slot secondaire, lui, PERSISTE sa config à CHAQUE
    // mutation (localStorage) — laisser passer kraken+TOTAL, même un instant, rouvrirait
    // le constat (pane cassé au repos si le prochain rendu lit ce blob). sanitizeSlotConfig
    // neutralise donc le pick : le symbole synthétique impose sa source, le choix explicite
    // de venue est perdu.
    chartLayoutStore.getState().setSlotMarket(1, { ...s1, exchange: "kraken" });
    const s2 = chartLayoutStore.getState().slots[0];
    expect(s2).toEqual({ exchange: "synthetic", symbol: "TOTAL", timeframe: "1h" }); // pick neutralisé

    // Une sélection neuve n’embarque aucune source ; le routage distingue ce geste
    // de la restauration d’une identité complète par setSlotMarket.
    chartLayoutStore.getState().setSlotSymbol(1, "ETHUSD");
    const s3 = chartLayoutStore.getState().slots[0];
    expect(s3).toEqual({ exchange: "binance", symbol: "ETHUSD", timeframe: "1h" });
  });
});
