import { describe, expect, it } from "vitest";
import {
  coutAllInParBtc,
  coutElectriqueParBtc,
  emissionBtcParJour,
  hashpriceUsdParPhJour,
  ratioPrixCout,
  PARAMS_MINE_DEFAUT,
} from "./mine";

describe("emissionBtcParJour", () => {
  it("multiplie le subsidy par 144 blocs/jour (post-halving 2024 : 3,125 → 450)", () => {
    expect(emissionBtcParJour(3.125)).toBeCloseTo(450, 6);
    expect(emissionBtcParJour(6.25)).toBeCloseTo(900, 6);
  });

  it("propage une entrée non finie en NaN", () => {
    expect(Number.isNaN(emissionBtcParJour(NaN))).toBe(true);
    expect(Number.isNaN(emissionBtcParJour(Infinity))).toBe(true);
  });
});

describe("coutElectriqueParBtc", () => {
  // Repère de calcul EXACT du modèle avec les DÉFAUTS de la spec (30 J/TH). La formule
  // est dimensionnellement juste ; 900 EH/s · 30 J/TH · 0,045 $/kWh · 450 BTC/j donne
  // 64 800 $/BTC (27 GW → 648 GWh/j → 29,16 M$/j ÷ 450). Le « ~48,6 k$ » cité dans la
  // spec correspond en réalité à ~22,5 J/TH (lapsus arithmétique de la spec) — cf. rapport.
  it("calcule le coût électrique par BTC aux défauts (30 J/TH) → 64 800 $", () => {
    const cout = coutElectriqueParBtc(900e18, 30, 0.045, 450);
    expect(cout).toBeCloseTo(64_800, 0);
  });

  // Gate spec « ordre de grandeur vs repère Capriole 46,4 k$ » : la même formule reproduit
  // le repère Capriole (mars 2026, élec 46,4 k$) à ~21,5 J/TH — efficacité EFFECTIVE du
  // parc impliquée par Capriole (parc modernisé post-halving, mix S21). C'est le vrai
  // contrôle d'ordre de grandeur externe.
  it("reproduit le repère Capriole (~46,4 k$) à l'efficacité effective ~21,5 J/TH", () => {
    const cout = coutElectriqueParBtc(900e18, 21.5, 0.045, 450);
    expect(cout).toBeGreaterThan(45_000);
    expect(cout).toBeLessThan(48_000);
  });

  it("est linéaire en prix du kWh et en efficacité", () => {
    const base = coutElectriqueParBtc(900e18, 30, 0.045, 450);
    expect(coutElectriqueParBtc(900e18, 30, 0.09, 450)).toBeCloseTo(base * 2, 3);
    expect(coutElectriqueParBtc(900e18, 15, 0.045, 450)).toBeCloseTo(base / 2, 3);
  });

  it("propage toute entrée non finie ou une émission nulle en NaN", () => {
    expect(Number.isNaN(coutElectriqueParBtc(NaN, 30, 0.045, 450))).toBe(true);
    expect(Number.isNaN(coutElectriqueParBtc(900e18, 30, 0.045, 0))).toBe(true);
    expect(Number.isNaN(coutElectriqueParBtc(900e18, NaN, 0.045, 450))).toBe(true);
  });
});

describe("coutAllInParBtc", () => {
  it("applique le multiplicateur all-in au plancher électrique", () => {
    expect(coutAllInParBtc(46_400, 1.25)).toBeCloseTo(58_000, 6);
  });

  it("propage une entrée non finie en NaN", () => {
    expect(Number.isNaN(coutAllInParBtc(NaN, 1.25))).toBe(true);
    expect(Number.isNaN(coutAllInParBtc(46_400, NaN))).toBe(true);
  });
});

describe("hashpriceUsdParPhJour", () => {
  // 144 × (subsidy + fees) × prix / (hashrate / 1e15). À 100 k$, 3,125 BTC, 0,1 BTC/bloc,
  // 900 EH/s → ~51,6 $/PH/j (ordre de grandeur réaliste du hashprice début 2026).
  it("calcule le hashprice $/PH/j (ordre de grandeur réaliste)", () => {
    const hp = hashpriceUsdParPhJour(100_000, 3.125, 0.1, 900e18);
    expect(hp).toBeGreaterThan(45);
    expect(hp).toBeLessThan(60);
  });

  it("croît avec le prix et décroît avec le hashrate", () => {
    const ref = hashpriceUsdParPhJour(100_000, 3.125, 0.1, 900e18);
    expect(hashpriceUsdParPhJour(200_000, 3.125, 0.1, 900e18)).toBeCloseTo(ref * 2, 6);
    expect(hashpriceUsdParPhJour(100_000, 3.125, 0.1, 1800e18)).toBeCloseTo(ref / 2, 6);
  });

  it("propage toute entrée non finie ou un hashrate nul en NaN", () => {
    expect(Number.isNaN(hashpriceUsdParPhJour(NaN, 3.125, 0.1, 900e18))).toBe(true);
    expect(Number.isNaN(hashpriceUsdParPhJour(100_000, 3.125, 0.1, 0))).toBe(true);
  });
});

describe("ratioPrixCout", () => {
  it("divise le prix par le coût", () => {
    expect(ratioPrixCout(100_000, 50_000)).toBeCloseTo(2, 6);
  });

  it("propage une entrée non finie ou un coût nul en NaN", () => {
    expect(Number.isNaN(ratioPrixCout(100_000, 0))).toBe(true);
    expect(Number.isNaN(ratioPrixCout(NaN, 50_000))).toBe(true);
  });
});

describe("PARAMS_MINE_DEFAUT", () => {
  it("expose les défauts de la spec (parc moyen)", () => {
    expect(PARAMS_MINE_DEFAUT).toEqual({
      efficaciteJParTh: 30,
      prixKwhUsd: 0.045,
      multiplicateurAllIn: 1.25,
    });
  });
});
