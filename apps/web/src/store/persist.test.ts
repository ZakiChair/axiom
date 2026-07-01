/**
 * Tests de hydrateStores — garde qui filtre les `defId` disparus du registre
 * @axiom/indicators et backfille les `params` manquants depuis un ChartState
 * persisté potentiellement ancien. Une régression de la négation `!== undefined`
 * restaurerait des indicateurs fantômes (crash du contrôleur) ou jetterait tous
 * les indicateurs valides au premier chargement après mise à jour du registre.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultParams, indicatorsStore } from "./indicators";
import { marketStore } from "./market";
import { DEFAULT_WATCHLIST, watchlistStore } from "./watchlist";
import { hydrateStores } from "./persist";

const CHART_KEY = "axiom:chartState:v1";
const WATCH_KEY = "axiom:watchlist:v1";

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

let localStorage: Storage;

beforeEach(() => {
  localStorage = installMockLocalStorage();
  marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m" });
  indicatorsStore.setState({ indicators: [] });
  watchlistStore.setState({ symbols: [...DEFAULT_WATCHLIST] });
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

    expect(indicatorsStore.getState().indicators).toEqual([{ defId: "sma", params: { length: 42 } }]);
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

    expect(indicatorsStore.getState().indicators).toEqual([
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
