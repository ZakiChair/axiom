import { describe, expect, it } from "vitest";
import { qualiteBgeometrics, qualitesCoinMetrics, qualitePublicationEtf, traiterPublicationEtfChain, type ValeurPublicationEtf } from "./qualiteChain";
import { actualiserQualite, type QualiteMetrique } from "../qualiteMetrique";

const JOUR = 86_400_000;
const NOW = Date.UTC(2026, 8, 9, 12);

describe("publication qualité Coin Metrics", () => {
  it("déclare chaque métrique vide indisponible au lieu de marquer le bloc frais", () => {
    const entrees = qualitesCoinMetrics({ series: { AdrActCnt: { points: [] }, TxCnt: { points: [] } }, ts: NOW, perime: false }, NOW);
    expect(entrees.map((e) => e.qualite.statut)).toEqual(["indisponible", "indisponible"]);
    expect(entrees.every((e) => e.qualite.observeLe === null)).toBe(true);
  });

  it("isole une métrique ancienne d'une métrique récente et ignore un point futur", () => {
    const entrees = qualitesCoinMetrics({ series: {
      AdrActCnt: { points: [{ time: NOW - 10 * JOUR, value: 1 }], dernier: { time: NOW - 10 * JOUR, value: 1 } },
      TxCnt: { points: [{ time: NOW - JOUR, value: 2 }, { time: NOW + JOUR, value: 3 }], dernier: { time: NOW + JOUR, value: 3 } },
    }, ts: NOW - 1000, perime: false }, NOW);
    expect(entrees.find((e) => e.id === "AdrActCnt")?.qualite.statut).toBe("perime");
    expect(entrees.find((e) => e.id === "TxCnt")?.qualite.observeLe).toBe(NOW - JOUR);
    expect(entrees.find((e) => e.id === "TxCnt")?.qualite.raison).toContain("future");
  });
});

describe("publication qualité BGeometrics (Valorisation)", () => {
  const serie = (time: number, n = 25) => {
    const points = Array.from({ length: n }, (_, i) => ({ time: time - (n - 1 - i) * JOUR, value: i }));
    return { points, dernier: points.at(-1) };
  };

  it("source en retard : donnée récupérée maintenant, ni cache ni repli, raison datée en UTC", () => {
    // 23 h 30 UTC : le 07/09 en UTC, déjà le 08/09 à Paris.
    const q = qualiteBgeometrics({ serie: serie(Date.UTC(2026, 8, 7, 23, 30)), ts: NOW, perime: true, repli: false }, undefined, true, NOW);
    expect(q.sourceEffective).toBe("BGeometrics");
    expect(q.statut).toBe("perime");
    expect(q.raison).toBe("Dernière observation publiée par BGeometrics : 07/09/2026 (source en retard).");
    expect(q.acces).toBe("cle");
  });

  it("valeur resservie après échec : cache BGeometrics, sans raison « source en retard »", () => {
    const q = qualiteBgeometrics({ serie: serie(NOW - JOUR), ts: NOW - 30 * 3600_000, perime: true, repli: true }, undefined, true, NOW);
    expect(q.sourceEffective).toBe("cache BGeometrics");
    expect(q.statut).toBe("perime");
    expect(q.raison ?? "").not.toContain("source en retard");
  });

  it("frais sans raison ; absent indisponible avec motif", () => {
    const frais = qualiteBgeometrics({ serie: serie(NOW - JOUR), ts: NOW, perime: false, repli: false }, undefined, false, NOW);
    expect(frais).toMatchObject({ sourceEffective: "BGeometrics", statut: "frais", acces: "public" });
    expect(frais.raison).toBeUndefined();
    const absent = qualiteBgeometrics(null, undefined, true, NOW);
    expect(absent).toMatchObject({ statut: "indisponible", acces: "indisponible", recupereLe: NOW });
    expect(absent.raison).toContain("indisponible");
  });
});

describe("publication qualité ETF CHAIN", () => {
  it("conserve la règle des cinq jours entiers jusqu'au changement de jour UTC", () => {
    const observation = Date.UTC(2026, 8, 4);
    const q = qualitePublicationEtf("btc", { actif: "btc", principal: {
      disponible: true, total: 100, jour: "2026-09-04", recupereLe: NOW,
    }, repli: null }, undefined, undefined, NOW);
    expect(q.statut).toBe("frais");
    expect(actualiserQualite(q, observation + 6 * JOUR - 1).statut).toBe("frais");
    expect(actualiserQualite(q, observation + 6 * JOUR).statut).toBe("perime");
  });
  const precedente: QualiteMetrique = {
    sourceId: "sosovalue", sourceEffective: "cache SoSoValue", observeLe: NOW - 10 * JOUR,
    recupereLe: NOW - 9 * JOUR, cadenceMs: JOUR, couverture: null, estime: false, acces: "cle", statut: "perime",
  };

  it("un timeout marque la source en panne tout en conservant les dates de l'ancienne lecture", () => {
    const q = qualitePublicationEtf("btc", null, "Délai réseau dépassé", precedente, NOW);
    expect(q.statut).toBe("indisponible");
    expect(q.observeLe).toBe(precedente.observeLe);
    expect(q.recupereLe).toBe(precedente.recupereLe);
    expect(q.raison).toContain("Délai réseau dépassé");
  });

  it("la branche intégrée conserve la valeur affichée et remplace toujours sa qualité après timeout", () => {
    const valeursAffichees: ValeurPublicationEtf[] = [];
    let qualite: QualiteMetrique | undefined;
    const succes = { actif: "btc" as const, principal: { disponible: true, total: 100, jour: "2026-09-08", recupereLe: NOW - 1000 }, repli: null };
    traiterPublicationEtfChain({ actif: "btc", valeur: succes, erreur: undefined, precedente: undefined, now: NOW,
      appliquerValeur: (v) => { valeursAffichees.push(v); }, appliquerQualite: (q) => { qualite = q; } });
    traiterPublicationEtfChain({ actif: "btc", valeur: null, erreur: "Délai réseau dépassé", precedente: qualite, now: NOW + 60_000,
      appliquerValeur: (v) => { valeursAffichees.push(v); }, appliquerQualite: (q) => { qualite = q; } });
    expect(valeursAffichees).toHaveLength(1);
    expect(valeursAffichees[0]?.principal.total).toBe(100);
    expect(qualite?.statut).toBe("indisponible");
    expect(qualite?.observeLe).toBe(Date.UTC(2026, 8, 8));
    expect(qualite?.recupereLe).toBe(NOW - 1000);
  });

  it.each([
    [false, "BGeometrics (repli)"],
    [true, "cache BGeometrics (repli)"],
  ] as const)("repli BTC resservi=%s : source effective %s, statut périmé inchangé", (estRepli, source) => {
    const dernier = { time: NOW - 10 * JOUR, value: 5 };
    const q = qualitePublicationEtf("btc", { actif: "btc", principal: { disponible: false, raison: "SoSoValue HS" },
      repli: { serie: { points: [dernier], dernier }, ts: NOW - 1000, perime: true, repli: estRepli } }, undefined, undefined, NOW);
    expect(q.sourceEffective).toBe(source);
    expect(q.statut).toBe("perime");
  });

  it.each([
    [false, "partiel"],
    [true, "perime"],
  ] as const)("repli BTC observé il y a 4 j (lendemain de week-end), resservi=%s : statut %s selon la règle ETF de 5 jours", (estRepli, statut) => {
    const dernier = { time: NOW - 4 * JOUR, value: 5 };
    // `perime` vaut true dès 3 jours côté BGeometrics ; seule la séance ETF (5 j) ou un cache resservi compte ici.
    const q = qualitePublicationEtf("btc", { actif: "btc", principal: { disponible: false, raison: "SoSoValue HS" },
      repli: { serie: { points: [dernier], dernier }, ts: NOW - 1000, perime: true, repli: estRepli } }, undefined, undefined, NOW);
    expect(q.statut).toBe(statut);
  });

  it.each([
    [undefined, "partiel"],
    ["date-invalide", "partiel"],
    ["2026-09-10", "partiel"],
    ["2026-09-01", "perime"],
  ] as const)("date %s produit le statut %s", (jour, statut) => {
    const q = qualitePublicationEtf("btc", { actif: "btc", principal: {
      disponible: true, total: 10, ...(jour === undefined ? {} : { jour }), recupereLe: NOW - 1000,
    }, repli: null }, undefined, undefined, NOW);
    expect(q.statut).toBe(statut);
    expect(q.recupereLe).toBe(NOW - 1000);
  });
});
