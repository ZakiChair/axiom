import { describe, expect, it } from "vitest";
import { filtrerFenetre, finDePeriode, periodeVersMs, trierChrono } from "./harmonisation";

describe("periodeVersMs", () => {
  it("convertit une période mensuelle SDMX en début de mois UTC", () => {
    expect(periodeVersMs("2026-05")).toBe(Date.UTC(2026, 4, 1));
    expect(periodeVersMs("2026-12")).toBe(Date.UTC(2026, 11, 1));
  });

  it("convertit une période trimestrielle en début de trimestre UTC", () => {
    expect(periodeVersMs("2026-Q1")).toBe(Date.UTC(2026, 0, 1));
    expect(periodeVersMs("2026-Q2")).toBe(Date.UTC(2026, 3, 1));
    expect(periodeVersMs("2026-Q4")).toBe(Date.UTC(2026, 9, 1));
  });

  it("renvoie NaN sur une forme inconnue plutôt que de deviner", () => {
    expect(periodeVersMs("2026")).toBeNaN();
    expect(periodeVersMs("2026-13")).toBeNaN();
    expect(periodeVersMs("2026-Q5")).toBeNaN();
    expect(periodeVersMs("")).toBeNaN();
  });
});

describe("finDePeriode", () => {
  // Le cas de la spec : un PIB du T2 2026 ne doit pas être jugé périmé le
  // 2026-09-06 sous prétexte que sa période COMMENCE le 1er avril.
  it("date un trimestre à son dernier instant", () => {
    const fin = finDePeriode(Date.UTC(2026, 3, 1), "Q");
    expect(new Date(fin).toISOString().slice(0, 10)).toBe("2026-06-30");
  });

  it("date un mois à son dernier instant", () => {
    const fin = finDePeriode(Date.UTC(2026, 6, 1), "M");
    expect(new Date(fin).toISOString().slice(0, 10)).toBe("2026-07-31");
  });

  it("gère le passage d'année et les mois courts", () => {
    expect(new Date(finDePeriode(Date.UTC(2026, 11, 1), "M")).toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(new Date(finDePeriode(Date.UTC(2024, 1, 1), "M")).toISOString().slice(0, 10)).toBe("2024-02-29");
    expect(new Date(finDePeriode(Date.UTC(2026, 9, 1), "Q")).toISOString().slice(0, 10)).toBe("2026-12-31");
  });
});

describe("trierChrono", () => {
  // L'OCDE renvoie ses TIME_PERIOD DANS LE DÉSORDRE — vérifié en live le 2026-09-06 :
  // ['2026-05', '2026-07', '2026-06']. Sans ce tri, la courbe zigzague.
  it("trie par temps croissant sans muter l'entrée", () => {
    const entree = [
      { time: Date.UTC(2026, 4, 1), value: 1.2 },
      { time: Date.UTC(2026, 6, 1), value: 0.5 },
      { time: Date.UTC(2026, 5, 1), value: 1 },
    ];
    const copie = [...entree];
    const sortie = trierChrono(entree);
    expect(sortie.map((p) => p.value)).toEqual([1.2, 1, 0.5]);
    expect(entree).toEqual(copie);
  });
});

describe("filtrerFenetre", () => {
  it("garde les points au-delà de la borne incluse", () => {
    const serie = [
      { time: Date.UTC(2019, 0, 1), value: 1 },
      { time: Date.UTC(2020, 0, 1), value: 2 },
      { time: Date.UTC(2021, 0, 1), value: 3 },
    ];
    expect(filtrerFenetre(serie, Date.UTC(2020, 0, 1)).map((p) => p.value)).toEqual([2, 3]);
  });
});

describe("transformations calendaires macro", () => {
  it("ne confond pas douze observations et douze mois quand un mois manque", async () => {
    const { variationPeriode } = await import("./harmonisation");
    const points = [{ time: Date.UTC(2025, 0, 1), value: 100 }, { time: Date.UTC(2025, 2, 1), value: 110 }, { time: Date.UTC(2026, 0, 1), value: 120 }, { time: Date.UTC(2026, 1, 1), value: 130 }];
    expect(variationPeriode(points, 12)).toEqual([{ time: Date.UTC(2026, 0, 1), value: 20 }]);
  });
  it("calcule le PIB a/a sur le même trimestre et garde une baisse", async () => {
    const { variationPeriode } = await import("./harmonisation");
    expect(variationPeriode([{ time: Date.UTC(2025, 3, 1), value: 200 }, { time: Date.UTC(2026, 3, 1), value: 190 }], 12)[0]?.value).toBeCloseTo(-5);
  });
  it("calcule le m/m exact et écarte un dénominateur nul", async () => {
    const { variationPeriode } = await import("./harmonisation");
    expect(variationPeriode([{ time: Date.UTC(2026, 0, 1), value: 0 }, { time: Date.UTC(2026, 1, 1), value: 100 }, { time: Date.UTC(2026, 2, 1), value: 102 }], 1)).toEqual([{ time: Date.UTC(2026, 2, 1), value: 2 }]);
  });
  it("date le chômage UK du mois central à la fin du trimestre glissant", () => {
    expect(new Date(finDePeriode(Date.UTC(2026, 4, 1), "M", 1)).toISOString().slice(0, 10)).toBe("2026-06-30");
  });
  it("ne transforme pas les observations journalières et hebdomadaires en fin de mois", () => {
    expect(finDePeriode(Date.UTC(2026, 8, 4), "D")).toBe(Date.UTC(2026, 8, 4));
    expect(finDePeriode(Date.UTC(2026, 8, 5), "W")).toBe(Date.UTC(2026, 8, 5));
  });
  it("calcule SOFR–IORB uniquement aux dates communes, en points de base", async () => {
    const { differenceDatesCommunes } = await import("./harmonisation");
    expect(differenceDatesCommunes([{ time: 1, value: 4.1 }, { time: 2, value: 4.2 }], [{ time: 1, value: 4.3 }, { time: 3, value: 4.4 }], 100)).toEqual([{ time: 1, value: expect.closeTo(-20) }]);
  });
});

it("garde le caractère estimé d'une base utilisée dans une variation annuelle", async () => {
  const { variationPeriode } = await import("./harmonisation");
  const points = [{ time: Date.UTC(2025, 0, 1), value: 100, qualite: "estimation" }, { time: Date.UTC(2026, 0, 1), value: 110 }];
  expect(variationPeriode(points, 12)[0]?.qualite).toContain("estimation");
});
