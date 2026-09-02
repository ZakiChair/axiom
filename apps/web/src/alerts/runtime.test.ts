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

vi.mock("../data/ticker", () => ({ subscribeTickers: vi.fn(() => () => {}) }));
vi.mock("../data/daemon", () => ({
  daemonPret: () => false,
  daemonSupporte: () => false,
  detectDaemon: async () => false,
  urlDaemon: (chemin: string) => chemin,
  kvPut: async () => null,
}));
vi.mock("../data/coinalyze", () => ({
  coinalyzeProvider: {
    fetchFundingRate: async () => ({ rate: 0 }),
    fetchFundingRateHistory: async () => [],
  },
}));
const { executerScreenerMock } = vi.hoisted(() => ({ executerScreenerMock: vi.fn() }));
vi.mock("../data/screenerRun", () => ({ executerScreener: executerScreenerMock }));
vi.mock("../chart/liquidationMarkers", () => ({
  fluxLiqRetenu: () => false,
  liqEventsStore: { getState: () => ({ events: [] }), subscribe: () => () => {} },
}));
vi.mock("../store/regime", () => ({
  regimeStore: { getState: () => ({ regime: null }), subscribe: () => () => {} },
}));

import { demarrerAlertes } from "./runtime";
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
  marketStore.setState({ symbol: "BTCUSDT", timeframe: "1m", candles: [] });
  orderflowStore.setState({ enabled: false, cvdSpotPerp: false });
  presetAlertsStore.setState({ alertes: [] });
  executerScreenerMock.mockReset();
  executerScreenerMock.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.unstubAllGlobals();
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
    vi.stubGlobal("document", { visibilityState: "hidden" });
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
