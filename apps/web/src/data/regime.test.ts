import { describe, expect, it } from "vitest";
import { calculerRegime, tonRegime, type EntreesRegime } from "./regime";

const VIDE: EntreesRegime = {
  directionBtc24hPct: null,
  fearGreed: null,
  fundingBtcPercentile: null,
  dvolBtcPercentile: null,
  fluxEtfJourUsd: null,
  impressionStablecoins7jPct: null,
};

describe("calculerRegime — notes par composant", () => {
  it("direction BTC : bornes des 5 paliers", () => {
    const note = (pct: number) =>
      calculerRegime({ ...VIDE, directionBtc24hPct: pct }).composants.find((c) => c.id === "btc24h")?.note;
    expect(note(3)).toBe(2);
    expect(note(1.5)).toBe(1);
    expect(note(0)).toBe(0);
    expect(note(-1.5)).toBe(-1);
    expect(note(-3)).toBe(-2);
  });
  it("fear & greed : 75→+2, 60→+1, 50→0, 30→−1, 24→−2", () => {
    const note = (v: number) =>
      calculerRegime({ ...VIDE, fearGreed: v }).composants.find((c) => c.id === "fearGreed")?.note;
    expect(note(75)).toBe(2);
    expect(note(60)).toBe(1);
    expect(note(50)).toBe(0);
    expect(note(30)).toBe(-1);
    expect(note(24)).toBe(-2);
  });
  it("funding : contrarien léger aux extrêmes", () => {
    const note = (p: number) =>
      calculerRegime({ ...VIDE, fundingBtcPercentile: p }).composants.find((c) => c.id === "funding")?.note;
    expect(note(95)).toBe(-1);
    expect(note(50)).toBe(0);
    expect(note(5)).toBe(1);
  });
  it("dvol : calme +1, stress −2", () => {
    const note = (p: number) =>
      calculerRegime({ ...VIDE, dvolBtcPercentile: p }).composants.find((c) => c.id === "dvol")?.note;
    expect(note(30)).toBe(1);
    expect(note(70)).toBe(0);
    expect(note(90)).toBe(-2);
  });
  it("etf et stablecoins : paliers à ±50 M$ / ±0.5 %", () => {
    expect(calculerRegime({ ...VIDE, fluxEtfJourUsd: 60_000_000 }).composants.find((c) => c.id === "etf")?.note).toBe(1);
    expect(calculerRegime({ ...VIDE, fluxEtfJourUsd: -60_000_000 }).composants.find((c) => c.id === "etf")?.note).toBe(-1);
    expect(calculerRegime({ ...VIDE, impressionStablecoins7jPct: 0.6 }).composants.find((c) => c.id === "stables")?.note).toBe(1);
    expect(calculerRegime({ ...VIDE, impressionStablecoins7jPct: -0.6 }).composants.find((c) => c.id === "stables")?.note).toBe(-1);
  });
});

describe("calculerRegime — score et libellé", () => {
  it("moins de 3 composants disponibles → indéterminé", () => {
    const r = calculerRegime({ ...VIDE, directionBtc24hPct: 5, fearGreed: 80 });
    expect(r.libelle).toBe("indéterminé");
  });
  it("score = moyenne des notes non-null, libellés par paliers", () => {
    const r = calculerRegime({ ...VIDE, directionBtc24hPct: 5, fearGreed: 80, dvolBtcPercentile: 30 });
    // notes : +2, +2, +1 → score 5/3 ≈ 1.67 → risk-on tendu
    expect(r.score).toBeCloseTo(5 / 3, 6);
    expect(r.libelle).toBe("risk-on tendu");
    const r2 = calculerRegime({ ...VIDE, directionBtc24hPct: -5, fearGreed: 10, dvolBtcPercentile: 90 });
    expect(r2.libelle).toBe("risk-off marqué");
    const r3 = calculerRegime({ ...VIDE, directionBtc24hPct: 0, fearGreed: 50, dvolBtcPercentile: 70 });
    expect(r3.libelle).toBe("neutre");
  });
  it("les 6 composants sont toujours listés (note null si indisponible)", () => {
    const r = calculerRegime(VIDE);
    expect(r.composants).toHaveLength(6);
    expect(r.composants.every((c) => c.note === null)).toBe(true);
    expect(r.libelle).toBe("indéterminé");
  });
});

describe("tonRegime", () => {
  it("risk-on* → up, risk-off* → down, neutre/indéterminé → neutre", () => {
    expect(tonRegime("risk-on tendu")).toBe("up");
    expect(tonRegime("risk-on")).toBe("up");
    expect(tonRegime("neutre")).toBe("neutre");
    expect(tonRegime("indéterminé")).toBe("neutre");
    expect(tonRegime("risk-off")).toBe("down");
    expect(tonRegime("risk-off marqué")).toBe("down");
  });
});
