/**
 * Tests de la fonction PURE `typeEvenementDe` (ecoMarkers.ts) : mappe le titre d'un
 * évènement ECO vers le TypeEvenement d'étude correspondant (CPI / NFP / FOMC), ou null.
 * Le couplage KLineChart (overlay, suffixe des labels) n'est PAS testé (rendu impératif,
 * comme tradeMarkers / fibonacci).
 *
 * ecoMarkers.ts appelle `registerOverlay`, importe `./drawing` (klinecharts) et s'abonne
 * aux stores market / eco / evts au chargement (démarrage du contrôleur singleton) : on
 * les stub pour importer le module en environnement Node, sans DOM. Même pattern que
 * tradeMarkers.test.ts / navigation.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("./drawing", () => ({ getActiveChart: () => null }));
vi.mock("../store/theme", () => ({
  themeStore: { getState: () => ({ theme: "dark" }), subscribe: () => () => {} },
}));
vi.mock("../store/market", () => ({
  marketStore: {
    getState: () => ({ candles: [], symbol: "BTCUSDT", exchange: "binance" }),
    subscribe: () => () => {},
  },
}));
vi.mock("../store/eco", () => ({
  ecoStore: { getState: () => ({ markersEnabled: false, events: [] }), subscribe: () => () => {} },
}));
vi.mock("../store/evts", () => ({
  evtsUiStore: { getState: () => ({ statsParType: {} }), subscribe: () => () => {} },
}));

import { typeEvenementDe, doitRejouerEco, type ContexteRejeuEco } from "./ecoMarkers";

describe("typeEvenementDe — CPI", () => {
  it("reconnaît le titre FRED « Consumer Price Index »", () => {
    expect(typeEvenementDe("Consumer Price Index")).toBe("cpi");
  });

  it("reconnaît les titres ForexFactory « CPI m/m » et « Core CPI m/m » (casse ignorée)", () => {
    expect(typeEvenementDe("CPI m/m")).toBe("cpi");
    expect(typeEvenementDe("Core CPI m/m")).toBe("cpi");
    expect(typeEvenementDe("cpi y/y")).toBe("cpi");
  });
});

describe("typeEvenementDe — NFP", () => {
  it("reconnaît le titre FRED « Employment Situation »", () => {
    expect(typeEvenementDe("Employment Situation")).toBe("nfp");
  });

  it("reconnaît les titres ForexFactory « Non-Farm Employment Change » et « NFP »", () => {
    expect(typeEvenementDe("Non-Farm Employment Change")).toBe("nfp");
    expect(typeEvenementDe("NFP")).toBe("nfp");
  });
});

describe("typeEvenementDe — FOMC", () => {
  it("reconnaît le titre statique « Décision FOMC (taux directeur) » et « FOMC Statement »", () => {
    expect(typeEvenementDe("Décision FOMC (taux directeur)")).toBe("fomc");
    expect(typeEvenementDe("FOMC Statement")).toBe("fomc");
  });
});

describe("typeEvenementDe — hors périmètre", () => {
  it("renvoie null pour un évènement non étudié", () => {
    expect(typeEvenementDe("Producer Price Index")).toBeNull();
    expect(typeEvenementDe("Gross Domestic Product")).toBeNull();
    expect(typeEvenementDe("Federal Funds Rate")).toBeNull();
    expect(typeEvenementDe("")).toBeNull();
  });

  it("écarte « FOMC Meeting Minutes » : les Minutes ne sont pas une décision", () => {
    expect(typeEvenementDe("FOMC Meeting Minutes")).toBeNull();
  });
});

describe("doitRejouerEco — garde de rejeu (post-Lot D1)", () => {
  const base: ContexteRejeuEco = { chart: { id: 1 }, symbol: "BTCUSDT", exchange: "binance", ready: true };

  it("rejoue quand le SYMBOLE change sur la MÊME instance (l'instance survit au changement d'actif)", () => {
    expect(doitRejouerEco(base, { ...base, symbol: "ETHUSDT" })).toBe(true);
  });

  it("rejoue quand l'axe temps devient prêt (fin du backfill) ou quand le focus change", () => {
    expect(doitRejouerEco({ ...base, ready: false }, base)).toBe(true);
    expect(doitRejouerEco(base, { ...base, chart: { id: 2 } })).toBe(true);
    expect(doitRejouerEco(base, { ...base, exchange: "kraken" })).toBe(true);
  });

  it("ne rejoue PAS sur un simple tick (contexte identique)", () => {
    expect(doitRejouerEco(base, { ...base })).toBe(false);
  });
});
