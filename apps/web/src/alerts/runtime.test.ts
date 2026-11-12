/**
 * Câblage du runtime des alertes (creerRuntime via demarrerAlertes) — source « clôture
 * de bougie » : une condition variation-pct se déclenche sur bougie CLÔTURÉE uniquement
 * (jamais sur la bougie en formation) et le ré-armement fonctionne bout-en-bout
 * (journal + état `arme` de la def). Réseau/WS/daemon mockés (aucun accès réseau) ;
 * alertsStore et marketStore sont réels : env node, localStorage absent = no-op toléré.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertDef } from "@axiom/alerts";
import type { Candle, Timeframe } from "@axiom/types";

const { executerScreenerMock, subscribeTickersMock, daemonSupporteMock, detectDaemonMock, urlDaemonMock, chargerFluxMock, chargerOnchainMock, coinalyzeFundingMock, coinalyzeHistoryMock, auxRecus, lotsEvalues, getAlignedMock, navigateToMock } =
  vi.hoisted(() => ({
    auxRecus: [] as unknown[],
    /** Ids des defs de chaque appel au moteur, dans l'ordre (une entrée par passe d'évaluation). */
    lotsEvalues: [] as string[][],
    navigateToMock: vi.fn((_intent: unknown): void => {}),
    getAlignedMock: vi.fn((_req: unknown, _cb: () => void): unknown => ({ status: "ready", aux: {} })),
    executerScreenerMock: vi.fn(),
    subscribeTickersMock: vi.fn((..._args: unknown[]) => () => {}),
    daemonSupporteMock: vi.fn(() => false),
    detectDaemonMock: vi.fn(async () => false),
    urlDaemonMock: vi.fn((chemin: string) => chemin),
    chargerFluxMock: vi.fn(() => new Promise(() => {})),
    chargerOnchainMock: vi.fn(() => new Promise(() => {})),
    coinalyzeFundingMock: vi.fn(async () => ({ rate: 0 })),
    coinalyzeHistoryMock: vi.fn(async () => []),
  }));
vi.mock("@axiom/alerts", async (importOriginal) => {
  const original = await importOriginal<typeof import("@axiom/alerts")>();
  return {
    ...original,
    evaluerAlertes: vi.fn((lot: Array<{ id: string }>, ctx: { aux?: unknown }) => {
      auxRecus.push(ctx.aux);
      lotsEvalues.push(lot.map((d) => d.id));
      return original.evaluerAlertes(lot as Parameters<typeof original.evaluerAlertes>[0], ctx as Parameters<typeof original.evaluerAlertes>[1]);
    }),
  };
});
// « Voir » importe la navigation à l'usage ; le vrai module tire klinecharts, inutilisable sous node.
vi.mock("../lib/navigation", () => ({ navigateTo: navigateToMock }));
vi.mock("../chart/auxProvider", () => ({
  auxProvider: { getAligned: getAlignedMock },
}));
vi.mock("../data/ticker", async (importOriginal) => {
  const original = await importOriginal<typeof import("../data/ticker")>();
  return { ...original, subscribeTickers: subscribeTickersMock };
});
vi.mock("../data/daemon", () => ({
  daemonPret: () => false,
  daemonSupporte: daemonSupporteMock,
  detectDaemon: detectDaemonMock,
  urlDaemon: urlDaemonMock,
  kvPut: async () => null,
}));
vi.mock("../data/coinalyze", () => ({
  coinalyzeProvider: {
    fetchFundingRate: coinalyzeFundingMock,
    fetchFundingRateHistory: coinalyzeHistoryMock,
  },
}));
vi.mock("../data/screenerRun", () => ({ executerScreener: executerScreenerMock }));
vi.mock("../data/onchain/fluxCapitaux", async (importOriginal) => {
  const original = await importOriginal<typeof import("../data/onchain/fluxCapitaux")>();
  return { ...original, chargerFluxCapitaux: chargerFluxMock };
});
vi.mock("./onchainMetriques", () => ({ chargerMetriquesOnchain: chargerOnchainMock }));
vi.mock("../chart/liquidationMarkers", () => ({
  fluxLiqRetenu: () => false,
  liqEventsStore: { getState: () => ({ events: [] }), subscribe: () => () => {} },
}));
vi.mock("../store/regime", () => ({
  regimeStore: { getState: () => ({ regime: null }), subscribe: () => () => {} },
}));

import { clotureBougie, demarrerAlertes, mentionRattrapage, notifier, ouvertureSignal } from "./runtime";
import { extensionGrapheStore, publierExtension } from "./amorceGraphe";
import { construireConditionSeuil, paramsInstancePourAlerte } from "../components/alertsPanel.util";
import { getIndicator } from "@axiom/indicators";
import { alertsStore } from "../store/alerts";
import { chartLayoutStore } from "../store/chart-layout";
import { toastsStore } from "../store/toasts";
import { marketStore } from "../store/market";
import { orderflowStore } from "../store/orderflow";
import { presetAlertsStore, type AlertePreset } from "../store/presetAlerts";
// Le runtime charge ces deux modules par import() au premier scan d'une alerte de preset.
// Chargés ici une fois : sous horloge simulée, un premier chargement resterait en suspens.
import "../data/screenerRun";
import "../data/screener";
// Même raison pour la collecte des flux de capitaux, que `store/fluxCapitaux` charge par import() à
// chaque démarrage du runtime : tant que la fabrique asynchrone de son mock n'est pas résolue, Vitest
// sert le VRAI module aux import() suivants. Sa collecte réelle (17 requêtes) tombait alors, machine
// chargée, dans un test qui compte les fetch. Chargé ici une fois, le mock est servi à tous les tests.
import "../data/onchain/fluxCapitaux";
import { fluxCapitauxStore } from "../store/fluxCapitaux";
import { remplacerLectures } from "../store/analyseMultidomaine";
import type { LectureAnalyse } from "../data/analyseMultidomaine";
import fixtureBtc from "../../../../packages/indicators/src/strategy/fixtures/btcusdt-4h-3000.json";

/** Bougie plate au prix donné (les champs OHLC égaux suffisent au moteur). */
function bougie(time: number, close: number, closed: boolean): Candle {
  return { time, open: close, high: close, low: close, close, volume: 1, closed };
}

const DEF: AlertDef = {
  id: "a1",
  symbol: "BTCUSDT",
  source: "binance",
  condition: { type: "variation-pct", fenetreMs: 60_000, seuilPct: 5 },
  actif: true,
  declenchements: [],
};

let stop: (() => void) | null = null;

beforeEach(() => {
  alertsStore.setState({ defs: [], journal: [] });
  marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m", candles: [] });
  orderflowStore.setState({ enabled: false, cvdSpotPerp: false, alerteCvdDemandee: false });
  presetAlertsStore.setState({ alertes: [] });
  fluxCapitauxStore.setState({ donnees: null, chargement: false, erreur: null });
  subscribeTickersMock.mockClear();
  daemonSupporteMock.mockReset();
  daemonSupporteMock.mockReturnValue(false);
  detectDaemonMock.mockReset();
  detectDaemonMock.mockResolvedValue(false);
  urlDaemonMock.mockReset();
  urlDaemonMock.mockImplementation((chemin: string) => chemin);
  executerScreenerMock.mockReset();
  executerScreenerMock.mockResolvedValue({ rows: [], notes: [] });
  chargerOnchainMock.mockReset();
  chargerOnchainMock.mockImplementation(() => new Promise(() => {}));
  coinalyzeFundingMock.mockClear();
  coinalyzeHistoryMock.mockClear();
  auxRecus.length = 0;
  lotsEvalues.length = 0;
  navigateToMock.mockClear();
  toastsStore.setState({ toasts: [] });
  chartLayoutStore.setState({ layout: "1", focus: 0 });
  getAlignedMock.mockReset();
  getAlignedMock.mockImplementation((_req: unknown, _cb: () => void): unknown => ({ status: "ready", aux: {} }));
});

describe("alerte lente de flux sans panneau ouvert", () => {
  it("fige le registre avant les abonnés synchrones de l'alerte", () => {
    const maintenant = Date.UTC(2026, 8, 9, 12);
    vi.spyOn(Date, "now").mockReturnValue(maintenant);
    const lecture: LectureAnalyse = { id: "us", domaine: "quadrant", nature: "observation", conclusion: "A",
      tags: [{ cle: "quadrant", valeur: "A" }], instrument: null,
      horizon: { depuis: maintenant - 1000, jusqua: maintenant - 1000 }, unite: null, valeur: null,
      source: "FRED", observeLe: maintenant - 1000, recupereLe: maintenant - 1000,
      validiteJusqua: maintenant + 1000, statut: "frais", couverture: null, limites: [],
      preuve: { fenetre: "RATE", reference: "US" } };
    remplacerLectures("quadrant", [lecture]);
    alertsStore.setState({ defs: defsFlux(["stablecoins-variation-7j"]), journal: [] });
    fluxCapitauxStore.setState({ donnees: { recupereLe: maintenant, metriques: metriquesFlux(["stablecoins-variation-7j"], 1, maintenant) } });
    stop = demarrerAlertes();
    const arreter = alertsStore.subscribe((state) => {
      if (state.defs[0]?.arme === false) remplacerLectures("quadrant", [{ ...lecture, conclusion: "B", tags: [{ cle: "quadrant", valeur: "B" }] }]);
    });
    fluxCapitauxStore.setState({ donnees: { recupereLe: maintenant, metriques: metriquesFlux(["stablecoins-variation-7j"], 3, maintenant) } });
    arreter();
    expect(alertsStore.getState().journal[0]?.preuve?.analyse?.lectures[0]?.conclusion).toBe("A");
    remplacerLectures("quadrant", []);
  });
  const metriquesFlux = (ids: readonly ("stablecoins-variation-7j" | "realized-cap-variation-30j" | "realized-cap-variation-90j")[], valeur: number, maintenant: number) => ids.map((id) => ({
    id, libelle: id, valeur, unite: "%", periode: "jour", observeLe: maintenant, source: "source", alerte: true,
    qualite: { sourceId: id, sourceEffective: "source", observeLe: maintenant, recupereLe: maintenant, cadenceMs: 86_400_000,
      couverture: null, estime: false, acces: "public" as const, statut: "frais" as const },
  }));
  const defsFlux = (ids: readonly ("stablecoins-variation-7j" | "realized-cap-variation-30j" | "realized-cap-variation-90j")[]) => ids.map((id) => ({
    id, symbol: "BTCUSDT", source: "binance" as const,
    condition: { type: "flux-capitaux-seuil" as const, metrique: id, comparateur: ">=" as const, valeur: 2 }, actif: true, declenchements: [],
  }));

  it("évalue le store commun et conserve l'instantané explicatif dans le journal", () => {
    const maintenant = Date.UTC(2026, 8, 9, 12);
    vi.spyOn(Date, "now").mockReturnValue(maintenant);
    alertsStore.setState({
      defs: [{
        id: "flux",
        symbol: "BTCUSDT",
        source: "binance",
        condition: { type: "flux-capitaux-seuil", metrique: "stablecoins-variation-7j", comparateur: ">=", valeur: 2 },
        actif: true,
        declenchements: [],
      }],
      journal: [],
    });
    const metrique = {
      id: "stablecoins-variation-7j" as const,
      libelle: "Variation stablecoins",
      valeur: 1,
      unite: "%",
      periode: "7 j",
      observeLe: maintenant - 86_400_000,
      source: "DefiLlama",
      alerte: true,
      qualite: {
        sourceId: "flux:stablecoins-variation-7j",
        sourceEffective: "DefiLlama",
        observeLe: maintenant - 86_400_000,
        recupereLe: maintenant,
        cadenceMs: 86_400_000,
        couverture: null,
        estime: false,
        acces: "public" as const,
        statut: "frais" as const,
      },
    };
    fluxCapitauxStore.setState({ donnees: { recupereLe: maintenant, metriques: [metrique] }, chargement: false, erreur: null });

    stop = demarrerAlertes();
    expect(alertsStore.getState().defs[0]?.arme).toBe(true);
    fluxCapitauxStore.setState({ donnees: { recupereLe: maintenant, metriques: [{ ...metrique, valeur: 3 }] } });

    expect(alertsStore.getState().journal[0]).toMatchObject({
      alertId: "flux",
      valeur: 3,
      instantane: { unite: "%", observeLe: maintenant - 86_400_000, source: "DefiLlama" },
    });
  });

  it("journalise une seule fois plusieurs franchissements du même snapshot", () => {
    const maintenant = Date.UTC(2026, 8, 9, 12);
    vi.spyOn(Date, "now").mockReturnValue(maintenant);
    const ids = ["stablecoins-variation-7j", "realized-cap-variation-30j"] as const;
    alertsStore.setState({ defs: defsFlux(ids), journal: [] });
    fluxCapitauxStore.setState({ donnees: { recupereLe: maintenant, metriques: metriquesFlux(ids, 1, maintenant) } });
    stop = demarrerAlertes();
    fluxCapitauxStore.setState({ donnees: { recupereLe: maintenant, metriques: metriquesFlux(ids, 3, maintenant) } });
    expect(alertsStore.getState().journal.map((d) => d.alertId).sort()).toEqual([...ids].sort());
  });

  it("ne journalise pas les alertes supprimées ou désactivées pendant une mise à jour", () => {
    const maintenant = Date.UTC(2026, 8, 9, 12);
    vi.spyOn(Date, "now").mockReturnValue(maintenant);
    const ids = ["stablecoins-variation-7j", "realized-cap-variation-30j", "realized-cap-variation-90j"] as const;
    alertsStore.setState({ defs: defsFlux(ids), journal: [] });
    fluxCapitauxStore.setState({ donnees: { recupereLe: maintenant, metriques: metriquesFlux(ids, 1, maintenant) } });
    stop = demarrerAlertes();
    let applique = false;
    const arreter = alertsStore.subscribe((state) => {
      if (!applique && state.defs.find((d) => d.id === ids[0])?.arme === false) {
        applique = true;
        alertsStore.getState().supprimer(ids[1]);
        alertsStore.getState().basculerActif(ids[2]);
      }
    });
    fluxCapitauxStore.setState({ donnees: { recupereLe: maintenant, metriques: metriquesFlux(ids, 3, maintenant) } });
    arreter();
    expect(alertsStore.getState().journal.map((d) => d.alertId)).toEqual([ids[0]]);
  });

  it("calibre une définition ajoutée pendant une mise à jour sans doublon", () => {
    const maintenant = Date.UTC(2026, 8, 9, 12);
    vi.spyOn(Date, "now").mockReturnValue(maintenant);
    const ids = ["stablecoins-variation-7j"] as const;
    alertsStore.setState({ defs: defsFlux(ids), journal: [] });
    fluxCapitauxStore.setState({ donnees: { recupereLe: maintenant, metriques: metriquesFlux(ids, 1, maintenant) } });
    let ajoute = false;
    const arreter = alertsStore.subscribe((state) => {
      if (!ajoute && state.defs[0]?.arme === true) {
        ajoute = true;
        alertsStore.getState().ajouter({ symbol: "BTCUSDT", source: "binance",
          condition: { type: "flux-capitaux-seuil", metrique: ids[0], comparateur: ">=", valeur: 2 } });
      }
    });
    stop = demarrerAlertes();
    arreter();
    expect(alertsStore.getState().defs).toHaveLength(2);
    expect(alertsStore.getState().defs.every((d) => d.arme === true)).toBe(true);
    fluxCapitauxStore.setState({ donnees: { recupereLe: maintenant, metriques: metriquesFlux(ids, 3, maintenant) } });
    expect(new Set(alertsStore.getState().journal.map((d) => d.alertId)).size).toBe(2);
    expect(alertsStore.getState().journal).toHaveLength(2);
  });
});

describe("identité d'alerte (source, symbole)", () => {
  const prix = (id: string, source: AlertDef["source"]): AlertDef => ({
    id,
    symbol: "BTCUSDT",
    source,
    condition: { type: "prix-croise", niveau: 105, sens: "hausse" },
    actif: true,
    declenchements: [],
  });

  function callbackTicker(source: string): (update: { symbol: string; price: number; changePercent: number }) => void {
    const call = subscribeTickersMock.mock.calls.find((args) => {
      const options = args[2] as { source?: string } | undefined;
      return options?.source === source;
    });
    expect(call, `abonnement ticker ${source}`).toBeDefined();
    return call?.[1] as (update: { symbol: string; price: number; changePercent: number }) => void;
  }

  it("abonne chaque source ticker séparément et un tick Binance ne déclenche que la def Binance", () => {
    alertsStore.setState({ defs: [prix("binance", "binance"), prix("coinbase", "coinbase")], journal: [] });
    stop = demarrerAlertes();

    expect(subscribeTickersMock).toHaveBeenCalledTimes(2);
    const onBinance = callbackTicker("binance");
    onBinance({ symbol: "BTCUSDT", price: 100, changePercent: 0 });
    onBinance({ symbol: "BTCUSDT", price: 110, changePercent: 10 });

    expect(alertsStore.getState().journal.map((d) => d.alertId)).toEqual(["binance"]);
    expect(alertsStore.getState().defs.find((d) => d.id === "coinbase")?.arme).toBeUndefined();
  });

  it.each(["okx", "bybit", "hyperliquid"] as const)("utilise le ticker %s et conserve l'identité de l'alerte", (source) => {
    const symbol = source === "hyperliquid" ? "BTC-PERP" : "BTCUSDT";
    alertsStore.setState({ defs: [{ ...prix(source, source), symbol }, prix("binance", "binance")], journal: [] });
    stop = demarrerAlertes();
    const onSource = callbackTicker(source);
    onSource({ symbol, price: 100, changePercent: 0 });
    onSource({ symbol, price: 110, changePercent: 10 });
    expect(alertsStore.getState().journal.map((d) => d.alertId)).toEqual([source]);
    expect(alertsStore.getState().defs.find((d) => d.id === "binance")?.arme).toBeUndefined();
  });

  it("une clôture Binance ne déclenche que la def de bougie Binance", () => {
    const t0 = Date.now() - 180_000;
    const variation = (id: string, source: AlertDef["source"]): AlertDef => ({
      ...DEF,
      id,
      source,
      timeframe: "1m",
    });
    alertsStore.setState({
      defs: [variation("binance", "binance"), variation("coinbase", "coinbase")],
      journal: [],
    });
    marketStore.setState({
      exchange: "binance",
      symbol: "BTCUSDT",
      timeframe: "1m",
      candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true)],
    });
    stop = demarrerAlertes();
    marketStore.setState({
      candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true), bougie(t0 + 120_000, 110, true)],
    });

    expect(alertsStore.getState().journal.map((d) => d.alertId)).toEqual(["binance"]);
    expect(alertsStore.getState().defs.find((d) => d.id === "coinbase")?.arme).toBeUndefined();
  });

  it("ne partage pas le contexte composite entre deux sources du même symbole", () => {
    const compositeCoinbase: AlertDef = {
      id: "composite-coinbase",
      symbol: "BTCUSDT",
      source: "coinbase",
      condition: {
        type: "composite",
        conditions: [
          { type: "prix-croise", niveau: 105, sens: "hausse" },
          { type: "prix-croise", niveau: 200, sens: "baisse" },
        ],
      },
      actif: true,
      declenchements: [],
    };
    alertsStore.setState({ defs: [prix("binance", "binance"), compositeCoinbase], journal: [] });
    stop = demarrerAlertes();

    callbackTicker("binance")({ symbol: "BTCUSDT", price: 110, changePercent: 0 });

    expect(alertsStore.getState().defs.find((d) => d.id === "composite-coinbase")?.arme).toBeUndefined();
  });

  it("ne nourrit pas un composite 1h avec les bougies 1m du même marché", () => {
    const t0 = Date.now() - 180_000;
    const composite1h: AlertDef = {
      id: "composite-1h",
      symbol: "BTCUSDT",
      source: "binance",
      timeframe: "1h",
      condition: {
        type: "composite",
        conditions: [
          { type: "prix-croise", niveau: 105, sens: "hausse" },
          { type: "variation-pct", fenetreMs: 60_000, seuilPct: 5 },
        ],
      },
      actif: true,
      declenchements: [],
    };
    alertsStore.setState({ defs: [composite1h], journal: [] });
    marketStore.setState({
      exchange: "binance",
      symbol: "BTCUSDT",
      timeframe: "1m",
      candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 110, true)],
    });

    stop = demarrerAlertes();

    expect(alertsStore.getState().defs[0]?.arme).toBeUndefined();
  });

  it("évalue une def prix sans route ticker sur les clôtures du chart de cette source", () => {
    const t0 = Date.now() - 180_000;
    const symbol = "binance:BTCUSDT|/|binance:ETHUSDT";
    alertsStore.setState({ defs: [{ ...prix("ratio", "synthetic"), symbol }], journal: [] });
    marketStore.setState({
      exchange: "synthetic",
      symbol,
      timeframe: "1m",
      candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true)],
    });
    stop = demarrerAlertes();
    marketStore.setState({
      candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true), bougie(t0 + 120_000, 110, true)],
    });

    expect(subscribeTickersMock).not.toHaveBeenCalled();
    expect(alertsStore.getState().journal.map((d) => d.alertId)).toEqual(["ratio"]);
  });

  it("un ticker à 100 n'est pas écrasé par un funding hors chart : prix sous 90 reste faux", async () => {
    let maintenant = 5_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => maintenant);
    let relacherFunding: ((r: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("premiumIndex")) {
        return new Promise<Response>((resolve) => {
          relacherFunding = resolve;
        });
      }
      return Promise.resolve(new Response("[]"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const composite: AlertDef = {
      id: "comp-prix-fund",
      symbol: "BTCUSDT",
      source: "binance",
      condition: {
        type: "composite",
        conditions: [
          { type: "prix-croise", niveau: 90, sens: "baisse" },
          { type: "funding-extreme", seuilAbs: 0.001, sens: "long-crowded" },
        ],
      },
      actif: true,
      declenchements: [],
    };
    alertsStore.setState({ defs: [composite], journal: [] });
    marketStore.setState({
      exchange: "coinbase",
      symbol: "ETHUSDT",
      timeframe: "1h",
      candles: [],
    });
    stop = demarrerAlertes();
    callbackTicker("binance")({ symbol: "BTCUSDT", price: 100, changePercent: 0 });
    expect(alertsStore.getState().journal).toHaveLength(0);

    maintenant = 5_002_000;
    await vi.waitFor(() => expect(relacherFunding).toBeDefined());
    relacherFunding!(new Response(JSON.stringify({ lastFundingRate: "0.002" })));
    await vi.waitFor(() => {
      expect(alertsStore.getState().defs[0]?.arme).toBeDefined();
    });
    expect(alertsStore.getState().journal).toHaveLength(0);
  });
});

describe("heartbeat v2 et notification navigateur", () => {
  function stubNotification(permission: "granted" | "denied" | "default") {
    const Ctor = vi.fn();
    Object.defineProperty(Ctor, "permission", { value: permission });
    vi.stubGlobal("Notification", Ctor);
    return Ctor;
  }

  it("POST /heartbeat porte {visible, canNotify} : onglet caché ⇒ canNotify false", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true })),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "hidden" }));
    stubNotification("granted");
    daemonSupporteMock.mockReturnValue(true);
    detectDaemonMock.mockResolvedValue(true);

    stop = demarrerAlertes();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const appel = fetchMock.mock.calls.find((args) => String(args[0]).includes("/heartbeat"));
    expect(appel, "POST /heartbeat").toBeDefined();
    const init = appel?.[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ visible: false, canNotify: false });
  });

  it("POST /heartbeat : onglet visible et permission accordée ⇒ canNotify true", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true })),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    stubNotification("granted");
    daemonSupporteMock.mockReturnValue(true);
    detectDaemonMock.mockResolvedValue(true);

    stop = demarrerAlertes();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const appel = fetchMock.mock.calls.find((args) => String(args[0]).includes("/heartbeat"));
    expect(JSON.parse(String(appel?.[1]?.body))).toEqual({
      visible: true,
      canNotify: true,
    });
  });

  it("le navigateur n'affiche une Notification que si onglet visible ET permission accordée", () => {
    const decl = { alertId: "a1", ts: 1, valeur: 110, message: "BTCUSDT franchit 105" };
    const Ctor = stubNotification("granted");
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "hidden" }));
    notifier(decl);
    expect(Ctor).not.toHaveBeenCalled();

    Ctor.mockClear();
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    notifier(decl);
    expect(Ctor).toHaveBeenCalledTimes(1);
    expect(Ctor).toHaveBeenCalledWith("AXIOM — alerte", { body: decl.message });
  });

  it("permission refusée : pas de Notification même onglet visible", () => {
    const Ctor = stubNotification("denied");
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    notifier({ alertId: "a1", ts: 1, valeur: 1, message: "x" });
    expect(Ctor).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("creerRuntime — source clôture de bougie (variation-pct)", () => {
  it("déclenche sur bougie CLÔTURÉE, ignore la bougie en formation, et se ré-arme", () => {
    const maintenant = Date.now();
    const tA = maintenant - 180_000;
    const tB = maintenant - 120_000;
    const tC = maintenant - 60_000;
    const tD = maintenant;

    alertsStore.setState({ defs: [DEF], journal: [] });
    // Calibrage initial (démarrage du runtime) : 2 bougies clôturées à 100 → pct 0,
    // AUCUN déclenchement, l'alerte est armée (frontArme avec arme=undefined).
    marketStore.setState({ candles: [bougie(tA, 100, true), bougie(tB, 100, true)] });
    stop = demarrerAlertes();
    expect(alertsStore.getState().journal).toHaveLength(0);
    expect(alertsStore.getState().defs[0]?.arme).toBe(true);

    // Nouvelle bougie CLÔTURÉE à +10 % (référence = clôture de la bougie précédente = 100)
    // → le câblage marketStore → moteur déclenche : journal + désarmement.
    marketStore.setState({
      candles: [bougie(tA, 100, true), bougie(tB, 100, true), bougie(tC, 110, true)],
    });
    expect(alertsStore.getState().journal).toHaveLength(1);
    expect(alertsStore.getState().defs[0]?.arme).toBe(false);
    expect(alertsStore.getState().journal[0]?.preuve).toMatchObject({
      origine: { alertId: "a1", ts: expect.any(Number), symbol: "BTCUSDT", source: "binance", condition: DEF.condition },
      contexte: { dernierPrix: 110, prixPrecedent: 100, derniereBougie: { time: tC, close: 110 } },
    });

    // Bougie EN FORMATION à +100 % : PAS évaluée (la dernière clôturée est déjà traitée,
    // garde dernierTempsCloture) — aucun déclenchement supplémentaire.
    marketStore.setState({
      candles: [bougie(tA, 100, true), bougie(tB, 100, true), bougie(tC, 110, true), bougie(tD, 200, false)],
    });
    expect(alertsStore.getState().journal).toHaveLength(1);

    // La bougie se clôture à 100 (pct 0, sous le seuil) → ré-armement sans déclenchement.
    marketStore.setState({
      candles: [bougie(tA, 100, true), bougie(tB, 100, true), bougie(tC, 110, true), bougie(tD, 100, true)],
    });
    expect(alertsStore.getState().journal).toHaveLength(1);
    expect(alertsStore.getState().defs[0]?.arme).toBe(true);

    // Nouvelle clôture à +12 % → 2e déclenchement : le ré-armement fonctionne bout-en-bout.
    marketStore.setState({
      candles: [
        bougie(tA, 100, true),
        bougie(tB, 100, true),
        bougie(tC, 110, true),
        bougie(tD, 100, true),
        bougie(tD + 60_000, 112, true),
      ],
    });
    expect(alertsStore.getState().journal).toHaveLength(2);
  });

  it("l'arrêt du runtime coupe l'abonnement : plus aucune évaluation ensuite", () => {
    const maintenant = Date.now();
    alertsStore.setState({ defs: [DEF], journal: [] });
    marketStore.setState({
      candles: [bougie(maintenant - 180_000, 100, true), bougie(maintenant - 120_000, 100, true)],
    });
    stop = demarrerAlertes();
    stop();
    stop = null;
    marketStore.setState({
      candles: [
        bougie(maintenant - 180_000, 100, true),
        bougie(maintenant - 120_000, 100, true),
        bougie(maintenant - 60_000, 110, true),
      ],
    });
    expect(alertsStore.getState().journal).toHaveLength(0); // désabonné : rien n'est évalué
  });
});

describe("filtrage des defs de bougie par timeframe", () => {
  /** Trois bougies clôturées 100 / 100 / 110 (variation +10 % > seuil 5 %). */
  function pousserHausse(t0: number): void {
    marketStore.setState({
      candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true), bougie(t0 + 120_000, 110, true)],
    });
  }

  it("ignore une def dont le timeframe diffère du TF courant du chart", () => {
    const t0 = Date.now() - 180_000;
    alertsStore.setState({ defs: [{ ...DEF, timeframe: "1h" }], journal: [] });
    marketStore.setState({
      symbol: "BTCUSDT",
      timeframe: "1m",
      candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true)],
    });
    stop = demarrerAlertes();
    pousserHausse(t0);
    expect(alertsStore.getState().journal).toHaveLength(0);
    // Jamais évaluée → pas même calibrée (l'armement reste indéterminé).
    expect(alertsStore.getState().defs[0]?.arme).toBeUndefined();
  });

  it("réinitialise le suivi de clôture au changement de TF (la def du nouveau TF calibre)", () => {
    const maintenant = Date.now();
    alertsStore.setState({ defs: [{ ...DEF, timeframe: "1h" }], journal: [] });
    // Chart sur 1m : la def 1h n'est pas évaluée, mais le suivi de clôture avance
    // jusqu'à une bougie 1m RÉCENTE.
    marketStore.setState({
      symbol: "BTCUSDT",
      timeframe: "1m",
      candles: [bougie(maintenant - 120_000, 100, true), bougie(maintenant - 60_000, 100, true)],
    });
    stop = demarrerAlertes();
    // Bascule sur 1h : les clôtures 1h sont PLUS ANCIENNES que la dernière 1m déjà vue —
    // sans réinitialisation, la def resterait muette jusqu'à la prochaine clôture horaire.
    const t0 = maintenant - 4 * 3_600_000;
    marketStore.setState({
      timeframe: "1h",
      candles: [bougie(t0, 100, true), bougie(t0 + 3_600_000, 100, true)],
    });
    expect(alertsStore.getState().defs[0]?.arme).toBe(true);
  });

  it("évalue une def dont le timeframe est celui du chart", () => {
    const t0 = Date.now() - 180_000;
    alertsStore.setState({ defs: [{ ...DEF, timeframe: "1m" }], journal: [] });
    marketStore.setState({
      symbol: "BTCUSDT",
      timeframe: "1m",
      candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true)],
    });
    stop = demarrerAlertes();
    pousserHausse(t0);
    expect(alertsStore.getState().journal).toHaveLength(1);
  });
});

describe("pipeline CVD : demande d'alerte transitoire", () => {
  const DEF_CVD: AlertDef = {
    id: "cvd1",
    symbol: "BTCUSDT",
    source: "binance",
    condition: { type: "cvd-spot-perp-div", kind: "les-deux" },
    actif: true,
    declenchements: [],
  };

  it("une alerte demande le flux sans modifier les deux préférences utilisateur ; le journal ne les modifie pas", () => {
    alertsStore.setState({ defs: [DEF_CVD], journal: [] });
    stop = demarrerAlertes();
    expect(orderflowStore.getState()).toMatchObject({ enabled: false, cvdSpotPerp: false, alerteCvdDemandee: true });

    // Le journal et l'armement ne changent ni la demande ni l'intention UI.
    alertsStore.getState().ajouterJournal({ alertId: "autre", ts: Date.now(), valeur: 1, message: "m" });
    alertsStore.getState().appliquerMisesAJour([{ ...DEF_CVD, arme: false }]);
    expect(orderflowStore.getState()).toMatchObject({ enabled: false, cvdSpotPerp: false, alerteCvdDemandee: true });
  });

  it("une seule des deux alertes expirée conserve la demande, le dernier retrait la libère", () => {
    const now = Date.UTC(2026, 8, 23, 12);
    vi.spyOn(Date, "now").mockReturnValue(now);
    alertsStore.setState({ defs: [{ ...DEF_CVD, expireTs: now + 1_000 }, { ...DEF_CVD, id: "cvd2", expireTs: now + 2_000 }], journal: [] });
    stop = demarrerAlertes();
    expect(orderflowStore.getState().alerteCvdDemandee).toBe(true);
    alertsStore.setState({ defs: [{ ...DEF_CVD, expireTs: now }, { ...DEF_CVD, id: "cvd2", expireTs: now + 2_000 }] });
    expect(orderflowStore.getState().alerteCvdDemandee).toBe(true);
    alertsStore.setState({ defs: [{ ...DEF_CVD, expireTs: now }, { ...DEF_CVD, id: "cvd2", expireTs: now }] });
    expect(orderflowStore.getState()).toMatchObject({ enabled: false, cvdSpotPerp: false, alerteCvdDemandee: false });
  });

  it("la préférence utilisateur peut être désactivée pendant l'alerte et reste désactivée à l'arrêt", () => {
    orderflowStore.setState({ enabled: true, cvdSpotPerp: true });
    alertsStore.setState({ defs: [DEF_CVD], journal: [] });
    stop = demarrerAlertes();
    orderflowStore.getState().setEnabled(false);
    orderflowStore.getState().setCvdSpotPerp(false);
    expect(orderflowStore.getState().alerteCvdDemandee).toBe(true);
    stop(); stop = null;
    expect(orderflowStore.getState()).toMatchObject({ enabled: false, cvdSpotPerp: false, alerteCvdDemandee: false });
  });

  it("libère sans tick la dernière demande à l'échéance exacte", async () => {
    const now = Date.UTC(2026, 8, 23, 12);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    alertsStore.setState({ defs: [{ ...DEF_CVD, expireTs: now + 1_000 }], journal: [] });
    stop = demarrerAlertes();
    expect(orderflowStore.getState().alerteCvdDemandee).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(orderflowStore.getState().alerteCvdDemandee).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(orderflowStore.getState().alerteCvdDemandee).toBe(false);
  });
});

describe("acquisitions asynchrones et échéance", () => {
  it("arrête le funding après le repli différé sans demander l'historique", async () => {
    const now = Date.UTC(2026, 8, 23, 12);
    const horloge = vi.spyOn(Date, "now").mockReturnValue(now);
    let liberer!: (value: { rate: number }) => void;
    coinalyzeFundingMock.mockImplementationOnce(() => new Promise((resolve) => { liberer = resolve; }));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    daemonSupporteMock.mockReturnValue(true);
    detectDaemonMock.mockResolvedValue(true);
    alertsStore.setState({ defs: [{
      id: "funding-repli", symbol: "BTCUSDT", source: "binance",
      condition: { type: "funding-extreme", seuilAbs: 0.001, sens: "long-crowded" },
      actif: true, arme: true, declenchements: [], expireTs: now + 1_000,
    }], journal: [] });
    stop = demarrerAlertes();
    await vi.waitFor(() => expect(coinalyzeFundingMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/heartbeat"))).toBe(true));
    horloge.mockReturnValue(now + 1_000);
    liberer({ rate: 0.002 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const chemins = fetchMock.mock.calls.map(([url]) => {
      const parsed = new URL(String(url), "http://test.invalid");
      return `${parsed.host}${parsed.pathname}`;
    });
    const appelsFunding = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) =>
      url.includes("fapi/v1/premiumIndex") || url.includes("fapi/v1/fundingRate"));
    expect(appelsFunding, `Appels sans query : ${JSON.stringify(chemins)}`).toEqual([
      expect.stringContaining("premiumIndex?symbol=BTCUSDT"),
    ]);
    expect(coinalyzeFundingMock).toHaveBeenCalledTimes(1);
    expect(coinalyzeHistoryMock).not.toHaveBeenCalled();
    expect(alertsStore.getState().journal).toHaveLength(0);
  });

  it("ne lance aucun nouvel I/O funding après retrait des deux symboles pendant premiumIndex BTC", async () => {
    const now = Date.UTC(2026, 8, 23, 12);
    const horloge = vi.spyOn(Date, "now").mockReturnValue(now);
    let liberer!: (res: Response) => void;
    const premier = new Promise<Response>((resolve) => { liberer = resolve; });
    const appels: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const u = String(url);
      appels.push(u);
      return u.includes("premiumIndex") && u.includes("BTCUSDT") ? premier
        : Promise.resolve(u.includes("premiumIndex") ? Response.json({ lastFundingRate: "0.002" }) : Response.json([]));
    }));
    const def = (id: string, symbol: string): AlertDef => ({
      id, symbol, source: "binance", condition: { type: "funding-extreme", seuilAbs: 0.001, sens: "long-crowded" },
      actif: true, arme: true, declenchements: [], expireTs: now + 1_000,
    });
    alertsStore.setState({ defs: [def("btc", "BTCUSDT"), def("eth", "ETHUSDT")], journal: [] });
    stop = demarrerAlertes();
    expect(appels).toHaveLength(1);
    expect(appels[0]).toContain("BTCUSDT");
    horloge.mockReturnValue(now + 1_000);
    alertsStore.setState({ defs: [] });
    liberer(Response.json({ lastFundingRate: "0.002" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(appels).toHaveLength(1);
    expect(coinalyzeFundingMock).not.toHaveBeenCalled();
    expect(coinalyzeHistoryMock).not.toHaveBeenCalled();
    expect(alertsStore.getState().journal).toHaveLength(0);
  });

  it("journalise mais ne notifie pas si un abonné fait franchir l'échéance avant notifier", () => {
    const now = Date.UTC(2026, 8, 23, 12);
    const horloge = vi.spyOn(Date, "now").mockReturnValue(now);
    const NotificationMock = vi.fn();
    Object.defineProperty(NotificationMock, "permission", { value: "granted" });
    vi.stubGlobal("Notification", NotificationMock);
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    alertsStore.setState({ defs: [{
      id: "prix-course", symbol: "BTCUSDT", source: "binance",
      condition: { type: "prix-croise", niveau: 105, sens: "hausse" },
      actif: true, arme: true, declenchements: [], expireTs: now + 1_000,
    }], journal: [] });
    stop = demarrerAlertes();
    const onTick = subscribeTickersMock.mock.calls.find((args) => (args[2] as { source?: string })?.source === "binance")?.[1] as
      (u: { symbol: string; price: number; changePercent: number }) => void;
    onTick({ symbol: "BTCUSDT", price: 100, changePercent: 0 });
    const arreterJournal = alertsStore.subscribe((state, precedent) => {
      if (state.journal.length > precedent.journal.length) horloge.mockReturnValue(now + 1_000);
    });
    try {
      onTick({ symbol: "BTCUSDT", price: 110, changePercent: 10 });
      expect(alertsStore.getState().journal).toHaveLength(1);
      expect(NotificationMock).not.toHaveBeenCalled();
    } finally { arreterJournal(); }
  });

  it("un funding commencé avant expiration ne déclenche pas après prolongation du même ID", async () => {
    const now = Date.UTC(2026, 8, 23, 12);
    const horloge = vi.spyOn(Date, "now").mockReturnValue(now);
    let liberer!: (res: Response) => void;
    const premium = new Promise<Response>((resolve) => { liberer = resolve; });
    const fetchMock = vi.fn((url: string) => String(url).includes("premiumIndex")
      ? premium : Promise.resolve(Response.json([])));
    vi.stubGlobal("fetch", fetchMock);
    alertsStore.setState({ defs: [{
      id: "funding-course", symbol: "BTCUSDT", source: "binance",
      condition: { type: "funding-extreme", seuilAbs: 0.001, sens: "long-crowded" },
      actif: true, arme: true, declenchements: [], expireTs: now + 1_000,
    }], journal: [] });
    stop = demarrerAlertes();
    expect(fetchMock).toHaveBeenCalled();
    horloge.mockReturnValue(now + 1_000);
    expect(alertsStore.getState().prolonger("funding-course", now + 3_600_000)).toBe(true);
    liberer(Response.json({ lastFundingRate: "0.002" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(alertsStore.getState().journal).toHaveLength(0);
  });

  it("un chargement on-chain ancien est ignoré après expiration puis prolongation", async () => {
    const now = Date.UTC(2026, 8, 23, 12);
    const horloge = vi.spyOn(Date, "now").mockReturnValue(now);
    let libererAncien!: (valeur: { "mvrv-z": number }) => void;
    let libererNouveau!: (valeur: { "mvrv-z": number }) => void;
    const ancien = new Promise<{ "mvrv-z": number }>((resolve) => { libererAncien = resolve; });
    const nouveau = new Promise<{ "mvrv-z": number }>((resolve) => { libererNouveau = resolve; });
    chargerOnchainMock.mockImplementationOnce(() => ancien).mockImplementationOnce(() => nouveau);
    alertsStore.setState({ defs: [{
      id: "onchain-course", symbol: "BTCUSDT", source: "binance",
      condition: { type: "onchain-seuil", metrique: "mvrv-z", comparateur: ">=", valeur: 7 },
      actif: true, arme: true, declenchements: [], expireTs: now + 1_000,
    }], journal: [] });
    stop = demarrerAlertes();
    await vi.waitFor(() => expect(chargerOnchainMock).toHaveBeenCalledTimes(1));
    horloge.mockReturnValue(now + 1_000);
    expect(alertsStore.getState().prolonger("onchain-course", now + 3_600_000)).toBe(true);
    await vi.waitFor(() => expect(chargerOnchainMock).toHaveBeenCalledTimes(2));
    libererAncien({ "mvrv-z": 10 });
    await Promise.resolve();
    expect(alertsStore.getState().journal).toHaveLength(0);
    libererNouveau({ "mvrv-z": 10 });
    await vi.waitFor(() => expect(alertsStore.getState().journal.map((d) => d.alertId)).toEqual(["onchain-course"]));
  });
});

describe("alertes de preset : pas de garde de visibilité, état de scan observable", () => {
  const ALERTE: AlertePreset = {
    id: "p1",
    presetId: "preset-1",
    nom: "Momentum",
    tf: "1h",
    baseConditions: [],
    indicatorConditions: [],
    periodeMin: 15,
    actif: true,
    creeTs: 1,
  };

  it("revérifie chaque notification après le journal quand l'échéance tombe dans le lot", async () => {
    const now = Date.UTC(2026, 8, 23, 12);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const NotificationMock = vi.fn();
    Object.defineProperty(NotificationMock, "permission", { value: "granted" });
    vi.stubGlobal("Notification", NotificationMock);
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    executerScreenerMock.mockResolvedValueOnce({ rows: [], notes: [] }).mockResolvedValueOnce({ rows: [{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }], notes: [] });
    presetAlertsStore.setState({ alertes: [{ ...ALERTE, expireTs: now + 2 * 3_600_000 }] });
    const arreterJournal = alertsStore.subscribe((state, precedent) => {
      if (state.journal.length > precedent.journal.length) vi.setSystemTime(now + 2 * 3_600_000);
    });
    try {
      stop = demarrerAlertes();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(alertsStore.getState().journal).toHaveLength(1);
      expect(NotificationMock).not.toHaveBeenCalled();
    } finally { arreterJournal(); }
  });

  it("l'ancien rejet après expiration puis prolongation ne touche ni le nouveau scan ni son verrou", async () => {
    const now = Date.UTC(2026, 8, 23, 12);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let rejeterAncien!: (raison: Error) => void;
    let resoudreNouveau!: (valeur: { rows: Array<{ symbol: string }>; notes: string[] }) => void;
    const ancien = new Promise<{ rows: Array<{ symbol: string }>; notes: string[] }>((_resolve, reject) => { rejeterAncien = reject; });
    const nouveau = new Promise<{ rows: Array<{ symbol: string }>; notes: string[] }>((resolve) => { resoudreNouveau = resolve; });
    executerScreenerMock.mockImplementationOnce(() => ancien).mockImplementationOnce(() => nouveau);
    presetAlertsStore.setState({ alertes: [{ ...ALERTE, expireTs: now + 1_000 }] });
    stop = demarrerAlertes();
    await vi.advanceTimersByTimeAsync(0); // import() du pipeline, puis premier scan
    expect(executerScreenerMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(presetAlertsStore.getState().prolonger("p1", now + 2 * 3_600_000)).toBe("ok");
    await vi.advanceTimersByTimeAsync(0);
    expect(executerScreenerMock).toHaveBeenCalledTimes(2);
    rejeterAncien(new Error("ancien réseau"));
    await Promise.resolve();
    expect(presetAlertsStore.getState().alertes[0]?.derniereErreur).toBeUndefined();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(executerScreenerMock).toHaveBeenCalledTimes(2);
    resoudreNouveau({ rows: [], notes: [] });
    await Promise.resolve();
    expect(presetAlertsStore.getState().alertes[0]?.derniereErreur).toBeUndefined();
  });

  it("scanne même onglet caché et publie l'horodatage du scan", async () => {
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "hidden" }));
    presetAlertsStore.setState({ alertes: [ALERTE] });
    stop = demarrerAlertes();
    await vi.waitFor(() => expect(executerScreenerMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      expect(presetAlertsStore.getState().alertes[0]?.dernierScanTs).toBeGreaterThan(0);
    });
    expect(presetAlertsStore.getState().alertes[0]?.derniereErreur).toBeUndefined();
  });

  it("publie l'erreur d'un scan qui échoue (au lieu de l'avaler)", async () => {
    executerScreenerMock.mockRejectedValue(new Error("réseau HS"));
    presetAlertsStore.setState({ alertes: [ALERTE] });
    stop = demarrerAlertes();
    await vi.waitFor(() => {
      expect(presetAlertsStore.getState().alertes[0]?.derniereErreur).toContain("réseau HS");
    });
    expect(presetAlertsStore.getState().alertes[0]?.dernierScanTs).toBeGreaterThan(0);
  });

  it("transmet la référence figée dans l'alerte, et seulement elle", async () => {
    presetAlertsStore.setState({ alertes: [{ ...ALERTE, refSymbol: "ETHUSDT" }, { ...ALERTE, id: "p2" }] });
    stop = demarrerAlertes();
    await vi.waitFor(() => expect(executerScreenerMock).toHaveBeenCalledTimes(2));
    const options = executerScreenerMock.mock.calls.map((appel) => appel[3] as { refSymbol?: string });
    expect(options[0]?.refSymbol).toBe("ETHUSDT");
    // Alerte antérieure, sans référence figée : le run lit celle du graphe.
    expect(options[1]).not.toHaveProperty("refSymbol");
  });

  it("référence non évaluée : échec publié, baseline gardée, pas d'entrée en masse à son retour", async () => {
    const now = Date.UTC(2026, 10, 7, 12);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    executerScreenerMock
      .mockResolvedValueOnce({ rows: [{ symbol: "AAAUSDT" }], notes: [] })
      .mockResolvedValueOnce({ rows: [], notes: ["référence BTCUSDT 1h indisponible : force relative non évaluée"] })
      .mockResolvedValueOnce({ rows: [{ symbol: "AAAUSDT" }, { symbol: "BBBUSDT" }], notes: [] });
    presetAlertsStore.setState({ alertes: [ALERTE] });
    stop = demarrerAlertes();
    await vi.advanceTimersByTimeAsync(0);
    expect(presetAlertsStore.getState().alertes[0]?.derniereErreur).toBeUndefined();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(presetAlertsStore.getState().alertes[0]?.derniereErreur).toBe("référence BTCUSDT 1h indisponible : force relative non évaluée");
    expect(alertsStore.getState().journal).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(presetAlertsStore.getState().alertes[0]?.derniereErreur).toBeUndefined();
    // Seul BBB entre : AAA était déjà dans l'ensemble avant la panne de la référence.
    expect(alertsStore.getState().journal.map((d) => d.message)).toEqual(["EQS Momentum : BBBUSDT entre dans le scan"]);
  });

  it("symboles non mesurés : scan compté, couverture incomplète publiée puis effacée", async () => {
    const now = Date.UTC(2026, 10, 7, 12);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const note = "3 symboles non mesurés pour « rsZ(50) > -100 » (historique ou volume taker insuffisant) : écartés sans évaluation";
    executerScreenerMock
      .mockResolvedValueOnce({ rows: [], notes: ["funding indisponible", note, "0 résultats"] })
      .mockResolvedValueOnce({ rows: [], notes: ["0 résultats"] });
    presetAlertsStore.setState({ alertes: [ALERTE] });
    stop = demarrerAlertes();
    await vi.advanceTimersByTimeAsync(0);
    const alerte = presetAlertsStore.getState().alertes[0];
    expect(alerte?.derniereErreur).toBeUndefined();
    expect(alerte?.avertissement).toBe(note);
    expect(alerte?.dernierScanTs).toBe(now);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(presetAlertsStore.getState().alertes[0]?.avertissement).toBeUndefined();
  });
});

describe("référence du garde-fou de régime dans les alertes web (10 octobre 2026)", () => {
  const maintenant = Date.now();
  const cloturees = (n: number) => Array.from({ length: n }, (_v, i) => bougie(maintenant - (n - i) * 60_000, 100 + i, true));
  // Modifié à dessein le 12 novembre 2026 : ces quatre tests évaluaient une alerte AXIS sur
  // 3 bougies. Une alerte n'est plus évaluée sous l'amorce de son indicateur (AXIS : 1 500
  // bougies) ; le tampon synthétique en compte donc 1 500, puis 1 501 à la nouvelle clôture.
  const AMORCE_AXIS = 1500;
  const axisDef: AlertDef = {
    id: "axis-regime",
    symbol: "BTCUSDT",
    source: "binance",
    condition: { type: "indicateur-seuil", indicateurId: "stratAxis", params: {}, output: "etat", comparateur: ">=", valeur: 1 },
    actif: true,
    declenchements: [],
  };
  const rsiDef: AlertDef = {
    ...axisDef,
    id: "rsi",
    condition: { type: "indicateur-seuil", indicateurId: "rsi", params: {}, output: "rsi", comparateur: ">", valeur: 70 },
  };

  it("une alerte AXIS demande la référence ; l'évaluation reçoit ctx.aux.refClose aligné", () => {
    const ref = Array(60).fill(42);
    getAlignedMock.mockReturnValue({ status: "ready", aux: { refClose: ref } });
    alertsStore.setState({ defs: [axisDef], journal: [] });
    marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m", candles: cloturees(AMORCE_AXIS) });
    stop = demarrerAlertes();
    getAlignedMock.mockClear();
    // Nouvelle clôture POSTÉRIEURE : évaluation avec la référence alignée par le provider.
    marketStore.setState({ candles: [...cloturees(AMORCE_AXIS), bougie(maintenant, 103, true)] });
    expect(getAlignedMock).toHaveBeenCalled();
    const reqDernier = getAlignedMock.mock.calls.at(-1)![0] as { ids: string[]; candleTimes: number[] };
    expect(reqDernier.ids).toEqual(["refClose"]);
    expect(reqDernier.candleTimes.length).toBe(AMORCE_AXIS + 1);
    expect(auxRecus.at(-1)).toEqual({ refClose: ref });
  });

  it("une alerte RSI ne demande pas la référence", () => {
    alertsStore.setState({ defs: [rsiDef], journal: [] });
    marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m", candles: cloturees(AMORCE_AXIS) });
    stop = demarrerAlertes();
    getAlignedMock.mockClear();
    marketStore.setState({ candles: [...cloturees(AMORCE_AXIS), bougie(maintenant, 103, true)] });
    expect(getAlignedMock).not.toHaveBeenCalled();
    // L'alerte RSI est bien évaluée à cette clôture : l'absence de demande n'est pas une absence d'évaluation.
    expect(lotsEvalues.at(-1)).toEqual(["rsi"]);
  });

  it("référence en échec → évaluation sans aux (condition de la v2)", () => {
    getAlignedMock.mockReturnValue({ status: "error", message: "réseau" });
    alertsStore.setState({ defs: [axisDef], journal: [] });
    marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m", candles: cloturees(AMORCE_AXIS) });
    stop = demarrerAlertes();
    auxRecus.length = 0;
    lotsEvalues.length = 0;
    marketStore.setState({ candles: [...cloturees(AMORCE_AXIS), bougie(maintenant, 103, true)] });
    // Une évaluation a bien eu lieu, et elle n'a reçu aucune série auxiliaire.
    expect(lotsEvalues).toEqual([["axis-regime"]]);
    expect(auxRecus).toEqual([undefined]);
  });

  it("référence en vol → une seule évaluation, à l'arrivée de la série", () => {
    let onReady: (() => void) | undefined;
    const ref = Array(60).fill(7);
    getAlignedMock.mockImplementation((_req: unknown, cb: () => void) => {
      onReady = cb;
      return { status: "pending" };
    });
    alertsStore.setState({ defs: [axisDef], journal: [] });
    marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m", candles: cloturees(AMORCE_AXIS) });
    stop = demarrerAlertes();
    auxRecus.length = 0;
    marketStore.setState({ candles: [...cloturees(AMORCE_AXIS), bougie(maintenant, 103, true)] });
    expect(auxRecus).toHaveLength(0); // pas d'évaluation avant la référence
    getAlignedMock.mockReturnValue({ status: "ready", aux: { refClose: ref } });
    onReady!();
    expect(auxRecus).toEqual([{ refClose: ref }]);
  });

  describe("course de la référence en vol : les defs sont relues à son retour", () => {
    /** Démarre sur 1 500 bougies, référence en vol ; rend le rappel à invoquer quand elle « arrive ». */
    function demarrerReferenceEnVol(def: AlertDef): () => void {
      let onReady: (() => void) | undefined;
      getAlignedMock.mockImplementation((_req: unknown, cb: () => void) => {
        onReady = cb;
        return { status: "pending" };
      });
      alertsStore.setState({ defs: [def], journal: [] });
      marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m", candles: cloturees(AMORCE_AXIS) });
      stop = demarrerAlertes();
      expect(onReady).toBeDefined();
      expect(alertsStore.getState().defs[0]?.arme).toBeUndefined(); // en attente de la référence
      return () => {
        getAlignedMock.mockReturnValue({ status: "ready", aux: { refClose: Array(60).fill(7) } });
        onReady!();
      };
    }

    it("une pause posée pendant l'attente n'est pas annulée, et la def en pause n'est pas calibrée", () => {
      const arrivee = demarrerReferenceEnVol(axisDef);
      alertsStore.getState().basculerActif("axis-regime");
      expect(alertsStore.getState().defs[0]?.actif).toBe(false);
      arrivee();
      // Avant la correction : le lot capturé (actif) était évalué puis réécrit dans le registre.
      expect(alertsStore.getState().defs[0]?.actif).toBe(false);
      expect(alertsStore.getState().defs[0]?.arme).toBeUndefined();
    });

    it("une prolongation posée pendant l'attente est gardée, et la def est calibrée", () => {
      const echeance = Date.now() + 3_600_000;
      const arrivee = demarrerReferenceEnVol({ ...axisDef, expireTs: echeance });
      expect(alertsStore.getState().prolonger("axis-regime", echeance + 24 * 3_600_000)).toBe(true);
      arrivee();
      expect(alertsStore.getState().defs[0]?.expireTs).toBe(echeance + 24 * 3_600_000);
      expect(alertsStore.getState().defs[0]?.arme).toBeDefined();
    });

    it("une def supprimée pendant l'attente n'est ni évaluée ni ressuscitée", () => {
      const arrivee = demarrerReferenceEnVol(axisDef);
      alertsStore.getState().supprimer("axis-regime");
      lotsEvalues.length = 0;
      arrivee();
      expect(alertsStore.getState().defs).toEqual([]);
      expect(lotsEvalues).toEqual([]);
    });

    it("une def mise en pause pendant l'attente, puis réactivée dans la même bougie, est évaluée une fois sur cette clôture", () => {
      const arrivee = demarrerReferenceEnVol(axisDef);
      alertsStore.getState().basculerActif("axis-regime");
      arrivee();
      expect(alertsStore.getState().defs[0]?.arme).toBeUndefined();
      // Réactivée : la marque « évaluée pour cette clôture », posée à la demande de la référence,
      // a été levée à son retour — sans quoi la def attendrait la clôture suivante.
      lotsEvalues.length = 0;
      alertsStore.getState().basculerActif("axis-regime");
      expect(lotsEvalues).toEqual([["axis-regime"]]);
      expect(alertsStore.getState().defs[0]?.arme).toBeDefined();
      // Une fois : pause puis reprise encore, dans la même bougie, sans seconde évaluation.
      alertsStore.getState().basculerActif("axis-regime");
      alertsStore.getState().basculerActif("axis-regime");
      expect(lotsEvalues).toEqual([["axis-regime"]]);
    });
  });
});

describe("funding — séries sans marché perp (inertes, aucune requête)", () => {
  const funding = { type: "funding-extreme", seuilAbs: 0.001, sens: "long-crowded" } as const;
  const defFunding = (id: string, symbol: string, source: AlertDef["source"]): AlertDef => ({
    id, symbol, source, condition: funding, actif: true, declenchements: [],
  });
  /** Capteur réseau : URLs demandées, réponse vide (aucun taux exploitable). */
  function capterFetch(): string[] {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json({});
    }));
    return urls;
  }

  it("synthetic, twelvedata, composite et série saisie sur Binance : ni premiumIndex, ni Coinalyze, ni minuteur 60 s", async () => {
    vi.useFakeTimers();
    const urls = capterFetch();
    const armer = vi.spyOn(globalThis, "setInterval");
    alertsStore.setState({ defs: [
      defFunding("stable", "STABLE.D", "synthetic"),
      defFunding("total3", "TOTAL3", "synthetic"),
      defFunding("spy", "SPY", "twelvedata"),
      defFunding("eurusd", "EUR/USD", "twelvedata"),
      defFunding("saisie", "STABLE.D", "binance"),
      { id: "compose", symbol: "TOTAL2", source: "synthetic", actif: true, declenchements: [],
        condition: { type: "composite", conditions: [{ type: "prix-croise", niveau: 1, sens: "hausse" }, funding] } },
    ], journal: [] });
    stop = demarrerAlertes();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(urls.filter((url) => url.includes("premiumIndex") || url.includes("fundingRate"))).toEqual([]);
    expect(coinalyzeFundingMock).not.toHaveBeenCalled();
    expect(coinalyzeHistoryMock).not.toHaveBeenCalled();
    expect(armer.mock.calls.some(([, ms]) => ms === 60_000)).toBe(false);
  });

  it("témoin : les vrais perps restent sondés, y compris ceux que basePerp rejette ou cotés en USD1/U", async () => {
    const urls = capterFetch();
    const armer = vi.spyOn(globalThis, "setInterval");
    alertsStore.setState({ defs: [
      defFunding("btc", "BTCUSDT", "binance"),
      defFunding("s", "SUSDT", "bybit"),
      defFunding("hype", "HYPE-PERP", "hyperliquid"),
      defFunding("brocoli", "BROCCOLI714USDT", "binance"),
      defFunding("btcusd1", "BTCUSD1", "binance"),
      defFunding("btcu", "BTCU", "binance"),
      defFunding("stable", "STABLE.D", "synthetic"),
    ], journal: [] });
    stop = demarrerAlertes();
    await vi.waitFor(() => expect(coinalyzeFundingMock).toHaveBeenCalledTimes(6));
    const sondes = urls.filter((url) => url.includes("premiumIndex")).map((url) => url.slice(url.indexOf("symbol=") + 7));
    expect(sondes).toEqual(["BTCUSDT", "SUSDT", "HYPE-PERP", "BROCCOLI714USDT", "BTCUSD1", "BTCU"]);
    expect(armer.mock.calls.some(([, ms]) => ms === 60_000)).toBe(true);
  });

  it("un perp saisi sur un graphe série ou Twelve Data vise son marché : sondé, comme à c2f757d", async () => {
    const urls = capterFetch();
    alertsStore.setState({ defs: [
      // En tête : un ticker libre resté sur Twelve Data serait sondé avant les deux perps.
      defFunding("ibm-sur-td", "IBM", "twelvedata"),
      defFunding("btc-sur-serie", "BTCUSDT", "synthetic"),
      defFunding("sol-sur-td", "SOLUSDT", "twelvedata"),
    ], journal: [] });
    stop = demarrerAlertes();
    await vi.waitFor(() => expect(coinalyzeFundingMock).toHaveBeenCalledTimes(2));
    const sondes = urls.filter((url) => url.includes("premiumIndex")).map((url) => url.slice(url.indexOf("symbol=") + 7));
    expect(sondes).toEqual(["BTCUSDT", "SOLUSDT"]);
  });

  it("perps Binance cotés USD1 ou U saisis sur une série : sondés, comme à c2f757d ; un ticker libre sur Twelve Data reste inerte", async () => {
    const urls = capterFetch();
    alertsStore.setState({ defs: [
      defFunding("ibm-sur-td", "IBM", "twelvedata"),
      defFunding("btcusd1", "BTCUSD1", "synthetic"),
      defFunding("ethusd1", "ETHUSD1", "synthetic"),
      defFunding("spcxusd1", "SPCXUSD1", "synthetic"),
      defFunding("btcu", "BTCU", "synthetic"),
      defFunding("ethu", "ETHU", "synthetic"),
    ], journal: [] });
    stop = demarrerAlertes();
    await vi.waitFor(() => expect(coinalyzeFundingMock).toHaveBeenCalledTimes(5));
    const sondes = urls.filter((url) => url.includes("premiumIndex")).map((url) => url.slice(url.indexOf("symbol=") + 7));
    expect(sondes).toEqual(["BTCUSD1", "ETHUSD1", "SPCXUSD1", "BTCU", "ETHU"]);
  });

  it("une def perp retirée ne laisse que des defs inertes : le minuteur s'arrête", async () => {
    vi.useFakeTimers();
    const urls = capterFetch();
    alertsStore.setState({ defs: [defFunding("btc", "BTCUSDT", "binance"), defFunding("stable", "STABLE.D", "synthetic")], journal: [] });
    stop = demarrerAlertes();
    await vi.advanceTimersByTimeAsync(0);
    expect(urls.filter((url) => url.includes("premiumIndex"))).toHaveLength(1);
    const minuteursAvant = vi.getTimerCount();
    alertsStore.setState({ defs: [defFunding("stable", "STABLE.D", "synthetic")] });
    // Le minuteur 60 s lui-même est coupé : sans cela, pollFunding ne sonderait rien (filtre
    // fundingSondable) mais resterait armé.
    expect(vi.getTimerCount()).toBe(minuteursAvant - 1);
    urls.length = 0;
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(urls.filter((url) => url.includes("premiumIndex"))).toEqual([]);
  });
});

describe("paramètre « unité » refusé hors du graphe (SUG-1, phase 1)", () => {
  const maintenant = Date.now();
  /** 40 clôtures en hausse : RSI 14 défini (100), l'alerte se calibre à la première passe. */
  const hausse = (n: number) => Array.from({ length: n }, (_v, i) => bougie(maintenant - (n - i) * 60_000, 100 + i, true));
  const rsiDef: AlertDef = {
    id: "rsi-natif",
    symbol: "BTCUSDT",
    source: "binance",
    condition: { type: "indicateur-seuil", indicateurId: "rsi", params: { length: 14 }, output: "rsi", comparateur: ">", valeur: 70 },
    actif: true,
    declenchements: [],
  };
  const rsiUnite: AlertDef = {
    ...rsiDef,
    id: "rsi-4h",
    condition: { type: "indicateur-seuil", indicateurId: "rsi", params: { length: 14, unite: "4h" }, output: "rsi", comparateur: ">", valeur: 70 },
  };
  const compositeUnite: AlertDef = {
    ...rsiDef,
    id: "composite-1d",
    condition: {
      type: "composite",
      conditions: [
        { type: "variation-pct", fenetreMs: 60_000, seuilPct: -50 },
        { type: "indicateur-seuil", indicateurId: "ema", params: { length: 20, unite: "1d" }, output: "ema", comparateur: ">", valeur: 0 },
      ],
    },
  };

  it("une alerte importée avec une unité n'est jamais évaluée ; motif journalisé une seule fois", () => {
    const avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
    alertsStore.setState({ defs: [rsiDef, rsiUnite, compositeUnite], journal: [] });
    marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m", candles: hausse(40) });
    stop = demarrerAlertes();
    marketStore.setState({ candles: [...hausse(40), bougie(maintenant, 200, true)] });
    marketStore.setState({ candles: [...hausse(40), bougie(maintenant, 200, true), bougie(maintenant + 60_000, 210, true)] });

    const defs = alertsStore.getState().defs;
    expect(defs.find((d) => d.id === "rsi-natif")?.arme).toBeDefined(); // évaluée normalement
    expect(defs.find((d) => d.id === "rsi-4h")?.arme).toBeUndefined(); // jamais calibrée
    expect(defs.find((d) => d.id === "composite-1d")?.arme).toBeUndefined();
    expect(alertsStore.getState().journal.every((j) => j.alertId === "rsi-natif")).toBe(true);

    const motifs = avertir.mock.calls.map((args) => String(args[0])).filter((m) => m.includes("réservé au graphe"));
    expect(motifs).toEqual([
      "[AXIOM] alerte rsi-4h non évaluée : Paramètre « unité » [4h] réservé au graphe : l'alerte calculerait sur ses propres bougies, sans unité supérieure. Retire ce paramètre.",
      "[AXIOM] alerte composite-1d non évaluée : Paramètre « unité » [1d] réservé au graphe : l'alerte calculerait sur ses propres bougies, sans unité supérieure. Retire ce paramètre.",
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────
// Phase 2 d'AXIS (12 novembre 2026) : alertes visibles, jamais évaluées à la mauvaise profondeur.
// ───────────────────────────────────────────────────────────────────────────────────────────

/** `n` bougies d'une minute, closes, la dernière ouverte une minute avant `fin` ; clôtures 100 à 106. */
function serie(n: number, fin: number): Candle[] {
  return Array.from({ length: n }, (_v, i) => bougie(fin - (n - i) * 60_000, 100 + (i % 7), true));
}

/** Même série, dernière bougie encore en formation. */
function enFormation(candles: Candle[]): Candle[] {
  return [...candles.slice(0, -1), { ...candles[candles.length - 1]!, closed: false }];
}

function seuilIndicateur(id: string, indicateurId: string, output: string, comparateur: ">=" | "<=" | ">", valeur: number, extra: Partial<AlertDef> = {}): AlertDef {
  return {
    id, symbol: "BTCUSDT", source: "binance", timeframe: "1m", actif: true, declenchements: [],
    condition: { type: "indicateur-seuil", indicateurId, params: {}, output, comparateur, valeur },
    ...extra,
  };
}

describe("déclenchement visible : avis à l'écran, « Voir », notification (12 novembre 2026)", () => {
  const DEF_1M: AlertDef = { ...DEF, timeframe: "1m" };

  function stubNotification(permission: "granted" | "denied") {
    const Ctor = vi.fn();
    Object.defineProperty(Ctor, "permission", { value: permission });
    vi.stubGlobal("Notification", Ctor);
    return Ctor;
  }

  /** Deux clôtures à 100, runtime démarré, puis une clôture à 110 : `DEF_1M` (+5 % sur 1 min) déclenche. */
  function declencherVariation(defs: AlertDef[], t0: number): number {
    alertsStore.setState({ defs, journal: [] });
    marketStore.setState({ candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true)] });
    stop = demarrerAlertes();
    expect(toastsStore.getState().toasts).toEqual([]); // calibrage : aucun avis
    marketStore.setState({ candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true), bougie(t0 + 120_000, 110, true)] });
    return t0 + 120_000;
  }

  it("chaque déclenchement pousse un avis « SYMBOLE UNITÉ — message » avec « Voir », qui reste jusqu'au toucher", () => {
    vi.useFakeTimers();
    declencherVariation([DEF_1M], Date.now() - 180_000);
    const avis = toastsStore.getState().toasts;
    expect(avis.map((a) => a.texte)).toEqual(["BTCUSDT 1m — Variation +5% sur 1 min"]);
    expect(avis[0]?.action?.libelle).toBe("Voir");
    // Le journal garde le libellé seul : c'est l'hôte qui ajoute le marché.
    expect(alertsStore.getState().journal.map((d) => d.message)).toEqual(["Variation +5% sur 1 min"]);
    vi.advanceTimersByTime(60 * 60_000);
    expect(toastsStore.getState().toasts).toHaveLength(1);
  });

  it("« Voir » ramène la vue PRINCIPALE sur le marché et l'unité de l'alerte, et marque la bougie évaluée", async () => {
    chartLayoutStore.setState({ layout: "2x2", focus: 2 });
    let focusALaNavigation: number | undefined;
    navigateToMock.mockImplementationOnce(() => { focusALaNavigation = chartLayoutStore.getState().focus; });
    const tEvaluee = declencherVariation([DEF_1M], Date.now() - 180_000);
    toastsStore.getState().toasts[0]!.action!.executer();
    await vi.waitFor(() => expect(navigateToMock).toHaveBeenCalledTimes(1));
    // markTime : l'ouverture de la bougie évaluée, pas l'instant de l'évaluation.
    expect(navigateToMock).toHaveBeenCalledWith({ symbol: "BTCUSDT", exchange: "binance", timeframe: "1m", markTime: tEvaluee, source: "alerte" });
    expect(alertsStore.getState().journal[0]?.ts).not.toBe(tEvaluee);
    // La vue principale, pas la vue focalisée : le focus est revenu sur le slot 0 avant de naviguer.
    expect(focusALaNavigation).toBe(0);
  });

  it("alerte de prix sur le ticker : avis « SYMBOLE — message » sans unité, « Voir » marque l'instant du tick", async () => {
    const now = Date.UTC(2026, 10, 12, 9, 30);
    vi.spyOn(Date, "now").mockReturnValue(now);
    alertsStore.setState({ defs: [{
      id: "prix", symbol: "BTCUSDT", source: "binance", actif: true, declenchements: [],
      condition: { type: "prix-croise", niveau: 105, sens: "hausse" },
    }], journal: [] });
    stop = demarrerAlertes();
    const onTick = subscribeTickersMock.mock.calls.find((args) => (args[2] as { source?: string })?.source === "binance")?.[1] as
      (u: { symbol: string; price: number; changePercent: number }) => void;
    onTick({ symbol: "BTCUSDT", price: 100, changePercent: 0 });
    expect(toastsStore.getState().toasts).toEqual([]);
    onTick({ symbol: "BTCUSDT", price: 110, changePercent: 10 });
    const avis = toastsStore.getState().toasts;
    expect(avis.map((a) => a.texte)).toEqual(["BTCUSDT — Prix franchit 105 à la hausse"]);
    avis[0]!.action!.executer();
    await vi.waitFor(() => expect(navigateToMock).toHaveBeenCalledTimes(1));
    expect(navigateToMock).toHaveBeenCalledWith({ symbol: "BTCUSDT", exchange: "binance", markTime: now, source: "alerte" });
    expect(navigateToMock.mock.calls[0]![0]).not.toHaveProperty("timeframe");
    // Le même tick ne produit pas de second avis (alerte désarmée).
    onTick({ symbol: "BTCUSDT", price: 111, changePercent: 11 });
    expect(toastsStore.getState().toasts).toHaveLength(1);
  });

  it("notification du bureau titrée « AXIOM — SYMBOLE UNITÉ » ; onglet masqué : pas de notification, l'avis est poussé quand même", () => {
    const decl = { alertId: "a1", ts: 5, valeur: 1, message: "AXIS S/R non mesuré · réaction sur support fort" };
    const def = { symbol: "BTCUSDT", source: "binance" as const, timeframe: "4h" as const };
    const Ctor = stubNotification("granted");
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    notifier(decl, def, 3);
    expect(Ctor).toHaveBeenCalledTimes(1);
    expect(Ctor).toHaveBeenCalledWith("AXIOM — BTCUSDT 4h", { body: decl.message });
    expect(toastsStore.getState().toasts.map((a) => a.texte)).toEqual(["BTCUSDT 4h — AXIS S/R non mesuré · réaction sur support fort"]);

    Ctor.mockClear();
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "hidden" }));
    notifier(decl, def, 3);
    expect(Ctor).not.toHaveBeenCalled();
    expect(toastsStore.getState().toasts).toHaveLength(2);
  });

  it("permission refusée ou API absente : l'avis à l'écran est poussé quand même", () => {
    stubNotification("denied");
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    notifier({ alertId: "a1", ts: 1, valeur: 1, message: "x" }, { symbol: "ETHUSDT", source: "bybit", timeframe: undefined });
    vi.unstubAllGlobals();
    notifier({ alertId: "a1", ts: 1, valeur: 1, message: "y" }, { symbol: "ETHUSDT", source: "bybit", timeframe: "1h" });
    expect(toastsStore.getState().toasts.map((a) => a.texte)).toEqual(["ETHUSDT — x", "ETHUSDT 1h — y"]);
  });

  it("alerte baleines : avis « ACTIF — message » SANS « Voir », son symbole n'est pas un marché ; une alerte globale garde « Voir »", async () => {
    const decl = { alertId: "w1", ts: 7, valeur: 12_000_000, message: "Baleine ≥ 10M $ (toutes directions)" };
    // Convention de @axiom/alerts : une alerte baleines est portée par l'actif surveillé, source binance.
    notifier(decl, { symbol: "USDT", source: "binance", timeframe: undefined, condition: { type: "whale-flux", seuilUsd: 10_000_000, direction: "tous" } });
    const baleines = toastsStore.getState().toasts[0]!;
    // Le libellé ne nomme pas l'actif : le préfixe de l'hôte est le seul endroit où il se lit.
    expect(baleines.texte).toBe("USDT — Baleine ≥ 10M $ (toutes directions)");
    // « Voir » enverrait la vue principale sur « USDT », marché qui n'existe pas.
    expect(baleines.action).toBeUndefined();
    expect(baleines.reste).toBe(true);
    // Alerte de régime : globale, portée par BTCUSDT, qui est un marché.
    notifier({ alertId: "r1", ts: 8, valeur: -1, message: "régime ≤ −1" }, { symbol: "BTCUSDT", source: "binance", timeframe: undefined, condition: { type: "regime-seuil", comparateur: "<=", valeur: -1 } });
    const regime = toastsStore.getState().toasts[1]!;
    expect(regime.texte).toBe("BTCUSDT — régime ≤ −1");
    expect(regime.action?.libelle).toBe("Voir");
    regime.action!.executer();
    await vi.waitFor(() => expect(navigateToMock).toHaveBeenCalledTimes(1));
    expect(navigateToMock).toHaveBeenCalledWith({ symbol: "BTCUSDT", exchange: "binance", markTime: 8, source: "alerte" });
  });

  it("alerte de preset : avis du message seul, sans « Voir », qui reste aussi jusqu'au toucher", async () => {
    const now = Date.UTC(2026, 10, 12, 12);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    executerScreenerMock
      .mockResolvedValueOnce({ rows: [], notes: [] })
      .mockResolvedValueOnce({ rows: [{ symbol: "BBBUSDT" }], notes: [] });
    presetAlertsStore.setState({ alertes: [{
      id: "p1", presetId: "preset-1", nom: "Momentum", tf: "1h", baseConditions: [], indicatorConditions: [], periodeMin: 15, actif: true, creeTs: 1,
    }] });
    stop = demarrerAlertes();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    const avis = toastsStore.getState().toasts;
    expect(avis.map((a) => a.texte)).toEqual(["EQS Momentum : BBBUSDT entre dans le scan"]);
    expect(avis[0]?.action).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(toastsStore.getState().toasts).toHaveLength(1);
  });

  describe("rattrapage : le message dit quand la bougie évaluée a clôturé", () => {
    const H4 = 14_400_000;
    const ouverture = Date.UTC(2026, 9, 31, 16);
    const deux = (n: number): string => String(n).padStart(2, "0");
    /** « JJ/MM à HH:MM » en heure locale, écrit sans passer par les aides de format du produit. */
    const jourHeure = (t: number): string => {
      const d = new Date(t);
      return `${deux(d.getDate())}/${deux(d.getMonth() + 1)} à ${deux(d.getHours())}:${deux(d.getMinutes())}`;
    };

    it("clotureBougie : ouverture + durée ; secondes et 3m lus dans le nom ; mois calendaires UTC ; null pour une unité inconnue", () => {
      expect(clotureBougie(ouverture, "4h")).toBe(ouverture + H4);
      expect(clotureBougie(ouverture, "1m")).toBe(ouverture + 60_000);
      expect(clotureBougie(ouverture, "1w")).toBe(ouverture + 7 * 86_400_000);
      expect(clotureBougie(Date.UTC(2026, 1, 1), "1M")).toBe(Date.UTC(2026, 2, 1));
      expect(clotureBougie(Date.UTC(2026, 9, 1), "3M")).toBe(Date.UTC(2027, 0, 1));
      expect(clotureBougie(Date.UTC(2026, 0, 1), "12M")).toBe(Date.UTC(2027, 0, 1));
      // Unités à pas fixe hors de la table du backtest : leur durée est dans leur nom.
      expect(clotureBougie(ouverture, "1s")).toBe(ouverture + 1_000);
      expect(clotureBougie(ouverture, "5s")).toBe(ouverture + 5_000);
      expect(clotureBougie(ouverture, "15s")).toBe(ouverture + 15_000);
      expect(clotureBougie(ouverture, "3m")).toBe(ouverture + 180_000);
      // Toutes les unités du produit ont une clôture, strictement après l'ouverture.
      for (const unite of ["1s", "5s", "15s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "3d", "1w", "1M", "3M", "6M", "12M"] as const) {
        expect(clotureBougie(ouverture, unite), unite).toBeGreaterThan(ouverture);
      }
      // Unité inconnue (def importée, forme future) : jamais une heure inventée.
      for (const inconnue of ["2x", "", "m", "4H"]) expect(clotureBougie(ouverture, inconnue as Timeframe)).toBeNull();
    });

    it("règle : la bougie a clôturé depuis STRICTEMENT plus d'une durée de bougie", () => {
      const cloture = ouverture + H4;
      const mention = ` · bougie close le ${jourHeure(cloture)}`;
      // En direct, ou application ouverte dans la bougie qui suit : rien.
      expect(mentionRattrapage(ouverture, "4h", cloture)).toBe("");
      expect(mentionRattrapage(ouverture, "4h", cloture + 2_000)).toBe("");
      expect(mentionRattrapage(ouverture, "4h", cloture + H4 - 1)).toBe("");
      expect(mentionRattrapage(ouverture, "4h", cloture + H4)).toBe(""); // exactement une durée : pas un rattrapage
      // Une milliseconde de plus : rattrapage, heure de clôture écrite.
      expect(mentionRattrapage(ouverture, "4h", cloture + H4 + 1)).toBe(mention);
      expect(mentionRattrapage(ouverture, "4h", cloture + 9 * 3_600_000)).toBe(mention);
      // Horloge en retard sur la bougie (évaluée « avant » sa clôture) : rien.
      expect(mentionRattrapage(ouverture, "4h", ouverture + 1)).toBe("");
      // 3m et secondes : un rattrapage s'y dit comme ailleurs (avant : passé pour un déclenchement en direct).
      expect(mentionRattrapage(ouverture, "3m", ouverture + 180_000 + 180_000)).toBe("");
      expect(mentionRattrapage(ouverture, "3m", ouverture + 180_000 + 180_001)).toBe(` · bougie close le ${jourHeure(ouverture + 180_000)}`);
      expect(mentionRattrapage(ouverture, "15s", ouverture + 60_000)).toBe(` · bougie close le ${jourHeure(ouverture + 15_000)}`);
      // Unité inconnue : jamais une heure inventée.
      expect(mentionRattrapage(ouverture, "2x" as Timeframe, cloture + 30 * 86_400_000)).toBe("");
      // Mois calendaire : la clôture est le premier du mois suivant (UTC).
      expect(mentionRattrapage(Date.UTC(2026, 1, 1), "1M", Date.UTC(2026, 4, 1))).toBe(` · bougie close le ${jourHeure(Date.UTC(2026, 2, 1))}`);
    });

    /** Def armée, déjà vraie sur la dernière bougie close au démarrage : elle tire à l'ouverture (rattrapage voulu). */
    function ouvrirSurBougieClose(retardMs: number): number {
      const now = Date.UTC(2026, 9, 31, 12, 0, 0);
      vi.spyOn(Date, "now").mockReturnValue(now);
      const tEvaluee = now - retardMs - 60_000; // ouverte une minute avant sa clôture
      alertsStore.setState({ defs: [{ ...DEF_1M, arme: true }], journal: [] });
      marketStore.setState({ candles: [bougie(tEvaluee - 120_000, 100, true), bougie(tEvaluee - 60_000, 100, true), bougie(tEvaluee, 110, true)] });
      stop = demarrerAlertes();
      return tEvaluee;
    }

    it("retour sur un tampon resté en arrière : journal, avis et « Voir » désignent la bougie, heure de clôture écrite", async () => {
      const Ctor = stubNotification("granted");
      vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
      const tEvaluee = ouvrirSurBougieClose(150_000); // close depuis 2 min 30, pour une bougie d'une minute
      const suffixe = ` · bougie close le ${jourHeure(tEvaluee + 60_000)}`;
      expect(alertsStore.getState().journal.map((d) => d.message)).toEqual([`Variation +5% sur 1 min${suffixe}`]);
      expect(toastsStore.getState().toasts.map((a) => a.texte)).toEqual([`BTCUSDT 1m — Variation +5% sur 1 min${suffixe}`]);
      expect(Ctor).toHaveBeenCalledWith("AXIOM — BTCUSDT 1m", { body: `Variation +5% sur 1 min${suffixe}` });
      toastsStore.getState().toasts[0]!.action!.executer();
      await vi.waitFor(() => expect(navigateToMock).toHaveBeenCalledTimes(1));
      expect(navigateToMock.mock.calls[0]![0]).toMatchObject({ markTime: tEvaluee });
    });

    it("ouverture dans la bougie qui suit la clôture : aucun ajout au message", () => {
      ouvrirSurBougieClose(30_000);
      expect(alertsStore.getState().journal.map((d) => d.message)).toEqual(["Variation +5% sur 1 min"]);
      expect(toastsStore.getState().toasts.map((a) => a.texte)).toEqual(["BTCUSDT 1m — Variation +5% sur 1 min"]);
    });
  });
});

describe("évaluation juste : une fois par bougie close, jamais sous l'amorce (12 novembre 2026)", () => {
  const DEF_1M: AlertDef = { ...DEF, timeframe: "1m" };
  const AXIS_SR = seuilIndicateur("axis-sr", "stratAxisSr", "reactionSupport", ">=", 1);
  const AXIS = seuilIndicateur("axis", "stratAxis", "etat", ">=", 1);

  it("une def créée en cours de bougie est calibrée aussitôt, et la clôture suivante la déclenche", () => {
    const t0 = Date.now() - 180_000;
    const closes = [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true)];
    marketStore.setState({ candles: [...closes, bougie(t0 + 120_000, 100, false)] });
    stop = demarrerAlertes();
    expect(alertsStore.getState().ajouter({ symbol: "BTCUSDT", source: "binance", timeframe: "1m", condition: DEF.condition })).toBe(true);
    // Calibrée tout de suite sur la dernière bougie close (variation nulle : armée), sans tir.
    expect(alertsStore.getState().defs[0]?.arme).toBe(true);
    expect(alertsStore.getState().journal).toHaveLength(0);
    // Avant : cette clôture servait de calibrage, et son signal était perdu.
    marketStore.setState({ candles: [...closes, bougie(t0 + 120_000, 110, true)] });
    expect(alertsStore.getState().journal).toHaveLength(1);
    expect(toastsStore.getState().toasts).toHaveLength(1);
  });

  it("créée alors que la condition est déjà vraie : calibrée sans tirer, comme à la première évaluation", () => {
    const t0 = Date.now() - 180_000;
    marketStore.setState({ candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 110, true), bougie(t0 + 120_000, 110, false)] });
    stop = demarrerAlertes();
    alertsStore.getState().ajouter({ symbol: "BTCUSDT", source: "binance", timeframe: "1m", condition: DEF.condition });
    expect(alertsStore.getState().defs[0]?.arme).toBe(false);
    expect(alertsStore.getState().journal).toHaveLength(0);
    expect(toastsStore.getState().toasts).toHaveLength(0);
  });

  it("AXIS S/R : aucune évaluation sous 3 000 bougies, une seule quand le tampon les atteint, aucune ensuite pour la même clôture", () => {
    const complet = serie(3000, Date.now());
    alertsStore.setState({ defs: [AXIS_SR], journal: [] });
    marketStore.setState({ candles: complet.slice(-500) });
    stop = demarrerAlertes();
    for (const n of [1000, 1500, 2999]) marketStore.setState({ candles: complet.slice(-n) });
    expect(lotsEvalues).toEqual([]);
    expect(alertsStore.getState().defs[0]?.arme).toBeUndefined(); // ni calibrée, ni tirée
    // L'historique atteint l'amorce, sous la même dernière clôture : évaluation, une fois.
    marketStore.setState({ candles: complet });
    expect(lotsEvalues).toEqual([["axis-sr"]]);
    expect(alertsStore.getState().defs[0]?.arme).toBeDefined();
    // Ticks de la bougie en formation, puis une page d'historique de plus : rien pour cette clôture.
    const fin = complet[complet.length - 1]!.time;
    marketStore.setState({ candles: [...complet, bougie(fin + 60_000, 101, false)] });
    marketStore.setState({ candles: [...complet, bougie(fin + 60_000, 250, false)] });
    marketStore.setState({ candles: [bougie(complet[0]!.time - 60_000, 100, true), ...complet, bougie(fin + 60_000, 250, false)] });
    expect(lotsEvalues).toEqual([["axis-sr"]]);
    // La clôture suivante est évaluée, une fois.
    marketStore.setState({ candles: [...complet, bougie(fin + 60_000, 102, true)] });
    expect(lotsEvalues).toEqual([["axis-sr"], ["axis-sr"]]);
  });

  it("le décompte est celui du graphe, bougie en formation comprise : AXIS évaluée à 1 500 bougies dont 1 499 closes, pas à 1 499", () => {
    const complet = serie(1500, Date.now());
    alertsStore.setState({ defs: [AXIS], journal: [] });
    marketStore.setState({ candles: enFormation(complet.slice(-1499)) });
    stop = demarrerAlertes();
    expect(lotsEvalues).toEqual([]);
    expect(alertsStore.getState().defs[0]?.arme).toBeUndefined();
    // Le graphe arrête d'étendre l'historique à 1 500 bougies, la dernière encore en formation.
    marketStore.setState({ candles: enFormation(complet) });
    expect(lotsEvalues).toEqual([["axis"]]);
    expect(alertsStore.getState().defs[0]?.arme).toBeDefined();
  });

  it("aller-retour d'actif dans la même bougie : ni second tir, ni évaluation d'AXIS S/R sur le tampon court du retour", () => {
    const fin = Date.now() - 60_000;
    const base = serie(3000, fin).map((c) => ({ ...c, close: 100, open: 100, high: 100, low: 100 }));
    alertsStore.setState({ defs: [DEF_1M, { ...AXIS_SR, arme: true }], journal: [] });
    marketStore.setState({ candles: base });
    stop = demarrerAlertes();
    const avecCloture = [...base, bougie(fin, 110, true)];
    marketStore.setState({ candles: avecCloture });
    expect(alertsStore.getState().journal.map((d) => d.alertId)).toEqual(["a1"]);
    expect(lotsEvalues.at(-1)).toEqual(["a1", "axis-sr"]);
    lotsEvalues.length = 0;
    // Départ vers un autre actif, puis retour : le graphe recharge 500 bougies, même dernière clôture.
    marketStore.setState({ symbol: "ETHUSDT", candles: [] });
    marketStore.setState({ symbol: "BTCUSDT", candles: avecCloture.slice(-500) });
    // La variation est réévaluée au retour (déjà déclenchée : pas de second tir) ; AXIS S/R ne l'est pas.
    expect(lotsEvalues).toEqual([["a1"]]);
    expect(alertsStore.getState().journal).toHaveLength(1);
    expect(toastsStore.getState().toasts).toHaveLength(1);
    // L'historique revient : AXIS S/R est évaluée, une fois, à la bonne profondeur.
    marketStore.setState({ candles: avecCloture });
    expect(lotsEvalues).toEqual([["a1"], ["axis-sr"]]);
  });

  it("ré-entrance : l'écriture du résultat rappelle le suivi de clôture, sans seconde évaluation ni second tir", () => {
    const t0 = Date.now() - 180_000;
    alertsStore.setState({ defs: [DEF_1M, { ...DEF_1M, id: "a2" }], journal: [] });
    marketStore.setState({ candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true)] });
    stop = demarrerAlertes();
    expect(lotsEvalues).toEqual([["a1", "a2"]]);
    marketStore.setState({ candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true), bougie(t0 + 120_000, 110, true)] });
    // Une passe par clôture pour le lot entier, malgré l'abonnement aux définitions.
    expect(lotsEvalues).toEqual([["a1", "a2"], ["a1", "a2"]]);
    expect(alertsStore.getState().journal.map((d) => d.alertId).sort()).toEqual(["a1", "a2"]);
    expect(toastsStore.getState().toasts).toHaveLength(2);
  });

  it("référence en vol : la bougie est marquée dès la demande, un tick ne redemande ni ne réévalue", () => {
    getAlignedMock.mockImplementation(() => ({ status: "pending" }));
    const complet = serie(1500, Date.now());
    alertsStore.setState({ defs: [AXIS], journal: [] });
    marketStore.setState({ candles: complet });
    stop = demarrerAlertes();
    expect(getAlignedMock).toHaveBeenCalledTimes(1);
    const fin = complet[complet.length - 1]!.time;
    marketStore.setState({ candles: [...complet, bougie(fin + 60_000, 101, false)] });
    marketStore.setState({ candles: [...complet, bougie(fin + 60_000, 105, false)] });
    expect(getAlignedMock).toHaveBeenCalledTimes(1);
    expect(lotsEvalues).toEqual([]);
  });

  it("une def armée, en pause à l'arrivée de la clôture puis réactivée dans la bougie, est évaluée une fois sur cette clôture", () => {
    const t0 = Date.now() - 180_000;
    alertsStore.setState({ defs: [{ ...DEF_1M, arme: true, actif: false }], journal: [] });
    marketStore.setState({ candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true)] });
    stop = demarrerAlertes();
    marketStore.setState({ candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true), bougie(t0 + 120_000, 110, true)] });
    expect(alertsStore.getState().journal).toHaveLength(0);
    alertsStore.getState().basculerActif("a1");
    expect(alertsStore.getState().journal).toHaveLength(1);
    // Pause puis reprise dans la même bougie : déjà évaluée pour cette clôture.
    alertsStore.getState().basculerActif("a1");
    alertsStore.getState().basculerActif("a1");
    expect(alertsStore.getState().journal).toHaveLength(1);
    expect(lotsEvalues).toEqual([["a1"]]);
  });

  it("prix « les deux » sans route ticker, créé en cours de bougie : pas d'évaluation avant la clôture suivante", () => {
    const t0 = Date.now() - 240_000;
    const symbol = "binance:BTCUSDT|/|binance:ETHUSDT";
    const closes = [bougie(t0, 100, true), bougie(t0 + 60_000, 110, true)];
    marketStore.setState({ exchange: "synthetic", symbol, timeframe: "1m", candles: closes });
    stop = demarrerAlertes();
    // La dernière clôture a franchi 105 AVANT la création : ce franchissement n'est pas le sien.
    // (Écriture directe : `ajouter` met le symbole en capitales, ce qu'un ratio ne supporte pas.)
    alertsStore.setState({ defs: [{
      id: "ratio", symbol, source: "synthetic", actif: true, declenchements: [],
      condition: { type: "prix-croise", niveau: 105, sens: "les-deux" },
    }] });
    expect(lotsEvalues).toEqual([]);
    expect(alertsStore.getState().journal).toHaveLength(0);
    marketStore.setState({ candles: [...closes, bougie(t0 + 120_000, 111, true)] });
    expect(lotsEvalues).toHaveLength(1);
    expect(alertsStore.getState().journal).toHaveLength(0);
    marketStore.setState({ candles: [...closes, bougie(t0 + 120_000, 111, true), bougie(t0 + 180_000, 100, true)] });
    expect(alertsStore.getState().journal).toHaveLength(1);
  });

  describe("composite lisant AXIS", () => {
    const composite: AlertDef = {
      id: "composite-axis", symbol: "BTCUSDT", source: "binance", timeframe: "1m", actif: true, declenchements: [],
      condition: { type: "composite", conditions: [
        { type: "variation-pct", fenetreMs: 60_000, seuilPct: 5 },
        { type: "indicateur-seuil", indicateurId: "stratAxis", params: {}, output: "etat", comparateur: "<=", valeur: 0 },
      ] },
    };
    /** Composite sans amorce, sur le même marché : évalué dès la première passe, il consomme le frein. */
    const compositeRsi: AlertDef = {
      ...composite, id: "composite-rsi",
      condition: { type: "composite", conditions: [
        { type: "variation-pct", fenetreMs: 60_000, seuilPct: 5 },
        { type: "indicateur-seuil", indicateurId: "rsi", params: {}, output: "rsi", comparateur: ">", valeur: 0 },
      ] },
    };

    // Modifié à dessein à l'intégration (12 novembre 2026) : ce test épinglait « l'historique
    // arrive sous la même clôture : le composite attend la clôture suivante ». Fait de conditions
    // de bougie seules, rien ne l'évaluait alors à l'ouverture de l'application ni au retour sur
    // le marché, là où une alerte simple sur la même condition l'est (revue du lot).
    it("reste figé sous l'amorce, puis est évalué une fois quand elle arrive sous la même clôture", () => {
      const fin = Date.now() - 120_000;
      const complet = serie(1500, fin);
      const cloture1 = bougie(fin, 101, true);
      const cloture2 = bougie(fin + 60_000, 102, true);
      alertsStore.setState({ defs: [composite], journal: [] });
      marketStore.setState({ candles: complet.slice(-500) });
      stop = demarrerAlertes();
      marketStore.setState({ candles: [...complet.slice(-499), cloture1] });
      // 500 bougies : ni calibré, ni évalué (avant : calibré sur un AXIS calculé à 500 bougies).
      expect(lotsEvalues).toEqual([]);
      expect(alertsStore.getState().defs[0]?.arme).toBeUndefined();
      // Une page d'historique, encore sous l'amorce : toujours rien.
      marketStore.setState({ candles: [...complet.slice(-999), cloture1] });
      expect(lotsEvalues).toEqual([]);
      // L'amorce arrive sous la même clôture : évalué, une fois, à la bonne profondeur.
      marketStore.setState({ candles: [...complet, cloture1] });
      expect(lotsEvalues).toEqual([["composite-axis"]]);
      expect(alertsStore.getState().defs[0]?.arme).toBeDefined();
      // Ticks de la bougie en formation et page d'historique de plus : rien pour cette clôture.
      marketStore.setState({ candles: [...complet, cloture1, bougie(fin + 60_000, 250, false)] });
      marketStore.setState({ candles: [bougie(complet[0]!.time - 60_000, 100, true), ...complet, cloture1, bougie(fin + 60_000, 250, false)] });
      expect(lotsEvalues).toEqual([["composite-axis"]]);
      // Clôture suivante : il garde sa cadence.
      marketStore.setState({ candles: [...complet, cloture1, cloture2] });
      expect(lotsEvalues).toEqual([["composite-axis"], ["composite-axis"]]);
    });

    it("armé, vrai sur la dernière bougie close à l'ouverture : il tire à l'arrivée de l'amorce, une seule fois", () => {
      // Dernière clôture en hausse de 10 % sur une série plate : la variation est vraie, AXIS à plat (≤ 0).
      const fin = Date.now() - 60_000;
      const complet = [...serie(1499, fin).map((c) => ({ ...c, open: 100, high: 100, low: 100, close: 100 })), bougie(fin, 110, true)];
      alertsStore.setState({ defs: [{ ...composite, arme: true }], journal: [] });
      marketStore.setState({ candles: complet.slice(-500) });
      stop = demarrerAlertes();
      expect(alertsStore.getState().journal).toHaveLength(0);
      marketStore.setState({ candles: complet });
      expect(alertsStore.getState().journal.map((d) => d.alertId)).toEqual(["composite-axis"]);
      expect(toastsStore.getState().toasts).toHaveLength(1);
      // Une page de plus sous la même clôture : ni seconde évaluation, ni second tir.
      marketStore.setState({ candles: [bougie(complet[0]!.time - 60_000, 100, true), ...complet] });
      expect(lotsEvalues).toEqual([["composite-axis"]]);
      expect(alertsStore.getState().journal).toHaveLength(1);
    });

    it("le frein d'une seconde ne l'écarte pas, et les composites déjà évalués pour cette clôture ne le sont pas de nouveau", () => {
      const fin = Date.now() - 120_000;
      const complet = serie(1500, fin);
      alertsStore.setState({ defs: [composite, compositeRsi], journal: [] });
      marketStore.setState({ candles: complet.slice(-500) });
      stop = demarrerAlertes();
      // Première passe : le composite sans amorce est évalué (le frein est consommé), l'autre reste figé.
      expect(lotsEvalues).toEqual([["composite-rsi"]]);
      // L'amorce arrive dans la même seconde : seul le composite qu'elle débloque est évalué.
      marketStore.setState({ candles: complet });
      expect(lotsEvalues).toEqual([["composite-rsi"], ["composite-axis"]]);
    });
  });

  it("le graphe quitte le marché : un composite évalué au tick n'y lit plus les bougies gardées", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(10_000_000);
      const t0 = Date.now() - 3_600_000;
      // Série en hausse : le RSI des bougies closes est au-dessus de 50.
      const hausse = Array.from({ length: 60 }, (_v, i) => bougie(t0 + i * 60_000, 100 + i, true));
      const def: AlertDef = {
        id: "comp-prix-rsi", symbol: "BTCUSDT", source: "binance", timeframe: "1m", actif: true, arme: true, declenchements: [],
        condition: { type: "composite", conditions: [
          { type: "prix-croise", niveau: 200, sens: "hausse" },
          { type: "indicateur-seuil", indicateurId: "rsi", params: {}, output: "rsi", comparateur: ">", valeur: 50 },
        ] },
      };
      alertsStore.setState({ defs: [def], journal: [] });
      marketStore.setState({ candles: hausse });
      stop = demarrerAlertes();
      const appelTicker = subscribeTickersMock.mock.calls.find((args) => (args[2] as { source?: string } | undefined)?.source === "binance");
      const ticker = appelTicker?.[1] as (update: { symbol: string; price: number; changePercent: number }) => void;
      expect(ticker).toBeDefined();
      // Sur le graphe : le composite est évalué au tick, prix sous 200 — armé, pas de tir.
      vi.setSystemTime(Date.now() + 2_000);
      ticker({ symbol: "BTCUSDT", price: 150, changePercent: 0 });
      expect(lotsEvalues.at(-1)).toEqual(["comp-prix-rsi"]);
      expect(alertsStore.getState().journal).toHaveLength(0);
      // Le graphe part sur un autre actif : la liste écrit « hors graphe ».
      marketStore.setState({ symbol: "ETHUSDT", candles: [] });
      // Le prix franchit 200 sur le flux de BTCUSDT : avant, le composite tirait sur le RSI des
      // bougies gardées au départ du graphe. Il reste figé : ni tir, ni changement d'armement.
      vi.setSystemTime(Date.now() + 2_000);
      ticker({ symbol: "BTCUSDT", price: 250, changePercent: 0 });
      expect(alertsStore.getState().journal).toHaveLength(0);
      expect(alertsStore.getState().defs[0]?.arme).toBe(true);
      expect(toastsStore.getState().toasts).toHaveLength(0);
      // Le graphe revient sur BTCUSDT : les bougies sont republiées (avec leur dernière clôture
      // pour prix, sous 200), le composite est de nouveau évalué ; au tick suivant il tire.
      vi.setSystemTime(Date.now() + 2_000);
      lotsEvalues.length = 0;
      marketStore.setState({ symbol: "BTCUSDT", candles: hausse });
      expect(lotsEvalues).toEqual([["comp-prix-rsi"]]);
      expect(alertsStore.getState().journal).toHaveLength(0);
      vi.setSystemTime(Date.now() + 2_000);
      ticker({ symbol: "BTCUSDT", price: 250, changePercent: 0 });
      expect(alertsStore.getState().journal.map((d) => d.alertId)).toEqual(["comp-prix-rsi"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("une def RSI garde son comportement : une évaluation par clôture, aucune sur les ticks de la bougie en formation", () => {
    const maintenant = Date.now();
    const hausse = Array.from({ length: 40 }, (_v, i) => bougie(maintenant - (40 - i) * 60_000, 100 + i, true));
    alertsStore.setState({ defs: [seuilIndicateur("rsi", "rsi", "rsi", ">", 70)], journal: [] });
    marketStore.setState({ candles: hausse });
    stop = demarrerAlertes();
    expect(lotsEvalues).toEqual([["rsi"]]);
    marketStore.setState({ candles: [...hausse, bougie(maintenant, 150, false)] });
    marketStore.setState({ candles: [...hausse, bougie(maintenant, 10, false)] });
    expect(lotsEvalues).toEqual([["rsi"]]);
    marketStore.setState({ candles: [...hausse, bougie(maintenant, 141, true)] });
    expect(lotsEvalues).toEqual([["rsi"], ["rsi"]]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────
// Revue globale du 12 novembre 2026 : le VRAI moteur sur le cas de référence BTCUSDT 4h, bougie
// par bougie, comme le graphe principal les publie. AXIS achète à la clôture de la bougie 2 937
// et vend à celle de la bougie 2 942 (avec ou sans série de référence neutre).
// ───────────────────────────────────────────────────────────────────────────────────────────
describe("cas de référence BTCUSDT 4h : signal daté au retour, composites à la référence et calibrés (revue globale du 12 novembre 2026)", () => {
  type Ligne = [number, number, number, number, number, number, number];
  const F: Candle[] = (fixtureBtc.bougies as Ligne[]).map(([time, open, high, low, close, volume, buyVolume]) => ({
    time, open, high, low, close, volume, buyVolume, sellVolume: volume - buyVolume, closed: true,
  }));
  const H4 = 14_400_000;
  const ACHAT = 2937;
  const VENTE = 2942;
  const LIBELLE_ACHAT = "AXIS test 4h ≈ EMA 200 seule · signal d'achat";
  const AXIS_ACHAT: AlertDef["condition"] = { type: "indicateur-seuil", indicateurId: "stratAxis", params: {}, output: "etat", comparateur: ">=", valeur: 1 };
  const AXIS_VENTE: AlertDef["condition"] = { ...AXIS_ACHAT, comparateur: "<=", valeur: 0 };
  const def4h = (id: string, condition: AlertDef["condition"], plus: Partial<AlertDef> = {}): AlertDef => ({
    id, symbol: "BTCUSDT", source: "binance", timeframe: "4h", actif: true, declenchements: [], condition, ...plus,
  });
  const deux = (n: number): string => String(n).padStart(2, "0");
  /** « JJ/MM à HH:MM » en heure locale, écrit sans passer par les aides de format du produit. */
  const jourHeure = (t: number): string => {
    const d = new Date(t);
    return `${deux(d.getDate())}/${deux(d.getMonth() + 1)} à ${deux(d.getHours())}:${deux(d.getMinutes())}`;
  };

  /** Tampon du graphe : bougies 0 à `i` closes, puis la bougie `i + 1` en formation, à son ouverture. */
  function tampon(i: number): Candle[] {
    const suivante = F[i + 1]!;
    return [...F.slice(0, i + 1), { ...suivante, high: suivante.open, low: suivante.open, close: suivante.open, volume: 1, buyVolume: 0, sellVolume: 1, closed: false }];
  }
  let horloge = 0;
  /** L'horloge suit la bougie en formation : une demi-heure après la clôture de la bougie `i`. */
  function ouvrirApres(i: number): void {
    horloge = F[i]!.time + H4 + 30 * 60_000;
    marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "4h", candles: tampon(i) });
  }
  /** La bougie `i` clôture en direct : elle devient close, la suivante s'ouvre, puis un tick. */
  function cloturer(i: number): void {
    horloge = F[i]!.time + H4 + 2_000;
    const marche = marketStore.getState();
    marche.upsertCandle({ ...F[i]!, closed: true });
    const suivante = tampon(i).at(-1)!;
    marche.upsertCandle(suivante);
    marche.upsertCandle({ ...suivante, close: suivante.open * 1.0001 });
  }
  /** Bougie que « Voir » du premier avis marque (indice dans la fixture). */
  async function bougieMarquee(): Promise<number> {
    toastsStore.getState().toasts[0]!.action!.executer();
    await vi.waitFor(() => expect(navigateToMock).toHaveBeenCalledTimes(1));
    const marque = (navigateToMock.mock.calls[0]![0] as { markTime: number }).markTime;
    return F.findIndex((c) => c.time === marque);
  }

  beforeEach(() => {
    vi.spyOn(Date, "now").mockImplementation(() => horloge);
  });

  describe("ouvertureSignal — la bougie où un seuil d'indicateur est devenu vrai", () => {
    const jusqua = (i: number) => ({ candles: F.slice(0, i + 1) });

    it("AXIS acheté : la bougie d'achat, que la dernière bougie lue soit celle-là ou une suivante", () => {
      expect(ouvertureSignal(AXIS_ACHAT, jusqua(ACHAT))).toBe(F[ACHAT]!.time);
      expect(ouvertureSignal(AXIS_ACHAT, jusqua(ACHAT + 1))).toBe(F[ACHAT]!.time);
      expect(ouvertureSignal(AXIS_ACHAT, jusqua(VENTE - 1))).toBe(F[ACHAT]!.time);
    });

    it("AXIS revenu à plat : la bougie de vente ; condition fausse : rien", () => {
      expect(ouvertureSignal(AXIS_VENTE, jusqua(VENTE))).toBe(F[VENTE]!.time);
      expect(ouvertureSignal(AXIS_VENTE, jusqua(VENTE + 2))).toBe(F[VENTE]!.time);
      expect(ouvertureSignal(AXIS_ACHAT, jusqua(ACHAT - 1))).toBeUndefined();
      expect(ouvertureSignal(AXIS_ACHAT, jusqua(VENTE))).toBeUndefined();
    });

    it("début du signal inconnu ou autre condition : rien, jamais une bougie inventée", () => {
      // RSI > 0 : vrai dès sa première valeur, aucune bougie « fausse » avant.
      const rsi: AlertDef["condition"] = { type: "indicateur-seuil", indicateurId: "rsi", params: {}, output: "rsi", comparateur: ">", valeur: 0 };
      expect(ouvertureSignal(rsi, jusqua(ACHAT))).toBeUndefined();
      expect(ouvertureSignal({ ...AXIS_ACHAT, output: "inconnue" }, jusqua(ACHAT))).toBeUndefined();
      expect(ouvertureSignal({ ...AXIS_ACHAT, indicateurId: "inconnu" }, jusqua(ACHAT))).toBeUndefined();
      expect(ouvertureSignal({ type: "variation-pct", fenetreMs: H4, seuilPct: 1 }, jusqua(ACHAT))).toBeUndefined();
      expect(ouvertureSignal(AXIS_ACHAT, {})).toBeUndefined();
    });

    it("la référence du garde-fou de régime est lue comme le moteur la lit : sous sa tendance, pas d'achat", () => {
      const baissiere = Array.from({ length: ACHAT + 1 }, (_v, i) => 100_000 - i);
      expect(ouvertureSignal(AXIS_ACHAT, { ...jusqua(ACHAT), aux: { refClose: baissiere } })).toBeUndefined();
    });
  });

  // Avant : « Signal d'achat », armée, sonnait à la réouverture tant qu'AXIS était acheté, sans
  // dire depuis quand, et « Voir » marquait la dernière bougie close, où il n'y a pas de signal.
  describe("retour dans l'application sur un état qui dure : le message date le signal, « Voir » le marque", () => {
    const suffixe = ` · bougie close le ${jourHeure(F[ACHAT]!.time + H4)}`;

    it("ouverte dans la bougie qui suit l'achat : le signal est la bougie évaluée, aucun ajout", async () => {
      alertsStore.setState({ defs: [def4h("achat", AXIS_ACHAT, { arme: true })], journal: [] });
      ouvrirApres(ACHAT);
      stop = demarrerAlertes();
      expect(alertsStore.getState().journal.map((d) => d.message)).toEqual([LIBELLE_ACHAT]);
      expect(toastsStore.getState().toasts.map((a) => a.texte)).toEqual([`BTCUSDT 4h — ${LIBELLE_ACHAT}`]);
      expect(await bougieMarquee()).toBe(ACHAT);
    });

    for (const derniereClose of [ACHAT + 1, ACHAT + 3]) {
      it(`ouverte ${derniereClose - ACHAT} bougie(s) après l'achat : la clôture de la bougie d'achat est écrite, « Voir » marque cette bougie`, async () => {
        alertsStore.setState({ defs: [def4h("achat", AXIS_ACHAT, { arme: true })], journal: [] });
        ouvrirApres(derniereClose);
        stop = demarrerAlertes();
        expect(alertsStore.getState().journal.map((d) => d.message)).toEqual([`${LIBELLE_ACHAT}${suffixe}`]);
        expect(toastsStore.getState().toasts.map((a) => a.texte)).toEqual([`BTCUSDT 4h — ${LIBELLE_ACHAT}${suffixe}`]);
        // La bougie du signal, pas la dernière close (avant : `derniereClose`).
        expect(await bougieMarquee()).toBe(ACHAT);
      });
    }

    it("« Signal de vente » au retour, deux bougies après la vente : même règle", async () => {
      alertsStore.setState({ defs: [def4h("vente", AXIS_VENTE, { arme: true })], journal: [] });
      ouvrirApres(VENTE + 2);
      stop = demarrerAlertes();
      expect(alertsStore.getState().journal.map((d) => d.message)).toEqual([
        `AXIS test 4h ≈ EMA 200 seule · signal de vente · bougie close le ${jourHeure(F[VENTE]!.time + H4)}`,
      ]);
      expect(await bougieMarquee()).toBe(VENTE);
    });

    it("en direct : l'achat clôture application ouverte, aucun ajout, « Voir » marque la bougie d'achat", async () => {
      alertsStore.setState({ defs: [def4h("achat", AXIS_ACHAT, { arme: true })], journal: [] });
      ouvrirApres(ACHAT - 1);
      stop = demarrerAlertes();
      expect(alertsStore.getState().journal).toHaveLength(0);
      cloturer(ACHAT);
      expect(alertsStore.getState().journal.map((d) => d.message)).toEqual([LIBELLE_ACHAT]);
      expect(await bougieMarquee()).toBe(ACHAT);
    });

    it("LIMITE : ouverte après la vente, l'achat et la vente sont passés sans avis (seule la dernière clôture est rattrapée)", () => {
      alertsStore.setState({ defs: [def4h("achat", AXIS_ACHAT, { arme: true })], journal: [] });
      ouvrirApres(VENTE);
      stop = demarrerAlertes();
      expect(alertsStore.getState().journal).toHaveLength(0);
      expect(toastsStore.getState().toasts).toHaveLength(0);
      expect(alertsStore.getState().defs[0]?.arme).toBe(true);
    });
  });

  // Avant : un composite lisant AXIS était évalué SANS la référence du garde-fou de régime, que
  // l'alerte simple et le graphe reçoivent. Il tirait « AXIS … · signal d'achat ET … » sur une
  // bougie où le garde-fou avait bloqué l'achat.
  describe("composite lisant AXIS : évalué avec la référence du garde-fou de régime", () => {
    const COMPOSITE: AlertDef["condition"] = { type: "composite", conditions: [AXIS_ACHAT as never, { type: "prix-croise", niveau: 1, sens: "hausse" }] };
    const LIBELLE_COMPOSITE = `${LIBELLE_ACHAT} ET Prix franchit 1 à la hausse`;
    /** Référence strictement décroissante, alignée : toujours sous sa tendance, le garde-fou bloque tout achat. */
    const baissiere = (req: unknown) => ({ refClose: Array.from({ length: (req as { candleTimes: number[] }).candleTimes.length }, (_v, i) => 100_000 - i) });
    const deuxDefs = () => [def4h("simple", AXIS_ACHAT, { arme: true }), def4h("composite", COMPOSITE, { arme: true })];

    it("référence sous sa tendance : ni l'alerte simple ni le composite ne tirent à la clôture d'achat", () => {
      getAlignedMock.mockImplementation((req: unknown): unknown => ({ status: "ready", aux: baissiere(req) }));
      alertsStore.setState({ defs: deuxDefs(), journal: [] });
      ouvrirApres(ACHAT - 1);
      stop = demarrerAlertes();
      auxRecus.length = 0;
      lotsEvalues.length = 0;
      cloturer(ACHAT);
      expect(lotsEvalues).toEqual([["simple"], ["composite"]]);
      // Les deux évaluations ont reçu la référence, alignée sur leurs bougies closes.
      expect(auxRecus.map((aux) => (aux as { refClose?: number[] } | undefined)?.refClose?.length)).toEqual([ACHAT + 1, ACHAT + 1]);
      expect(alertsStore.getState().journal).toHaveLength(0);
      expect(toastsStore.getState().toasts).toHaveLength(0);
    });

    it("témoin, référence neutre : les deux tirent à la clôture d'achat", () => {
      alertsStore.setState({ defs: deuxDefs(), journal: [] });
      ouvrirApres(ACHAT - 1);
      stop = demarrerAlertes();
      cloturer(ACHAT);
      expect(alertsStore.getState().journal.map((d) => d.message).sort()).toEqual([LIBELLE_ACHAT, LIBELLE_COMPOSITE].sort());
    });

    it("référence en vol : le composite attend son arrivée, un composite qui ne la lit pas est évalué ; puis une seule évaluation", () => {
      const rappels: Array<() => void> = [];
      let prete = false;
      getAlignedMock.mockImplementation((req: unknown, cb: () => void): unknown => {
        if (prete) return { status: "ready", aux: baissiere(req) };
        rappels.push(cb);
        return { status: "pending" };
      });
      const sansAxis = def4h("sans-axis", { type: "composite", conditions: [
        { type: "variation-pct", fenetreMs: H4, seuilPct: 50 },
        { type: "prix-croise", niveau: 1, sens: "hausse" },
      ] }, { arme: true });
      alertsStore.setState({ defs: [def4h("composite", COMPOSITE, { arme: true }), sansAxis], journal: [] });
      ouvrirApres(ACHAT - 1);
      stop = demarrerAlertes();
      lotsEvalues.length = 0;
      cloturer(ACHAT);
      // Seul le composite sans AXIS est évalué ; l'autre n'a ni tiré ni changé d'armement.
      expect(lotsEvalues).toEqual([["sans-axis"]]);
      expect(alertsStore.getState().journal).toHaveLength(0);
      prete = true;
      for (const rappel of rappels) rappel();
      expect(lotsEvalues).toEqual([["sans-axis"], ["composite"]]);
      // Référence sous sa tendance : pas de tir (sans elle, il tirait).
      expect(alertsStore.getState().journal).toHaveLength(0);
      expect(alertsStore.getState().defs.find((d) => d.id === "composite")?.arme).toBe(true);
    });

    it("référence en échec : évalué sans elle (condition de la v2), comme l'alerte simple", () => {
      getAlignedMock.mockReturnValue({ status: "error", message: "réseau" });
      alertsStore.setState({ defs: [def4h("composite", COMPOSITE, { arme: true })], journal: [] });
      ouvrirApres(ACHAT - 1);
      stop = demarrerAlertes();
      auxRecus.length = 0;
      cloturer(ACHAT);
      expect(auxRecus).toEqual([undefined]);
      expect(alertsStore.getState().journal.map((d) => d.message)).toEqual([LIBELLE_COMPOSITE]);
    });
  });

  // Avant : R3 ne valait que pour les defs simples. Un composite fait de conditions de bougie
  // seules, créé en cours de bougie, n'était calibré qu'à la clôture suivante : son signal était perdu.
  it("composite de conditions de bougie seules, créé en cours de bougie : calibré aussitôt, la clôture d'achat le déclenche", () => {
    ouvrirApres(ACHAT - 1);
    stop = demarrerAlertes();
    const rsiVrai: AlertDef["condition"] = { type: "indicateur-seuil", indicateurId: "rsi", params: {}, output: "rsi", comparateur: ">", valeur: 0 };
    const marche = { symbol: "BTCUSDT", source: "binance", timeframe: "4h" } as const;
    expect(alertsStore.getState().ajouter({ ...marche, condition: AXIS_ACHAT })).toBe(true);
    expect(alertsStore.getState().ajouter({ ...marche, condition: { type: "composite", conditions: [AXIS_ACHAT as never, rsiVrai as never] } })).toBe(true);
    // AXIS à plat sur la dernière bougie close : les deux sont armés, sans tir (avant : composite non calibré).
    expect(alertsStore.getState().defs.map((d) => d.arme)).toEqual([true, true]);
    expect(alertsStore.getState().journal).toHaveLength(0);
    // Pause puis reprise, autre alerte créée : le composite déjà calibré n'est pas réévalué hors cadence.
    lotsEvalues.length = 0;
    expect(alertsStore.getState().ajouter({ ...marche, condition: rsiVrai })).toBe(true);
    expect(lotsEvalues.flat()).toEqual([alertsStore.getState().defs[2]!.id]);
    cloturer(ACHAT);
    expect(alertsStore.getState().journal.map((d) => d.message).sort()).toEqual([LIBELLE_ACHAT, `${LIBELLE_ACHAT} ET rsi(rsi) > 0`].sort());
    expect(toastsStore.getState().toasts).toHaveLength(2);
  });

  // Régression du calibrage immédiat, relevée par la contre-revue du 12 novembre : il valait aussi
  // pour un composite portant un prix. Sans flux de prix déjà ouvert, le « dernier prix » du
  // contexte est la dernière clôture : un niveau placé entre elle et le prix en direct était armé,
  // puis sonnait au premier tick alors que la condition était déjà vraie à la pose.
  it("composite portant un prix, créé en cours de bougie : calibré à son premier tick, il ne sonne pas sur une condition déjà vraie", () => {
    ouvrirApres(ACHAT - 1);
    stop = demarrerAlertes();
    const cloture = F[ACHAT - 1]!.close;
    const rsiVrai: AlertDef["condition"] = { type: "indicateur-seuil", indicateurId: "rsi", params: {}, output: "rsi", comparateur: ">", valeur: 0 };
    const prixFranchi: AlertDef["condition"] = { type: "prix-croise", niveau: cloture * 1.001, sens: "hausse" };
    expect(alertsStore.getState().ajouter({
      symbol: "BTCUSDT", source: "binance", timeframe: "4h",
      condition: { type: "composite", conditions: [prixFranchi as never, rsiVrai as never] },
    })).toBe(true);
    // Pas de calibrage sur la dernière clôture, qui est sous le niveau.
    expect(alertsStore.getState().defs[0]?.arme).toBeUndefined();
    const ticker = subscribeTickersMock.mock.calls.filter((args) => (args[2] as { source?: string } | undefined)?.source === "binance").at(-1)?.[1] as
      (update: { symbol: string; price: number; changePercent: number }) => void;
    expect(ticker).toBeDefined();
    // Premier tick : le prix en direct est déjà au-dessus du niveau. Calibrage, ni tir ni avis.
    horloge += 2_000;
    ticker({ symbol: "BTCUSDT", price: cloture * 1.002, changePercent: 0 });
    expect(alertsStore.getState().defs[0]?.arme).toBeDefined();
    expect(alertsStore.getState().journal).toHaveLength(0);
    expect(toastsStore.getState().toasts).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────
// Lot A2 (12 novembre 2026) : la vue principale charge l'historique des alertes de son marché et
// publie l'état de son extension. Le VRAI moteur sur le cas de référence servi jusqu'à la bougie
// 2 987 (2 988 bougies, la place n'en a pas plus) : l'amorce d'AXIS S/R (3 000) n'est jamais
// atteinte. Réaction sur support fort à la bougie 2 988, pas à la 2 987 (fixture).
// ───────────────────────────────────────────────────────────────────────────────────────────
describe("lot A2 : historique chargé pour l'alerte, amorce courte dite (12 novembre 2026)", () => {
  type Ligne = [number, number, number, number, number, number, number];
  const F: Candle[] = (fixtureBtc.bougies as Ligne[]).map(([time, open, high, low, close, volume, buyVolume]) => ({
    time, open, high, low, close, volume, buyVolume, sellVolume: volume - buyVolume, closed: true,
  }));
  const H4 = 14_400_000;
  const SERVIES = 2988;
  const CLE = "binance|BTCUSDT|4h";
  const LIBELLE = "AXIS S/R non mesuré · réaction sur support fort";
  const REACTION_SR: AlertDef["condition"] = { type: "indicateur-seuil", indicateurId: "stratAxisSr", params: {}, output: "reactionSupport", comparateur: ">=", valeur: 1 };
  const def4h = (id: string, condition: AlertDef["condition"], plus: Partial<AlertDef> = {}): AlertDef => ({
    id, symbol: "BTCUSDT", source: "binance", timeframe: "4h", actif: true, declenchements: [], condition, ...plus,
  });
  let horloge = 0;
  /** État publié par la vue principale (`chart/ChartInstance.tsx`). */
  const publier = (terminee: boolean, amorceVisee: number, bougies: number, cle = CLE): void =>
    publierExtension({ cle, terminee, amorceVisee, bougies });
  /** La place sert les bougies 0 à 2 987, closes ; l'horloge est dans la bougie 2 988, une demi-heure après son ouverture. */
  function ouvrir(symbol = "BTCUSDT"): void {
    horloge = F[SERVIES]!.time + 30 * 60_000;
    marketStore.setState({ exchange: "binance", symbol, timeframe: "4h", candles: F.slice(0, SERVIES) });
  }
  /** La bougie `i` clôture en direct, poussée par le flux. */
  function cloturer(i: number): void {
    horloge = F[i]!.time + H4 + 2_000;
    marketStore.getState().upsertCandle({ ...F[i]!, closed: true });
  }
  const messagesJournal = (): string[] => alertsStore.getState().journal.map((d) => d.message);
  const textesAvis = (): string[] => toastsStore.getState().toasts.map((t) => t.texte);

  beforeEach(() => {
    vi.spyOn(Date, "now").mockImplementation(() => horloge);
    extensionGrapheStore.setState({ extension: null });
  });
  afterEach(() => {
    extensionGrapheStore.setState({ extension: null });
  });

  it("place à sec : rien tant que la remontée n'est pas finie, calibrée à sa fin, la clôture de 2 988 sonne en le disant, une seule fois", () => {
    alertsStore.setState({ defs: [def4h("sr", REACTION_SR)], journal: [] });
    ouvrir();
    stop = demarrerAlertes();
    // Rien de connu de l'extension, puis remontée en cours : ni calibrage ni évaluation.
    expect(lotsEvalues).toEqual([]);
    publier(false, 3000, 500);
    marketStore.setState({ candles: F.slice(0, SERVIES) });
    expect(lotsEvalues).toEqual([]);
    // Remontée finie, la place n'a que 2 988 bougies : évaluée une fois sous la même clôture (calibrage, réaction 0 à 2 987).
    publier(true, 3000, SERVIES);
    expect(lotsEvalues).toEqual([["sr"]]);
    expect(alertsStore.getState().defs[0]?.arme).toBe(true);
    expect(alertsStore.getState().journal).toEqual([]);
    // Une seconde passe (alerte ajoutée, indicateur affiché) sous la même clôture : rien de plus.
    publier(false, 3000, SERVIES);
    publier(true, 3000, SERVIES);
    expect(lotsEvalues).toEqual([["sr"]]);
    // La clôture de la bougie 2 988 : réaction sur support fort, sur 2 989 bougies closes.
    cloturer(SERVIES);
    expect(lotsEvalues).toEqual([["sr"], ["sr"]]);
    expect(messagesJournal()).toEqual([`${LIBELLE} · amorce courte (2989 bougies)`]);
    expect(textesAvis()).toEqual([`BTCUSDT 4h — ${LIBELLE} · amorce courte (2989 bougies)`]);
    // La même clôture repoussée : ni seconde évaluation, ni second avis.
    cloturer(SERVIES);
    expect(lotsEvalues).toEqual([["sr"], ["sr"]]);
    expect(textesAvis()).toHaveLength(1);
  });

  it("témoin : sans la fin de la remontée, la clôture de 2 988 ne sonne pas (règle A1, tampon sous l'amorce)", () => {
    alertsStore.setState({ defs: [def4h("sr", REACTION_SR, { arme: true })], journal: [] });
    ouvrir();
    stop = demarrerAlertes();
    publier(false, 3000, 500);
    cloturer(SERVIES);
    expect(lotsEvalues).toEqual([]);
    expect(textesAvis()).toEqual([]);
    // La remontée finit après la clôture, tant qu'elle reste la dernière : évaluée une fois, elle tire en le disant.
    publier(true, 3000, SERVIES + 1);
    expect(lotsEvalues).toEqual([["sr"]]);
    expect(messagesJournal()).toEqual([`${LIBELLE} · amorce courte (2989 bougies)`]);
  });

  it("la mention ne vaut que sous l'amorce : à 3 000 bougies, le message est le libellé seul", () => {
    // Score au-dessus de −100 : toujours vrai ; armées, les deux defs tirent à leur première évaluation.
    const score: AlertDef["condition"] = { type: "indicateur-seuil", indicateurId: "stratAxisSr", params: {}, output: "score", comparateur: ">", valeur: -100 };
    const libelle = "AXIS S/R non mesuré · Score (−6 à +6) > -100";
    alertsStore.setState({ defs: [def4h("a", score, { arme: true }), def4h("b", score, { arme: true, actif: false })], journal: [] });
    horloge = F[2999]!.time + 30 * 60_000;
    marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "4h", candles: F.slice(0, 2999) });
    stop = demarrerAlertes();
    publier(true, 3000, 2999);
    expect(messagesJournal()).toEqual([`${libelle} · amorce courte (2999 bougies)`]);
    // La bougie 2 999 clôture : 3 000 bougies, l'amorce est là. La def en pause, reprise, tire sans mention.
    cloturer(2999);
    alertsStore.getState().basculerActif("b");
    expect(messagesJournal()).toEqual([libelle, `${libelle} · amorce courte (2999 bougies)`]);
  });

  it("extension terminée qui ne visait que 1 500 bougies (AXIS seul) : AXIS S/R n'est pas évaluée à 1 500 (correction 2 de la critique)", () => {
    alertsStore.setState({ defs: [def4h("sr", REACTION_SR)], journal: [] });
    horloge = F[SERVIES]!.time + 30 * 60_000;
    marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "4h", candles: F.slice(SERVIES - 1500, SERVIES) });
    stop = demarrerAlertes();
    publier(true, 1500, 1500);
    expect(lotsEvalues).toEqual([]);
    // La passe suivante vise 3 000 : en cours, rien ; finie à sec, évaluée.
    publier(false, 3000, 1500);
    marketStore.setState({ candles: F.slice(0, SERVIES) });
    expect(lotsEvalues).toEqual([]);
    publier(true, 3000, SERVIES);
    expect(lotsEvalues).toEqual([["sr"]]);
  });

  it("état publié pour une autre unité ou un autre actif : rien n'est évalué ; au changement de marché, l'état du marché quitté ne vaut pas", () => {
    alertsStore.setState({ defs: [def4h("sr", REACTION_SR), { ...def4h("sr-eth", REACTION_SR), symbol: "ETHUSDT" }], journal: [] });
    ouvrir();
    stop = demarrerAlertes();
    publier(true, 3000, SERVIES, "binance|BTCUSDT|1h");
    publier(true, 3000, SERVIES, "binance|ETHUSDT|4h");
    expect(lotsEvalues).toEqual([]);
    publier(true, 3000, SERVIES);
    expect(lotsEvalues).toEqual([["sr"]]);
    // Le graphe passe sur ETHUSDT (mêmes bougies) : l'état publié est encore celui de BTCUSDT.
    ouvrir("ETHUSDT");
    expect(lotsEvalues).toEqual([["sr"]]);
    publier(true, 3000, SERVIES, "binance|ETHUSDT|4h");
    expect(lotsEvalues).toEqual([["sr"], ["sr-eth"]]);
  });

  it("alerte supprimée pendant la remontée : ni évaluation ni avis à sa fin", () => {
    alertsStore.setState({ defs: [def4h("sr", REACTION_SR, { arme: true })], journal: [] });
    ouvrir();
    stop = demarrerAlertes();
    publier(false, 3000, 500);
    alertsStore.getState().supprimer("sr");
    publier(true, 3000, SERVIES);
    cloturer(SERVIES);
    expect(lotsEvalues).toEqual([]);
    expect(textesAvis()).toEqual([]);
  });

  it("une def RSI et une variation ne dépendent pas de l'extension : une évaluation par clôture, aucune de plus quand son état change", () => {
    alertsStore.setState({
      defs: [
        def4h("rsi", { type: "indicateur-seuil", indicateurId: "rsi", params: {}, output: "rsi", comparateur: ">", valeur: 70 }),
        def4h("var", { type: "variation-pct", fenetreMs: H4, seuilPct: 50 }),
      ],
      journal: [],
    });
    ouvrir();
    stop = demarrerAlertes();
    expect(lotsEvalues).toEqual([["rsi", "var"]]);
    publier(false, 3000, 500);
    publier(true, 3000, SERVIES);
    expect(lotsEvalues).toEqual([["rsi", "var"]]);
    cloturer(SERVIES);
    expect(lotsEvalues).toEqual([["rsi", "var"], ["rsi", "var"]]);
    expect(messagesJournal().some((m) => m.includes("amorce courte"))).toBe(false);
  });

  it("composite lisant AXIS S/R sur une place à sec : figé pendant la remontée, évalué une fois à sa fin, son déclenchement le dit", () => {
    const rsiVrai = { type: "indicateur-seuil", indicateurId: "rsi", params: {}, output: "rsi", comparateur: ">", valeur: 0 } as const;
    const composite = def4h("comp", { type: "composite", conditions: [REACTION_SR as Extract<AlertDef["condition"], { type: "indicateur-seuil" }>, rsiVrai] });
    alertsStore.setState({ defs: [composite], journal: [] });
    ouvrir();
    stop = demarrerAlertes();
    publier(false, 3000, 500);
    expect(lotsEvalues).toEqual([]);
    publier(true, 3000, SERVIES);
    expect(lotsEvalues).toEqual([["comp"]]);
    expect(alertsStore.getState().defs[0]?.arme).toBe(true);
    cloturer(SERVIES);
    expect(lotsEvalues).toEqual([["comp"], ["comp"]]);
    expect(messagesJournal()).toEqual([`${LIBELLE} ET rsi(rsi) > 0 · amorce courte (2989 bougies)`]);
  });

  it("réglages copiés de l'instance du graphe (force de zone 8) : l'alerte tire aux réactions de ce réglage, 2 985 et pas 2 988", () => {
    // Chaîne du formulaire : instance d'AXIS S/R à force 8 sur la vue principale → réglages copiés → condition.
    const sr = getIndicator("stratAxisSr")!;
    const reglages = paramsInstancePourAlerte(sr, [{ defId: "stratAxisSr", params: { forceZoneForte: 8 } }], "reactionSupport");
    expect(reglages).toEqual({ origine: "instance", params: { forceZoneForte: 8 } });
    const force8 = construireConditionSeuil("stratAxisSr", "reactionSupport", ">", "", reglages.origine === "instance" ? reglages.params : {})!;
    alertsStore.setState({ defs: [def4h("defaut", REACTION_SR), def4h("force8", force8)], journal: [] });
    horloge = F[2984]!.time + 30 * 60_000;
    marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "4h", candles: F.slice(0, 2984) });
    stop = demarrerAlertes();
    publier(true, 3000, 2984);
    for (let i = 2984; i <= SERVIES; i++) cloturer(i);
    // Réactions sur support fort de 2 984 à 2 988 : force 6 (défaut) à 2 985 et 2 988, force 8 à 2 985 seulement.
    expect(alertsStore.getState().journal.map((d) => `${d.alertId} ${d.message}`).reverse()).toEqual([
      `defaut ${LIBELLE} · amorce courte (2986 bougies)`,
      `force8 ${LIBELLE} · amorce courte (2986 bougies)`,
      `defaut ${LIBELLE} · amorce courte (2989 bougies)`,
    ]);
  });
});
