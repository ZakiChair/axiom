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
vi.mock("../data/screenerRun", () => ({ executerScreener: async () => ({ rows: [] }) }));
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

/** Bougie plate au prix donné (les champs OHLC égaux suffisent au moteur). */
function bougie(time: number, close: number, closed: boolean): Candle {
  return { time, open: close, high: close, low: close, close, volume: 1, closed };
}

const DEF: AlertDef = {
  id: "a1",
  symbol: "BTCUSDT",
  source: "binance",
  condition: { type: "variation-pct", fenetreMs: 90_000, seuilPct: 5 },
  actif: true,
  declenchements: [],
};

let stop: (() => void) | null = null;

beforeEach(() => {
  alertsStore.setState({ defs: [], journal: [] });
  marketStore.setState({ symbol: "BTCUSDT", candles: [] });
});

afterEach(() => {
  stop?.();
  stop = null;
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

    // Nouvelle bougie CLÔTURÉE à +10 % (référence = clôture d'il y a ≥ 90 s = 100)
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
