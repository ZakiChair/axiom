/**
 * Tests de la disposition multi-chart : helpers purs (visibleSlotCount, linkedTargets)
 * et logique du store (bornage du focus au mode, patch des slots secondaires, liaison).
 * Aucun DOM requis (la persistance localStorage est best-effort et tolère son absence).
 */
import { beforeEach, describe, expect, it } from "vitest";
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

  it("le chemin ChartGrid (setSlotMarket avec exchange INCHANGÉ, spread d'en-tête) dérive aussi", () => {
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

  it("pick source explicite pendant TOTAL, puis symbole changé : compromis « cohérence-au-repos » épinglé (diverge du maître transitoire — ACCEPTÉ, cf. task-C.4-report.md)", () => {
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

    // Étape 3 : l'utilisateur tape ensuite « ETHUSD » — l'en-tête spreade l'état RÉEL s2
    // (exchange:"synthetic" INCHANGÉ dans ce patch, le kraken de l'étape 2 n'a jamais été
    // retenu) : ce n'est donc PAS un changement de source explicite, patchSlot dérive comme
    // une sortie de TOTAL normale. TOTAL n'a pas de jambe A (parseSyntheticSymbol("TOTAL")
    // est null, ce n'est pas un ratio) → repli sur Binance, PAS kraken : le pick de l'étape 2
    // est définitivement perdu, il faut re-choisir la venue APRÈS avoir changé le symbole.
    // Couple épinglé = ce que le code fait réellement (vérifié par exécution).
    chartLayoutStore.getState().setSlotMarket(1, { ...s2, symbol: "ETHUSD" });
    const s3 = chartLayoutStore.getState().slots[0];
    expect(s3).toEqual({ exchange: "binance", symbol: "ETHUSD", timeframe: "1h" });
  });
});
