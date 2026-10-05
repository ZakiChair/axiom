/**
 * Tests du modèle PUR de l'OI BTC par exchange (DES) : exclusion du champ de synthèse
 * `openInterestFutures`, sélection du dernier jour non vide, parts et Δ vs J-7.
 */
import { describe, it, expect } from "vitest";
import {
  construireModeleOiExchange,
  joindreSpreadParTimestamp,
  libelleMarchePerp,
  texteAprFunding,
  texteProchainReglement,
} from "./derivativesWindow.util";
import type { JourOiFutures } from "../data/onchain/bgeometrics";
import type { MarchePerp, PlacePerp } from "../data/marchesPerp";

/** Fabrique un marché perp minimal pour les libellés. */
function marche(place: PlacePerp, symboleSurPlace: string, multiplicateur: number): MarchePerp {
  return {
    place,
    symbole: `${symboleSurPlace}.X`,
    symboleSurPlace,
    multiplicateur,
    aLongShort: true,
    aLiquidations: place !== "hyperliquid",
  };
}

/** Fabrique un jour à partir d'une ventilation brute. */
function jour(d: string, parExchange: Record<string, number>): JourOiFutures {
  return { d, parExchange };
}

describe("construireModeleOiExchange", () => {
  it("exclut openInterestFutures des barres ET du dénominateur des parts", () => {
    const m = construireModeleOiExchange([
      jour("2026-07-20", { binance: 6, bybit: 4, openInterestFutures: 999 }),
    ]);
    expect(m).not.toBeNull();
    // Aucune barre « openInterestFutures ».
    expect(m!.rangs.map((r) => r.exchange)).toEqual(["binance", "bybit"]);
    // Total = 6 + 4 = 10 (la synthèse 999 est ignorée).
    expect(m!.total).toBe(10);
    // Parts calculées sur 10, pas sur 1009.
    expect(m!.rangs[0]!.part).toBeCloseTo(0.6, 10);
    expect(m!.rangs[1]!.part).toBeCloseTo(0.4, 10);
  });

  it("trie les exchanges par notionnel décroissant", () => {
    const m = construireModeleOiExchange([
      jour("2026-07-20", { bybit: 3, binance: 9, okx: 5 }),
    ]);
    expect(m!.rangs.map((r) => r.exchange)).toEqual(["binance", "okx", "bybit"]);
  });

  it("remonte au dernier jour NON VIDE et affiche sa date", () => {
    const m = construireModeleOiExchange([
      jour("2026-07-18", { binance: 8, bybit: 2 }),
      jour("2026-07-19", { openInterestFutures: 500 }), // vide après exclusion
      jour("2026-07-20", {}), // vide
    ]);
    expect(m!.date).toBe("2026-07-18");
    expect(m!.total).toBe(10);
  });

  it("calcule le Δ vs J-7 par exchange (même position −7)", () => {
    const jours: JourOiFutures[] = [];
    // idx 0 = J-7 de idx 7.
    jours.push(jour("2026-07-13", { binance: 5, bybit: 3 }));
    for (let i = 1; i < 7; i++) jours.push(jour(`2026-07-${13 + i}`, { binance: 6, bybit: 3 }));
    jours.push(jour("2026-07-20", { binance: 9, bybit: 2 }));
    const m = construireModeleOiExchange(jours);
    expect(m!.date).toBe("2026-07-20");
    const binance = m!.rangs.find((r) => r.exchange === "binance")!;
    const bybit = m!.rangs.find((r) => r.exchange === "bybit")!;
    expect(binance.deltaJ7).toBe(9 - 5); // +4 vs J-7
    expect(bybit.deltaJ7).toBe(2 - 3); // -1 vs J-7
  });

  it("Δ = null si l'historique ne remonte pas 7 séances en arrière", () => {
    const m = construireModeleOiExchange([
      jour("2026-07-19", { binance: 5 }),
      jour("2026-07-20", { binance: 6 }),
    ]);
    expect(m!.rangs[0]!.deltaJ7).toBeNull();
  });

  it("Δ = null pour un exchange absent du jour J-7", () => {
    const jours: JourOiFutures[] = [];
    jours.push(jour("2026-07-13", { binance: 5 })); // pas de okx à J-7
    for (let i = 1; i < 7; i++) jours.push(jour(`2026-07-${13 + i}`, { binance: 6, okx: 1 }));
    jours.push(jour("2026-07-20", { binance: 9, okx: 4 }));
    const m = construireModeleOiExchange(jours);
    const okx = m!.rangs.find((r) => r.exchange === "okx")!;
    expect(okx.deltaJ7).toBeNull();
  });

  it("renvoie null si aucun jour n'a de données exploitables", () => {
    expect(construireModeleOiExchange([])).toBeNull();
    expect(construireModeleOiExchange([jour("2026-07-20", { openInterestFutures: 1 })])).toBeNull();
  });
});

describe("joindreSpreadParTimestamp", () => {
  it("joint sur timestamp : bucket manquant au début ET au milieu", () => {
    const foule = [
      { time: 20, longAccount: 0.6, shortAccount: 0.4 },
      { time: 30, longAccount: 0.55, shortAccount: 0.45 },
      { time: 50, longAccount: 0.5, shortAccount: 0.5 },
    ];
    const top = [
      { time: 10, longAccount: 0.7, shortAccount: 0.3 },
      { time: 20, longAccount: 0.8, shortAccount: 0.2 },
      { time: 30, longAccount: 0.75, shortAccount: 0.25 },
      { time: 40, longAccount: 0.9, shortAccount: 0.1 },
      { time: 50, longAccount: 0.6, shortAccount: 0.4 },
    ];
    const joint = joindreSpreadParTimestamp(foule, top);
    expect(joint.map((p) => p.time)).toEqual([20, 30, 50]);
    // Net = (long − short) × 100 ; spread = net top − net foule.
    expect(joint[0]!.spread).toBeCloseTo(40, 10); // 60 − 20
    expect(joint[1]!.spread).toBeCloseTo(40, 10); // 50 − 10
    expect(joint[2]!.spread).toBeCloseTo(20, 10); // 20 − 0
  });

  it("ne joint pas par index : des files de même longueur mais décalées ne se mélangent pas", () => {
    const foule = [
      { time: 10, longAccount: 0.6, shortAccount: 0.4 },
      { time: 30, longAccount: 0.4, shortAccount: 0.6 },
    ];
    const top = [
      { time: 20, longAccount: 0.8, shortAccount: 0.2 },
      { time: 30, longAccount: 0.7, shortAccount: 0.3 },
    ];
    const joint = joindreSpreadParTimestamp(foule, top);
    expect(joint).toHaveLength(1);
    expect(joint[0]!.time).toBe(30);
    expect(joint[0]!.spread).toBeCloseTo(60, 10); // 40 − (−20)
  });
});

// ───────── Perp multi-places (demande du 5 octobre 2026) ─────────
describe("libelleMarchePerp", () => {
  it("place + symbole sur place, multiplicateur affiché seulement si ≠ 1", () => {
    expect(libelleMarchePerp(marche("binance", "PUMPUSDT", 1))).toBe("Binance · PUMPUSDT");
    expect(libelleMarchePerp(marche("bybit", "PUMPFUNUSDT", 1))).toBe("Bybit · PUMPFUNUSDT");
    expect(libelleMarchePerp(marche("binance", "1000PEPEUSDT", 1000))).toBe(
      "Binance · 1000PEPEUSDT · contrat ×1000",
    );
  });
});

describe("texteAprFunding", () => {
  it("annualise à la cadence réelle : 8 h, 4 h et 1 h", () => {
    expect(texteAprFunding(0.0001, 8)).toBe("APR (règlement 8 h) +10.95%");
    expect(texteAprFunding(0.0001, 4)).toBe("APR (règlement 4 h) +21.90%");
    expect(texteAprFunding(0.0000125, 1)).toBe("APR (règlement 1 h) +10.95%");
  });

  it("couvre la lecture en cours (undefined) et la cadence inconnue (null)", () => {
    expect(texteAprFunding(0.0001, undefined)).toBe("APR : lecture de la cadence…");
    expect(texteAprFunding(0.0001, null)).toBe("APR : cadence de règlement inconnue");
  });
});

describe("texteProchainReglement", () => {
  const troisH = Date.UTC(2026, 6, 2, 3, 0, 0);

  it("cadence connue divisant 24 → « prochain règlement (~h) délai · heure »", () => {
    expect(texteProchainReglement(troisH, 4)).toMatch(/^prochain règlement \(~4 h\) dans /);
    expect(texteProchainReglement(troisH, 8)).toMatch(/^prochain règlement \(~8 h\) dans /);
    expect(texteProchainReglement(troisH, 1)).toMatch(/^prochain règlement \(~1 h\) dans /);
  });

  it("lecture en cours (undefined) → « lecture de la cadence… »", () => {
    expect(texteProchainReglement(troisH, undefined)).toBe(
      "prochain règlement : lecture de la cadence…",
    );
  });

  it("cadence inconnue ou ne divisant pas 24 → « cadence inconnue »", () => {
    expect(texteProchainReglement(troisH, null)).toBe("prochain règlement : cadence inconnue");
    expect(texteProchainReglement(troisH, 5)).toBe("prochain règlement : cadence inconnue");
    expect(texteProchainReglement(troisH, 0)).toBe("prochain règlement : cadence inconnue");
    expect(texteProchainReglement(troisH, 2.5)).toBe("prochain règlement : cadence inconnue");
  });
});
