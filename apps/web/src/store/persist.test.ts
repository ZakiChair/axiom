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

// persist.ts importe désormais les stores de bascule liquidations (heatmap / niveaux
// estimés) pour les persister. Leur hydratation ré-active les singletons (subscribe →
// sync) : on stub les flux WS / OI pour garder ce test hors-réseau (aucun WebSocket réel).
vi.mock("../data/liquidations", () => ({ subscribeLiquidations: () => () => {} }));
vi.mock("../data/coinalyze", () => ({
  fetchLiquidationHistory: async () => [],
  fetchOpenInterestHistoryBatch: async () => new Map(),
}));

import { defaultParams, indicatorsStore } from "./indicators";
import { indicatorSetsStore } from "./indicatorSets";
import { marketStore } from "./market";
import { DEFAULT_WATCHLIST, watchlistStore } from "./watchlist";
import { compareStore } from "./compare";
import { orderflowStore } from "./orderflow";
import { refSymbolStore, REF_SYMBOL_DEFAUT } from "./refSymbol";
import { volumeProfileStore } from "./volumeProfile";
import { revenueStore } from "./revenue";
import { macroOverlayStore } from "./macro-overlays";
import { denominateurStore, DENOMINATEUR_DEFAUT } from "./denominateur";
import { uiSectionsStore } from "./ui-sections";
import { priceScaleStore } from "../chart/Chart";
import { liqMarksStore } from "../chart/liquidationMarkers";
import { liqEstStore } from "../chart/liquidationEstimates";
import {
  hydrateStores,
  saveChartState,
  saveSessionUi,
  saveWatchlist,
  importerSauvegarde,
  exporterSauvegarde,
  decisionsReconcile,
} from "./persist";
import type { SnapshotKv } from "../data/daemon";

const CHART_KEY = "axiom:chartState:v1";
const WATCH_KEY = "axiom:watchlist:v1";
const SESSION_KEY = "axiom:sessionUi:v1";
const META_KEY = "axiom:persistMeta:v1";

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
  refSymbolStore.getState().setRefSymbol(REF_SYMBOL_DEFAUT);
  volumeProfileStore.getState().setEnabled(false);
  revenueStore.getState().setEnabled(false);
  // setActif(false) coupe aussi le singleton (clearInterval OI) laissé actif par un test précédent.
  liqMarksStore.getState().setActif(false);
  liqMarksStore.getState().setMode("intensite");
  liqEstStore.getState().setActif(false);
  macroOverlayStore.getState().setEnabled([]);
  denominateurStore.getState().setDenominateur(DENOMINATEUR_DEFAUT);
  uiSectionsStore.getState().setAll({});
  priceScaleStore.getState().setType("normal");
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("hydrateStores — jeux d'indicateurs nommés", () => {
  // Le cycle COMPLET écrire → recharger. Ce trou de couverture a laissé passer une
  // fonctionnalité morte : l'hydrateur des jeux existait mais n'était appelé nulle
  // part, si bien qu'aucun jeu ne survivait au rechargement — et que le premier
  // ré-enregistrement écrasait ceux de la session précédente. 2945 tests étaient
  // verts pendant ce temps (revue adversariale BCD).
  it("réhydrate les jeux enregistrés au boot", () => {
    localStorage.setItem(
      "axiom:indicatorSets:v1",
      JSON.stringify([
        { id: "swing", nom: "Swing", instances: [{ instanceId: "sma-1", defId: "sma", params: { length: 20 }, couleurIdx: 0 }] },
      ])
    );

    hydrateStores();

    expect(indicatorSetsStore.getState().jeux.map((j) => j.nom)).toEqual(["Swing"]);
  });

  it("repart d'une liste vide sans casser quand la clé est absente", () => {
    hydrateStores();
    expect(indicatorSetsStore.getState().jeux).toEqual([]);
  });
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

  it("restaure une capitalisation autonome comme marché synthétique", () => {
    localStorage.setItem(
      CHART_KEY,
      JSON.stringify({ symbol: "TOTAL3", exchange: "synthetic", timeframe: "1d", indicators: [] }),
    );

    hydrateStores();

    expect(marketStore.getState()).toMatchObject({ exchange: "synthetic", symbol: "TOTAL3", timeframe: "1d" });
  });

  it("ignore un exchange non restaurable (absent de RESTORABLE_EXCHANGES)", () => {
    localStorage.setItem(
      CHART_KEY,
      JSON.stringify({ symbol: "BTCUSDT", exchange: "deribit", timeframe: "1h", indicators: [] })
    );

    hydrateStores();

    expect(marketStore.getState().exchange).toBe("binance"); // valeur initiale inchangée
  });

  it("ignore un timeframe persisté que la source restaurée ne supporte pas (plus de cast aveugle)", () => {
    // Coinbase ne supporte pas 6M (adapters.ts) : l'appliquer ferait partir le backfill
    // avec un interval invalide → graphe maître en erreur à chaque boot.
    localStorage.setItem(
      CHART_KEY,
      JSON.stringify({ symbol: "BTCUSDT", exchange: "coinbase", timeframe: "6M", indicators: [] })
    );

    hydrateStores();

    expect(marketStore.getState().exchange).toBe("coinbase");
    expect(marketStore.getState().timeframe).toBe("1m"); // valeur d'avant hydratation, inchangée
  });

  it("ignore un timeframe fantaisiste (sauvegarde éditée : \"5x\")", () => {
    localStorage.setItem(
      CHART_KEY,
      JSON.stringify({ symbol: "BTCUSDT", exchange: "binance", timeframe: "5x", indicators: [] })
    );

    hydrateStores();

    expect(marketStore.getState().timeframe).toBe("1m");
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
        refSymbol: "ethusdt", // minuscules -> normalisé en MAJUSCULES au restore
        volumeProfile: false,
        revenue: true,
        liqHeatmap: true,
        liqHeatmapMode: "dominance",
        liqEstimates: true,
        macroOverlays: ["m2", "stablecoins"],
        denominateur: "SOL",
        sections: { Alertes: true, Watchlist: false },
        priceScale: "log",
      })
    );

    hydrateStores();

    expect(orderflowStore.getState().enabled).toBe(true);
    expect(refSymbolStore.getState().refSymbol).toBe("ETHUSDT");
    expect(volumeProfileStore.getState().enabled).toBe(false);
    expect(revenueStore.getState().enabled).toBe(true);
    expect(liqMarksStore.getState().actif).toBe(true);
    expect(liqMarksStore.getState().mode).toBe("dominance");
    expect(liqEstStore.getState().actif).toBe(true);
    expect(compareStore.getState().symbols.map((c) => c.symbol)).toEqual(["ETHUSDT", "SOLUSDT"]);
    // setEnabled réordonne selon MACRO_OVERLAYS = ["crypto-total","stablecoins","m2"].
    expect(macroOverlayStore.getState().enabled).toEqual(["stablecoins", "m2"]);
    expect(denominateurStore.getState().denominateur).toBe("SOL");
    expect(uiSectionsStore.getState().open).toEqual({ Alertes: true, Watchlist: false });
    expect(priceScaleStore.getState().type).toBe("log");
  });

  it("ignore les valeurs de session invalides (types incorrects)", () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        orderflow: "oui", // pas un booléen -> ignoré (reste false)
        refSymbol: 42, // pas une chaîne -> ignoré (reste le défaut)
        liqHeatmapMode: "arc-en-ciel", // mode inconnu -> ignoré (reste intensite)
        priceScale: "diagonale", // échelle inconnue -> ignorée (reste normal)
        macroOverlays: ["m2", "inexistant"], // "inexistant" filtré
        denominateur: "DOGE", // hors DENOMINATEURS -> ignoré (reste le défaut ETH)
        sections: { A: 1 }, // valeur non booléenne -> écartée
      })
    );

    hydrateStores();

    expect(orderflowStore.getState().enabled).toBe(false);
    expect(refSymbolStore.getState().refSymbol).toBe(REF_SYMBOL_DEFAUT);
    expect(liqMarksStore.getState().mode).toBe("intensite");
    expect(priceScaleStore.getState().type).toBe("normal");
    expect(macroOverlayStore.getState().enabled).toEqual(["m2"]);
    expect(denominateurStore.getState().denominateur).toBe(DENOMINATEUR_DEFAUT);
    expect(uiSectionsStore.getState().open).toEqual({});
  });

  it("saveSessionUi sérialise l'instantané courant des stores de session", () => {
    orderflowStore.getState().setEnabled(true);
    refSymbolStore.getState().setRefSymbol("ethusdt");
    liqMarksStore.getState().setActif(true);
    liqMarksStore.getState().setMode("dominance");
    priceScaleStore.getState().setType("percentage");
    denominateurStore.getState().setDenominateur("SOL");
    uiSectionsStore.getState().setOpen("Macro", false);

    saveSessionUi();

    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    expect(raw.orderflow).toBe(true);
    expect(raw.refSymbol).toBe("ETHUSDT");
    expect(raw.liqHeatmap).toBe(true);
    expect(raw.liqHeatmapMode).toBe("dominance");
    expect(raw.liqEstimates).toBe(false);
    expect(raw.priceScale).toBe("percentage");
    expect(raw.denominateur).toBe("SOL");
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

describe("exporterSauvegarde — périmètre réel du fichier téléchargé", () => {
  /** Stub minimal du DOM pour capturer le Blob téléchargé (env vitest node). */
  async function capturerExport(): Promise<Record<string, string>> {
    let capture: Blob | null = null;
    const g = globalThis as unknown as { document?: unknown; URL: typeof URL };
    const urlObj = g.URL as unknown as Record<string, unknown>;
    const ancienCreate = urlObj.createObjectURL;
    const ancienRevoke = urlObj.revokeObjectURL;
    g.document = {
      createElement: () => ({ href: "", download: "", click: () => {}, remove: () => {} }),
      body: { appendChild: () => {} },
    };
    urlObj.createObjectURL = (b: Blob) => {
      capture = b;
      return "blob:test";
    };
    urlObj.revokeObjectURL = () => {};
    try {
      exporterSauvegarde();
    } finally {
      delete g.document;
      urlObj.createObjectURL = ancienCreate;
      urlObj.revokeObjectURL = ancienRevoke;
    }
    if (capture === null) throw new Error("aucun Blob exporté");
    return JSON.parse(await (capture as Blob).text()) as Record<string, string>;
  }

  it("embarque les clés API `axiom:*` EN CLAIR (d'où la confirmation avant export)", async () => {
    localStorage.setItem("axiom:coinalyze:key", "SECRET-COINALYZE");
    localStorage.setItem("axiom:fred:key", "SECRET-FRED");

    const dump = await capturerExport();

    expect(dump["axiom:coinalyze:key"]).toBe("SECRET-COINALYZE");
    expect(dump["axiom:fred:key"]).toBe("SECRET-FRED");
  });

  it("n'embarque PAS la clé CoinGecko : elle est hors préfixe `axiom:` (promesse corrigée)", async () => {
    localStorage.setItem("axiom.coingecko.demoApiKey", "SECRET-CG");
    localStorage.setItem("axiom:coinalyze:key", "SECRET-COINALYZE");

    const dump = await capturerExport();

    expect(dump["axiom.coingecko.demoApiKey"]).toBeUndefined();
    expect(Object.keys(dump).every((k) => k.startsWith("axiom:"))).toBe(true);
  });
});

describe("decisionsReconcile — arbitrage local ↔ daemon (last-write-wins)", () => {
  // `valeur` d'un snapshot = JSON déjà parsé ; pour les clés persist c'est la CHAÎNE
  // localStorage (double-encodée puis re-parsée → restituée telle quelle).
  const chaine = (obj: unknown) => JSON.stringify(obj);

  it("adopte la valeur du daemon quand le local est ABSENT (cache vidé)", () => {
    const snap: SnapshotKv = { [CHART_KEY]: { valeur: chaine({ symbol: "ETHUSDT" }), majA: 500 } };
    const decisions = decisionsReconcile([CHART_KEY], snap, () => null, {});
    expect(decisions).toEqual([
      { cle: CHART_KEY, action: "adopter", valeur: chaine({ symbol: "ETHUSDT" }), majA: 500 },
    ]);
  });

  it("adopte le daemon quand son horodatage est strictement plus récent que la meta locale", () => {
    const snap: SnapshotKv = { [CHART_KEY]: { valeur: chaine({ symbol: "SOL" }), majA: 900 } };
    const local: Record<string, string> = { [CHART_KEY]: chaine({ symbol: "BTC" }) };
    const decisions = decisionsReconcile([CHART_KEY], snap, (k) => local[k] ?? null, { [CHART_KEY]: 800 });
    expect(decisions).toEqual([
      { cle: CHART_KEY, action: "adopter", valeur: chaine({ symbol: "SOL" }), majA: 900 },
    ]);
  });

  it("pousse le local quand sa meta est strictement plus récente que le daemon", () => {
    const snap: SnapshotKv = { [CHART_KEY]: { valeur: chaine({ symbol: "SOL" }), majA: 700 } };
    const local: Record<string, string> = { [CHART_KEY]: chaine({ symbol: "BTC" }) };
    const decisions = decisionsReconcile([CHART_KEY], snap, (k) => local[k] ?? null, { [CHART_KEY]: 900 });
    expect(decisions).toEqual([{ cle: CHART_KEY, action: "pousser", valeur: chaine({ symbol: "BTC" }) }]);
  });

  it("sème le local quand le daemon IGNORE la clé (durabilité première session)", () => {
    const local: Record<string, string> = { [WATCH_KEY]: chaine(["BTCUSDT"]) };
    const decisions = decisionsReconcile([WATCH_KEY], {}, (k) => local[k] ?? null, {});
    expect(decisions).toEqual([{ cle: WATCH_KEY, action: "pousser", valeur: chaine(["BTCUSDT"]) }]);
  });

  it("préfère le local (pousse) quand il est présent SANS meta (utilisateur pré-feature)", () => {
    const snap: SnapshotKv = { [CHART_KEY]: { valeur: chaine({ symbol: "SOL" }), majA: 700 } };
    const local: Record<string, string> = { [CHART_KEY]: chaine({ symbol: "BTC" }) };
    const decisions = decisionsReconcile([CHART_KEY], snap, (k) => local[k] ?? null, {});
    expect(decisions).toEqual([{ cle: CHART_KEY, action: "pousser", valeur: chaine({ symbol: "BTC" }) }]);
  });

  it("ne fait rien à horodatage égal, ni si daemon et local sont tous deux absents", () => {
    const snap: SnapshotKv = { [CHART_KEY]: { valeur: chaine({ symbol: "BTC" }), majA: 800 } };
    const local: Record<string, string> = { [CHART_KEY]: chaine({ symbol: "BTC" }) };
    expect(
      decisionsReconcile([CHART_KEY], snap, (k) => local[k] ?? null, { [CHART_KEY]: 800 }),
    ).toEqual([]);
    // Daemon absent + local absent → aucune décision.
    expect(decisionsReconcile([SESSION_KEY], {}, () => null, {})).toEqual([]);
  });

  it("ignore une entrée daemon dont la valeur n'est pas une chaîne (corrompue)", () => {
    const snap = { [CHART_KEY]: { valeur: { pas: "une chaîne" }, majA: 999 } } as unknown as SnapshotKv;
    expect(decisionsReconcile([CHART_KEY], snap, () => null, {})).toEqual([]);
  });
});

describe("dual-write — aucune régression sans daemon", () => {
  it("saveSessionUi écrit localStorage + horodatage local sans erreur ni réseau (daemon absent)", () => {
    orderflowStore.getState().setEnabled(true);

    expect(() => saveSessionUi()).not.toThrow();

    // La session est bien persistée localement…
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null").orderflow).toBe(true);
    // …et un horodatage local a été enregistré pour la clé gérée (arbitrage futur).
    const meta = JSON.parse(localStorage.getItem(META_KEY) ?? "{}");
    expect(typeof meta[SESSION_KEY]).toBe("number");
  });
});

describe("multi-fenêtres — seule la fenêtre focalisée persiste", () => {
  afterEach(() => {
    delete (globalThis as { document?: { hasFocus: () => boolean } }).document;
  });

  it("saveChartState est un no-op dans une fenêtre SANS focus (fenêtre passive du mode multi-fenêtres)", () => {
    // Scénario du constat : la fenêtre B applique un setSymbol diffusé par A (sync.ts)
    // → son abonnement déclenche saveChartState avec SES indicateurs en mémoire (sans
    // l'EMA ajoutée dans A) et écrasait la clé. B n'a pas le focus : l'écriture doit être ignorée.
    (globalThis as { document?: { hasFocus: () => boolean } }).document = { hasFocus: () => false };
    saveChartState();
    expect(localStorage.getItem(CHART_KEY)).toBeNull();
  });

  it("saveChartState écrit normalement dans la fenêtre focalisée", () => {
    (globalThis as { document?: { hasFocus: () => boolean } }).document = { hasFocus: () => true };
    saveChartState();
    expect(JSON.parse(localStorage.getItem(CHART_KEY) ?? "null")?.symbol).toBe("BTCUSDT");
  });
});
