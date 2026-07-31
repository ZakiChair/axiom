import { describe, expect, it } from "vitest";
import { calculerRegime, tonRegime, type EntreesRegime } from "./regime";

const VIDE: EntreesRegime = {
  directionBtc24hPct: null,
  fearGreed: null,
  fundingBtcPercentile: null,
  dvolBtcPercentile: null,
  volRealiseeBtcPercentile: null,
  fluxEtfJourUsd: null,
  impressionStablecoins7jPct: null,
  regimeGammaBtc: null,
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
    expect(note(90)).toBe(-1);
    expect(note(50)).toBe(0);
    expect(note(10)).toBe(1);
    expect(note(5)).toBe(1);
  });
  it("dvol : calme +1, stress −2", () => {
    const note = (p: number) =>
      calculerRegime({ ...VIDE, dvolBtcPercentile: p }).composants.find((c) => c.id === "dvol")?.note;
    expect(note(30)).toBe(1);
    expect(note(70)).toBe(0);
    expect(note(90)).toBe(-2);
  });
  it("vol réalisée : mêmes paliers que dvol (calme +1, stress −2)", () => {
    const note = (p: number) =>
      calculerRegime({ ...VIDE, volRealiseeBtcPercentile: p }).composants.find((c) => c.id === "volRealisee")?.note;
    expect(note(30)).toBe(1);
    expect(note(70)).toBe(0);
    expect(note(90)).toBe(-2);
  });
  it("vol réalisée et dvol restent commensurables : même percentile → même note", () => {
    // Garde-fou : un futur ajustement de seuils sur UNE seule des deux notes de
    // volatilité rendrait le score incohérent (deux mesures du même phénomène
    // notées différemment). Ce test échoue si les paliers divergent.
    for (const p of [10, 30, 49, 50, 70, 85, 86, 99]) {
      const r = calculerRegime({ ...VIDE, dvolBtcPercentile: p, volRealiseeBtcPercentile: p });
      const dvol = r.composants.find((c) => c.id === "dvol")?.note;
      const volReal = r.composants.find((c) => c.id === "volRealisee")?.note;
      expect(volReal).toBe(dvol);
    }
  });
  it("etf et stablecoins : paliers à ±50 M$ / ±0.5 %", () => {
    expect(calculerRegime({ ...VIDE, fluxEtfJourUsd: 60_000_000 }).composants.find((c) => c.id === "etf")?.note).toBe(1);
    expect(calculerRegime({ ...VIDE, fluxEtfJourUsd: -60_000_000 }).composants.find((c) => c.id === "etf")?.note).toBe(-1);
    expect(calculerRegime({ ...VIDE, impressionStablecoins7jPct: 0.6 }).composants.find((c) => c.id === "stables")?.note).toBe(1);
    expect(calculerRegime({ ...VIDE, impressionStablecoins7jPct: -0.6 }).composants.find((c) => c.id === "stables")?.note).toBe(-1);
  });
  it("detail ETF via le formateur standard (montant signé)", () => {
    const etf = calculerRegime({ ...VIDE, fluxEtfJourUsd: 161_000_000 }).composants.find((c) => c.id === "etf");
    expect(etf?.detail).toContain("+$161");
  });
  it("gamma dealers : long +1, short −1, indéterminé 0, absent null (pas de ±2)", () => {
    const note = (regimeGammaBtc: EntreesRegime["regimeGammaBtc"]) =>
      calculerRegime({ ...VIDE, regimeGammaBtc }).composants.find((c) => c.id === "gammaDealer")?.note;
    expect(note({ regime: "long-gamma", gexNetUsd: 51_000_000 })).toBe(1);
    expect(note({ regime: "short-gamma", gexNetUsd: -51_000_000 })).toBe(-1);
    expect(note({ regime: "indetermine", gexNetUsd: 1_000_000 })).toBe(0);
    expect(note(null)).toBe(null);
  });
  it("detail gamma dealers : régime + net via le formateur standard", () => {
    const detail = (regimeGammaBtc: EntreesRegime["regimeGammaBtc"]) =>
      calculerRegime({ ...VIDE, regimeGammaBtc }).composants.find((c) => c.id === "gammaDealer")?.detail;
    expect(detail({ regime: "long-gamma", gexNetUsd: 51_000_000 })).toBe("γ dealers long (net +$51.00M) (+1)");
    expect(detail({ regime: "short-gamma", gexNetUsd: -51_000_000 })).toBe("γ dealers short (net −$51.00M) (-1)");
    expect(detail({ regime: "indetermine", gexNetUsd: 0 })).toBe("γ dealers indéterminé (net $0.00) (+0)");
    expect(detail(null)).toBe("γ dealers —");
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
  it("les 8 composants sont toujours listés (note null si indisponible)", () => {
    const r = calculerRegime(VIDE);
    expect(r.composants).toHaveLength(8);
    expect(r.composants.map((c) => c.id)).toEqual([
      "btc24h",
      "fearGreed",
      "funding",
      "dvol",
      "volRealisee",
      "etf",
      "stables",
      "gammaDealer",
    ]);
    expect(r.composants.every((c) => c.note === null)).toBe(true);
    expect(r.libelle).toBe("indéterminé");
  });
  it("score = moyenne sur les 8 notes quand toutes sont disponibles", () => {
    // Garde-fou de PONDÉRATION : la volatilité pèse 2 notes sur 8 (dvol +
    // vol réalisée, corrélées). Ce test fige le diviseur — il échoue si un
    // composant est ajouté/retiré sans que la pondération soit reconsidérée.
    const r = calculerRegime({
      directionBtc24hPct: 5, // +2
      fearGreed: 80, // +2
      fundingBtcPercentile: 95, // −1
      dvolBtcPercentile: 90, // −2
      volRealiseeBtcPercentile: 90, // −2
      fluxEtfJourUsd: 60_000_000, // +1
      impressionStablecoins7jPct: 0.6, // +1
      regimeGammaBtc: { regime: "long-gamma", gexNetUsd: 51_000_000 }, // +1
    });
    expect(r.composants).toHaveLength(8);
    expect(r.score).toBeCloseTo(2 / 8, 6);
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
