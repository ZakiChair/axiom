import { describe, expect, it } from "vitest";
import { ajusterOls, estimerMultifactoriel, appliquerChocMultifactoriel, cutoffScen, variationsDatees } from "./scenMultifactor";

const oracle = [
  [0.01, 0.01, 0.011], [-0.01, 0, -0.019],
  [0.01, 0, 0.021], [-0.01, -0.01, -0.009],
];
const identite = (symbol: string, source = "binance") => ({ symbol, source, quote: "USDT", session: "UTC", convention: "close-1d" });
const serie = (symbol: string, rendements: number[], source = "binance") => {
  let value = 100;
  return { identite: identite(symbol, source), unite: "prix" as const, points: [
    { date: "2026-01-01", valeur: value },
    ...rendements.map((r, i) => {
      value *= Math.exp(r);
      return { date: new Date(Date.UTC(2026, 0, i + 2)).toISOString().slice(0, 10), valeur: value };
    }),
  ] };
};

describe("OLS conjointe", () => {
  it("retrouve les bêtas conjoints et l'intercept de l'oracle, sans additionner les simples", () => {
    const fit = ajusterOls(oracle.map((r) => r.slice(0, 2)), oracle.map((r) => r[2]!));
    expect(fit.statut).toBe("ok");
    if (fit.statut !== "ok") return;
    expect(fit.alpha).toBeCloseTo(0.001, 10);
    expect(fit.beta[0]).toBeCloseTo(2, 10);
    expect(fit.beta[1]).toBeCloseTo(-1, 10);
    expect(fit.r2).toBeCloseTo(1, 10);
  });
  it("refuse une constante et une dépendance de rang supérieur", () => {
    expect(ajusterOls([[1], [1], [1]], [1, 2, 3]).statut).toBe("refus");
    const x = Array.from({ length: 40 }, (_, i) => [i % 7, i % 11, (i % 7) + (i % 11)]);
    expect(ajusterOls(x, x.map((r) => r[0]!)).statut).toBe("refus");
  });
});

describe("dates et scénario", () => {
  it("ne joint que les couples de dates réellement identiques, sans remplir un week-end", () => {
    const a = { identite: identite("BTCUSDT"), unite: "prix" as const, points: [
      { date: "2026-01-02", valeur: 100 }, { date: "2026-01-03", valeur: 101 }, { date: "2026-01-04", valeur: 102 }, { date: "2026-01-05", valeur: 103 },
    ] };
    const b = { identite: identite("SPY", "twelvedata"), unite: "prix" as const, points: [
      { date: "2026-01-02", valeur: 100 }, { date: "2026-01-05", valeur: 101 },
    ] };
    expect(variationsDatees(a, "2026-01-10").map((v) => `${v.debut}/${v.fin}`)).toEqual([
      "2026-01-02/2026-01-03", "2026-01-03/2026-01-04", "2026-01-04/2026-01-05",
    ]);
    const fit = estimerMultifactoriel({ actif: a, facteurs: { spx: b }, selection: ["spx"], fenetreJours: 90, maintenant: Date.UTC(2026, 0, 10) });
    expect(fit.statut).toBe("indisponible");
    expect(fit.n).toBe(0);
  });
  it("une date invalide casse les deux variations voisines ; un vrai vendredi→lundi garde sa durée", () => {
    const s = { identite: identite("SOLUSDT"), unite: "prix" as const, points: [
      { date: "2026-01-01", valeur: 100 }, { date: "2026-01-02", valeur: NaN }, { date: "2026-01-03", valeur: 121 },
    ] };
    expect(variationsDatees(s, "2026-01-10")).toEqual([]);
    const semaine = { ...s, points: [{ date: "2026-01-02", valeur: 100 }, { date: "2026-01-05", valeur: 110 }] };
    expect(variationsDatees(semaine, "2026-01-10")).toEqual([{ debut: "2026-01-02", fin: "2026-01-05", valeur: Math.log(1.1), jours: 3 }]);
  });
  it("applique le cutoff D−2 et traite DFII10 en différence de points de pourcentage", () => {
    const taux = { identite: { symbol: "DFII10", source: "fred", quote: "%", session: "date", convention: "observation" }, unite: "taux-pct" as const, points: [
      { date: "2026-01-01", valeur: -0.2 }, { date: "2026-01-02", valeur: 0.05 }, { date: "2026-01-09", valeur: 0.1 },
    ] };
    expect(variationsDatees(taux, cutoffScen(Date.UTC(2026, 0, 10)))).toEqual([{ debut: "2026-01-01", fin: "2026-01-02", valeur: 0.25, jours: 1 }]);
    const res = appliquerChocMultifactoriel({ btc: 2, spx: -1, taux: -0.04 }, { btc: 10, spx: -5, taux: 25 }, 10_000);
    expect(res.statut).toBe("ok");
    if (res.statut === "ok") {
      expect(res.pnl).toBeCloseTo(10_000 * (Math.exp(2 * Math.log(1.1) - Math.log(0.95) - 0.01) - 1), 5);
      expect(res.contributions.taux).toBeCloseTo(-0.01, 10);
    }
  });
  it("signale l'exposition directe seulement pour l'identité complète et refuse le facteur absent", () => {
    const actif = serie("BTCUSDT", Array.from({ length: 45 }, (_, i) => (i % 5 - 2) / 100));
    expect(estimerMultifactoriel({ actif, facteurs: { btc: actif }, selection: ["btc"], fenetreJours: 90, maintenant: Date.UTC(2026, 3, 1) }).statut).toBe("directe");
    expect(estimerMultifactoriel({ actif, facteurs: { btc: serie("BTCUSDT", [], "kraken") }, selection: ["btc"], fenetreJours: 90, maintenant: Date.UTC(2026, 3, 1) }).statut).toBe("indisponible");
    expect(estimerMultifactoriel({ actif, facteurs: {}, selection: ["btc"], fenetreJours: 90, maintenant: Date.UTC(2026, 3, 1) }).raison).toMatch(/absent/);
    const court = serie("SOLUSDT", Array.from({ length: 29 }, (_, i) => (i % 5 - 2) / 100));
    expect(estimerMultifactoriel({ actif: court, facteurs: { btc: serie("BTCUSDT", Array.from({ length: 29 }, (_, i) => (i % 5 - 2) / 100)) }, selection: ["btc"], fenetreJours: 90, maintenant: Date.UTC(2026, 3, 1) }).raison).toMatch(/insuffisantes/);
  });
});
