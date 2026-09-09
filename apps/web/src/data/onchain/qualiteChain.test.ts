import { describe, expect, it } from "vitest";
import { qualitesCoinMetrics, qualitePublicationEtf, traiterPublicationEtfChain, type ValeurPublicationEtf } from "./qualiteChain";
import type { QualiteMetrique } from "../qualiteMetrique";

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

describe("publication qualité ETF CHAIN", () => {
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
