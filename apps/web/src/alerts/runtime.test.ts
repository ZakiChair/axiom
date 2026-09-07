/**
 * Câblage du runtime des alertes (creerRuntime via demarrerAlertes) — source « clôture
 * de bougie » : une condition variation-pct se déclenche sur bougie CLÔTURÉE uniquement
 * (jamais sur la bougie en formation) et le ré-armement fonctionne bout-en-bout
 * (journal + état `arme` de la def). Réseau/WS/daemon mockés (aucun accès réseau) ;
 * alertsStore et marketStore sont réels : env node, localStorage absent = no-op toléré.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertDef } from "@axiom/alerts";
import type { Candle } from "@axiom/types";

const { executerScreenerMock, subscribeTickersMock, daemonSupporteMock, detectDaemonMock, urlDaemonMock } =
  vi.hoisted(() => ({
    executerScreenerMock: vi.fn(),
    subscribeTickersMock: vi.fn((..._args: unknown[]) => () => {}),
    daemonSupporteMock: vi.fn(() => false),
    detectDaemonMock: vi.fn(async () => false),
    urlDaemonMock: vi.fn((chemin: string) => chemin),
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
    fetchFundingRate: async () => ({ rate: 0 }),
    fetchFundingRateHistory: async () => [],
  },
}));
vi.mock("../data/screenerRun", () => ({ executerScreener: executerScreenerMock }));
vi.mock("../chart/liquidationMarkers", () => ({
  fluxLiqRetenu: () => false,
  liqEventsStore: { getState: () => ({ events: [] }), subscribe: () => () => {} },
}));
vi.mock("../store/regime", () => ({
  regimeStore: { getState: () => ({ regime: null }), subscribe: () => () => {} },
}));

import { demarrerAlertes, notifier } from "./runtime";
import { alertsStore } from "../store/alerts";
import { marketStore } from "../store/market";
import { orderflowStore } from "../store/orderflow";
import { presetAlertsStore, type AlertePreset } from "../store/presetAlerts";

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
  orderflowStore.setState({ enabled: false, cvdSpotPerp: false });
  presetAlertsStore.setState({ alertes: [] });
  subscribeTickersMock.mockClear();
  daemonSupporteMock.mockReset();
  daemonSupporteMock.mockReturnValue(false);
  detectDaemonMock.mockReset();
  detectDaemonMock.mockResolvedValue(false);
  urlDaemonMock.mockReset();
  urlDaemonMock.mockImplementation((chemin: string) => chemin);
  executerScreenerMock.mockReset();
  executerScreenerMock.mockResolvedValue({ rows: [] });
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
    alertsStore.setState({ defs: [prix("okx", "okx")], journal: [] });
    marketStore.setState({
      exchange: "okx",
      symbol: "BTCUSDT",
      timeframe: "1m",
      candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true)],
    });
    stop = demarrerAlertes();
    marketStore.setState({
      candles: [bougie(t0, 100, true), bougie(t0 + 60_000, 100, true), bougie(t0 + 120_000, 110, true)],
    });

    expect(subscribeTickersMock).not.toHaveBeenCalled();
    expect(alertsStore.getState().journal.map((d) => d.alertId)).toEqual(["okx"]);
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

describe("pipeline CVD : rallumé sur changement de DEFS uniquement", () => {
  const DEF_CVD: AlertDef = {
    id: "cvd1",
    symbol: "BTCUSDT",
    source: "binance",
    condition: { type: "cvd-spot-perp-div", kind: "les-deux" },
    actif: true,
    declenchements: [],
  };

  it("un simple ajout au journal ne réactive PAS l'orderflow coupé par l'opérateur", () => {
    alertsStore.setState({ defs: [DEF_CVD], journal: [] });
    stop = demarrerAlertes();
    expect(orderflowStore.getState().enabled).toBe(true); // allumé au démarrage

    // L'opérateur coupe le footprint / CVD S/P à la main.
    orderflowStore.getState().setEnabled(false);
    orderflowStore.getState().setCvdSpotPerp(false);

    // Déclenchement d'une alerte SANS RAPPORT : le store émet sur le journal ET sur la
    // transition d'armement (`appliquerMisesAJour` réalloue `defs`) — dans les deux cas
    // l'ENSEMBLE des alertes CVD est inchangé, le pipeline ne doit PAS être ressuscité.
    alertsStore.getState().ajouterJournal({ alertId: "autre", ts: Date.now(), valeur: 1, message: "m" });
    alertsStore.getState().appliquerMisesAJour([{ ...DEF_CVD, arme: false }]);

    expect(orderflowStore.getState().enabled).toBe(false);
    expect(orderflowStore.getState().cvdSpotPerp).toBe(false);
  });

  it("une NOUVELLE alerte CVD rallume bien le pipeline (non-régression)", () => {
    alertsStore.setState({ defs: [DEF_CVD], journal: [] });
    stop = demarrerAlertes();
    orderflowStore.getState().setEnabled(false);
    orderflowStore.getState().setCvdSpotPerp(false);
    alertsStore.setState({ defs: [DEF_CVD, { ...DEF_CVD, id: "cvd2", symbol: "ETHUSDT" }] });
    expect(orderflowStore.getState().enabled).toBe(true);
    expect(orderflowStore.getState().cvdSpotPerp).toBe(true);
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
});
