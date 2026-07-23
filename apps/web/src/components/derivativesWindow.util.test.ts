/**
 * Tests du modèle PUR de l'OI BTC par exchange (DES) : exclusion du champ de synthèse
 * `openInterestFutures`, sélection du dernier jour non vide, parts et Δ vs J-7.
 */
import { describe, it, expect } from "vitest";
import { construireModeleOiExchange } from "./derivativesWindow.util";
import type { JourOiFutures } from "../data/onchain/bgeometrics";

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
