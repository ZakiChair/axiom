/**
 * Tests de hydrateStores — garde qui filtre les `defId` disparus du registre
 * @axiom/indicators et backfille les `params` manquants depuis un ChartState
 * persisté potentiellement ancien. Une régression de la négation `!== undefined`
 * restaurerait des indicateurs fantômes (crash du contrôleur) ou jetterait tous
 * les indicateurs valides au premier chargement après mise à jour du registre.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// persist.ts importe `priceScaleStore` depuis chart/Chart, qui tire klinecharts + le thème
// (accès `document` au chargement) — non évaluables en environnement Node. On neutralise
// Chart par un vrai store vanilla minimal pour que get/set/subscribe fonctionnent.
vi.mock("../chart/Chart", async () => {
  const { createStore } = await import("zustand/vanilla");
  const priceScaleStore = createStore<{ type: string; setType: (t: string) => void }>((set) => ({
    type: "normal",
    setType: (type) => set({ type }),
  }));
  return { priceScaleStore };
});

import { defaultParams, indicatorsStore } from "./indicators";
import { marketStore } from "./market";
import { DEFAULT_WATCHLIST, watchlistStore } from "./watchlist";
import { compareStore } from "./compare";
import { orderflowStore } from "./orderflow";
import { volumeProfileStore } from "./volumeProfile";
import { revenueStore } from "./revenue";
import { macroOverlayStore } from "./macro-overlays";
import { uiSectionsStore } from "./ui-sections";
import { priceScaleStore } from "../chart/Chart";
import {
  hydrateStores,
  saveSessionUi,
  saveWatchlist,
  importerSauvegarde,
} from "./persist";

const CHART_KEY = "axiom:chartState:v1";
const WATCH_KEY = "axiom:watchlist:v1";
const SESSION_KEY = "axiom:sessionUi:v1";

/** Mock localStorage en mémoire (environnement de test Node, pas de DOM ici). */
function installMockLocalStorage(): Storage {
  const data = new Map<string, string>();
  const mock: Storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    // Énumération réelle (insertion-order) : nécessaire pour l'export/import axiom:*.
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = mock;
  return mock;
}

let localStorage: Storage;

beforeEach(() => {
  localStorage = installMockLocalStorage();
  marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m" });
  indicatorsStore.setState({ indicators: [] });
  watchlistStore.setState({ symbols: [...DEFAULT_WATCHLIST] });
  // Réinitialisation des stores de session (état volatil désormais persisté).
  compareStore.getState().clear();
  orderflowStore.getState().setEnabled(false);
  volumeProfileStore.getState().setEnabled(false);
  revenueStore.getState().setEnabled(false);
  macroOverlayStore.getState().setEnabled([]);
  uiSectionsStore.getState().setAll({});
  priceScaleStore.getState().setType("normal");
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("hydrateStores — indicateurs persistés", () => {
  it("filtre les indicateurs dont le defId n'existe plus au registre @axiom/indicators", () => {
    localStorage.setItem(
      CHART_KEY,
      JSON.stringify({
        symbol: "BTCUSDT",
        exchange: "binance",
        timeframe: "1h",
        indicators: [
          { defId: "sma", params: { length: 10 } },
          { defId: "indicateur-disparu-du-registre", params: {} },
        ],
      })
    );

    hydrateStores();

    const ids = indicatorsStore.getState().indicators.map((i) => i.defId);
    expect(ids).toEqual(["sma"]); // l'id fantôme est filtré, "sma" (réel) conservé
  });

  it("conserve les params valides d'un indicateur connu tels quels", () => {
    localStorage.setItem(
      CHART_KEY,
      JSON.stringify({
        symbol: "BTCUSDT",
        exchange: "binance",
        timeframe: "1h",
        indicators: [{ defId: "sma", params: { length: 42 } }],
      })
    );

    hydrateStores();

    // toMatchObject : ignore l'`instanceId` ajouté par le store multi-instances (Mission 1.E),
    // tout en vérifiant que defId et params persistés sont conservés tels quels.
    expect(indicatorsStore.getState().indicators).toMatchObject([{ defId: "sma", params: { length: 42 } }]);
  });

  it("backfille les params par défaut quand ils sont absents ou invalides", () => {
    localStorage.setItem(
      CHART_KEY,
      JSON.stringify({
        symbol: "BTCUSDT",
        exchange: "binance",
        timeframe: "1h",
        indicators: [
          { defId: "sma" }, // pas de champ params du tout
          { defId: "ema", params: "pas-un-objet" }, // params invalide
        ],
      })
    );

    hydrateStores();

    const restored = indicatorsStore.getState().indicators;
    expect(restored.find((i) => i.defId === "sma")?.params).toEqual(defaultParams("sma"));
    expect(restored.find((i) => i.defId === "ema")?.params).toEqual(defaultParams("ema"));
  });

  it("amorce l'indicateur volume par défaut quand rien n'est persisté", () => {
    hydrateStores(); // localStorage vide (mock fraîchement installé)

    // toMatchObject : ignore l'`instanceId` ajouté par le store multi-instances (Mission 1.E).
    expect(indicatorsStore.getState().indicators).toMatchObject([
      { defId: "volume", params: defaultParams("volume") },
    ]);
  });
});

describe("hydrateStores — marché (exchange/symbole/timeframe)", () => {
  it("restaure exchange/symbole/timeframe valides", () => {
    localStorage.setItem(
      CHART_KEY,
      JSON.stringify({ symbol: "ethusdt", exchange: "kraken", timeframe: "4h", indicators: [] })
    );

    hydrateStores();

    const s = marketStore.getState();
    expect(s.exchange).toBe("kraken");
    expect(s.symbol).toBe("ETHUSDT"); // setSymbol uppercase
    expect(s.timeframe).toBe("4h");
  });

  it("ignore un exchange non restaurable (absent de RESTORABLE_EXCHANGES)", () => {
    localStorage.setItem(
      CHART_KEY,
      JSON.stringify({ symbol: "BTCUSDT", exchange: "bybit", timeframe: "1h", indicators: [] })
    );

    hydrateStores();

    expect(marketStore.getState().exchange).toBe("binance"); // valeur initiale inchangée
  });
});

describe("hydrateStores — watchlist", () => {
  it("restaure les symboles valides et écarte les entrées non-string/vides", () => {
    localStorage.setItem(WATCH_KEY, JSON.stringify(["ETHUSDT", "", 123, "SOLUSDT"]));

    hydrateStores();

    expect(watchlistStore.getState().symbols).toEqual(["ETHUSDT", "SOLUSDT"]);
  });

  it("retombe sur DEFAULT_WATCHLIST si la liste persistée est vide après filtrage", () => {
    localStorage.setItem(WATCH_KEY, JSON.stringify(["", 123, null]));

    hydrateStores();

    expect(watchlistStore.getState().symbols).toEqual(DEFAULT_WATCHLIST);
  });
});

describe("hydrateStores — watchlist nouveau format (groupes + sources)", () => {
  it("restaure les groupes, l'onglet actif et les sources explicites", () => {
    localStorage.setItem(
      WATCH_KEY,
      JSON.stringify({
        groups: [
          { id: "principal", name: "Principal", symbols: ["BTCUSDT"] },
          { id: "grp-2", name: "Alts", symbols: ["SOLUSDT", "ADAUSDT"] },
        ],
        activeGroupId: "grp-2",
        sources: { SOLUSDT: "kraken" },
      })
    );

    hydrateStores();

    const s = watchlistStore.getState();
    expect(s.groups.map((g) => g.id)).toEqual(["principal", "grp-2"]);
    expect(s.activeGroupId).toBe("grp-2");
    expect(s.symbols).toEqual(["SOLUSDT", "ADAUSDT"]); // miroir du groupe actif
    expect(s.sources).toEqual({ SOLUSDT: "kraken" });
  });

  it("corrige un onglet actif inconnu et élague sources orphelines / invalides", () => {
    localStorage.setItem(
      WATCH_KEY,
      JSON.stringify({
        groups: [{ id: "principal", name: "Principal", symbols: ["BTCUSDT"] }],
        activeGroupId: "onglet-fantome", // absent des groupes -> retombe sur le premier
        sources: { BTCUSDT: "coinbase", FANTOME: "kraken", ETHUSDT: "exchange-inconnu" },
      })
    );

    hydrateStores();

    const s = watchlistStore.getState();
    expect(s.activeGroupId).toBe("principal");
    // FANTOME (absent des groupes) et la source invalide sont écartées.
    expect(s.sources).toEqual({ BTCUSDT: "coinbase" });
  });

  it("saveWatchlist écrit le nouveau format objet {groups, activeGroupId, sources}", () => {
    watchlistStore.setState({
      groups: [{ id: "principal", name: "Principal", symbols: ["BTCUSDT", "ETHUSDT"] }],
      activeGroupId: "principal",
      sources: { ETHUSDT: "mexc" },
      symbols: ["BTCUSDT", "ETHUSDT"],
    });

    saveWatchlist();

    const raw = JSON.parse(localStorage.getItem(WATCH_KEY) ?? "null");
    expect(Array.isArray(raw)).toBe(false); // plus une liste plate
    expect(raw.activeGroupId).toBe("principal");
    expect(raw.groups).toHaveLength(1);
    expect(raw.sources).toEqual({ ETHUSDT: "mexc" });
  });
});

describe("hydrateStores — état de session (toggles, comparaison, overlays, sections, échelle)", () => {
  it("restaure toggles, comparaison, overlays macro, sections repliées et échelle", () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        compare: ["ETHUSDT", "SOLUSDT"],
        orderflow: true,
        volumeProfile: false,
        revenue: true,
        macroOverlays: ["m2", "stablecoins"],
        sections: { Alertes: true, Watchlist: false },
        priceScale: "log",
      })
    );

    hydrateStores();

    expect(orderflowStore.getState().enabled).toBe(true);
    expect(volumeProfileStore.getState().enabled).toBe(false);
    expect(revenueStore.getState().enabled).toBe(true);
    expect(compareStore.getState().symbols.map((c) => c.symbol)).toEqual(["ETHUSDT", "SOLUSDT"]);
    // setEnabled réordonne selon MACRO_OVERLAYS = ["crypto-total","stablecoins","m2"].
    expect(macroOverlayStore.getState().enabled).toEqual(["stablecoins", "m2"]);
    expect(uiSectionsStore.getState().open).toEqual({ Alertes: true, Watchlist: false });
    expect(priceScaleStore.getState().type).toBe("log");
  });

  it("ignore les valeurs de session invalides (types incorrects)", () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        orderflow: "oui", // pas un booléen -> ignoré (reste false)
        priceScale: "diagonale", // échelle inconnue -> ignorée (reste normal)
        macroOverlays: ["m2", "inexistant"], // "inexistant" filtré
        sections: { A: 1 }, // valeur non booléenne -> écartée
      })
    );

    hydrateStores();

    expect(orderflowStore.getState().enabled).toBe(false);
    expect(priceScaleStore.getState().type).toBe("normal");
    expect(macroOverlayStore.getState().enabled).toEqual(["m2"]);
    expect(uiSectionsStore.getState().open).toEqual({});
  });

  it("saveSessionUi sérialise l'instantané courant des stores de session", () => {
    orderflowStore.getState().setEnabled(true);
    priceScaleStore.getState().setType("percentage");
    uiSectionsStore.getState().setOpen("Macro", false);

    saveSessionUi();

    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    expect(raw.orderflow).toBe(true);
    expect(raw.priceScale).toBe("percentage");
    expect(raw.sections).toEqual({ Macro: false });
  });
});

describe("importerSauvegarde — remplacement des clés axiom:*", () => {
  it("purge les clés axiom:* existantes, conserve les autres, écrit celles du fichier", () => {
    localStorage.setItem("axiom:old:v1", "a-purger");
    localStorage.setItem("autre", "a-garder"); // hors préfixe : préservée

    const ok = importerSauvegarde(
      JSON.stringify({ "axiom:new:v1": "val", "axiom:x": "y", ignore: 123, "hors:prefixe": "z" })
    );

    expect(ok).toBe(true);
    expect(localStorage.getItem("axiom:old:v1")).toBeNull(); // purgée
    expect(localStorage.getItem("axiom:new:v1")).toBe("val");
    expect(localStorage.getItem("axiom:x")).toBe("y");
    expect(localStorage.getItem("autre")).toBe("a-garder"); // hors préfixe : intacte
    expect(localStorage.getItem("hors:prefixe")).toBeNull(); // clé sans préfixe axiom: ignorée
  });

  it("refuse un JSON invalide, un tableau ou un objet sans clé axiom: (aucun changement)", () => {
    localStorage.setItem("axiom:garde:v1", "intact");

    expect(importerSauvegarde("pas du json")).toBe(false);
    expect(importerSauvegarde(JSON.stringify([1, 2, 3]))).toBe(false);
    expect(importerSauvegarde(JSON.stringify({ foo: "bar" }))).toBe(false);

    expect(localStorage.getItem("axiom:garde:v1")).toBe("intact"); // rien n'a bougé
  });
});
