import { describe, expect, it } from "vitest";
import {
  cboeExpiries,
  cboeOptionsToLegs,
  parseCboeOptionSymbol,
  type CboeOption,
} from "./cboe";

describe("parseCboeOptionSymbol", () => {
  it("parse un call SPX réel (SPX260717C06530000 → strike 6530)", () => {
    const p = parseCboeOptionSymbol("SPX260717C06530000");
    expect(p).toEqual({
      root: "SPX",
      expiryMs: Date.UTC(2026, 6, 17),
      type: "call",
      strike: 6530,
    });
  });

  it("parse un put SPX profondément OTM (SPX260717P00800000 → strike 800)", () => {
    const p = parseCboeOptionSymbol("SPX260717P00800000");
    expect(p?.type).toBe("put");
    expect(p?.strike).toBe(800);
    expect(p?.root).toBe("SPX");
  });

  it("parse un ticker NDX (racine 3 lettres) et VIX", () => {
    const ndx = parseCboeOptionSymbol("NDX261218C25000000");
    expect(ndx?.root).toBe("NDX");
    expect(ndx?.strike).toBe(25000);
    expect(ndx?.expiryMs).toBe(Date.UTC(2026, 11, 18));
    const vix = parseCboeOptionSymbol("VIX260121C00020000");
    expect(vix?.root).toBe("VIX");
    expect(vix?.strike).toBe(20);
    expect(vix?.type).toBe("call");
  });

  it("gère un strike fractionnaire (×1000 → décimales)", () => {
    // 00012500 → 12,50.
    const p = parseCboeOptionSymbol("VIX260121P00012500");
    expect(p?.strike).toBe(12.5);
  });

  it("gère une racine avec chiffre (weekly SPXW / racine alphanumérique)", () => {
    const p = parseCboeOptionSymbol("SPXW260717C06000000");
    expect(p?.root).toBe("SPXW");
    expect(p?.strike).toBe(6000);
  });

  it("renvoie null sur format invalide", () => {
    expect(parseCboeOptionSymbol("")).toBeNull();
    expect(parseCboeOptionSymbol("SPX")).toBeNull();
    expect(parseCboeOptionSymbol("SPX260717X06530000")).toBeNull(); // ni C ni P
    expect(parseCboeOptionSymbol("SPX261317C06530000")).toBeNull(); // mois 13 invalide
    expect(parseCboeOptionSymbol("SPX260732C06530000")).toBeNull(); // jour 32 invalide
    expect(parseCboeOptionSymbol("260717C06530000")).toBeNull(); // racine manquante
  });
});

describe("cboeExpiries", () => {
  const now = Date.UTC(2026, 6, 1);
  const opts: CboeOption[] = [
    { option: "SPX260717C06000000", open_interest: 1, delta: 0.5, gamma: 0.01, iv: 0.3 },
    { option: "SPX260717P06000000", open_interest: 1, delta: -0.5, gamma: 0.01, iv: 0.3 },
    { option: "SPX260918C06000000", open_interest: 1, delta: 0.5, gamma: 0.01, iv: 0.3 },
    { option: "SPX250101C06000000", open_interest: 1, delta: 0.5, gamma: 0.01, iv: 0.3 }, // passé
    { option: "GARBAGE", open_interest: 1, delta: 0.5, gamma: 0.01, iv: 0.3 }, // ignoré
  ];

  it("liste les échéances futures distinctes, triées, avec comptage", () => {
    const exp = cboeExpiries(opts, now);
    expect(exp).toEqual([
      { expiryMs: Date.UTC(2026, 6, 17), count: 2 },
      { expiryMs: Date.UTC(2026, 8, 18), count: 1 },
    ]);
  });

  it("tolère une expiration du jour même (grâce d'un jour)", () => {
    // now à 20h UTC le 2026-07-17 ; l'expiry à 00:00 UTC du même jour reste visible.
    const memeJour = Date.UTC(2026, 6, 17, 20, 0, 0);
    const exp = cboeExpiries(
      [{ option: "SPX260717C06000000", open_interest: 1, delta: 0.5, gamma: 0.01, iv: 0.3 }],
      memeJour,
    );
    expect(exp).toHaveLength(1);
    expect(exp[0]?.expiryMs).toBe(Date.UTC(2026, 6, 17));
  });
});

describe("cboeOptionsToLegs", () => {
  const opts: CboeOption[] = [
    { option: "SPX260717C06000000", open_interest: 10, delta: 0.6, gamma: 0.02, iv: 0.3 },
    { option: "SPX260717P06000000", open_interest: 5, delta: -0.4, gamma: 0.03, iv: 0.3 },
    { option: "SPX260918C06000000", open_interest: 7, delta: 0.5, gamma: 0.01, iv: 0.3 }, // autre échéance
    { option: "BADSYMBOL", open_interest: 1, delta: 0.5, gamma: 0.01, iv: 0.3 }, // ignoré
  ];

  it("ne retient que l'échéance demandée et mappe delta/gamma (signés côté CBOE)", () => {
    const legs = cboeOptionsToLegs(opts, Date.UTC(2026, 6, 17));
    expect(legs).toEqual([
      { strike: 6000, type: "call", openInterest: 10, delta: 0.6, gamma: 0.02 },
      { strike: 6000, type: "put", openInterest: 5, delta: -0.4, gamma: 0.03 },
    ]);
  });

  it("remplace les greeks non finis par 0 (dégradation gracieuse)", () => {
    const legs = cboeOptionsToLegs(
      [{ option: "SPX260717C06000000", open_interest: NaN, delta: NaN, gamma: NaN, iv: 0.3 }],
      Date.UTC(2026, 6, 17),
    );
    expect(legs[0]).toEqual({
      strike: 6000,
      type: "call",
      openInterest: 0,
      delta: 0,
      gamma: 0,
    });
  });
});
