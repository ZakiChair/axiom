import { describe, expect, it } from "vitest";
import { calculerQuadrants, dernierMoisCommunCalcule, lecturesQuadrants } from "./quadrants";
import type { EtatSerie } from "../../store/macroSeries";

const mois = (m: number): number => Date.UTC(2026, m - 1, 1);
function etat(valeurs: Array<[number, number]>, contexteConnuLe: string | null = null): EtatSerie {
  return { statut: "ok", points: valeurs.map(([m, value]) => ({ time: mois(m), value })), majTs: mois(valeurs.at(-1)?.[0] ?? 1), message: null, recupereTs: Date.UTC(2026, 8, 1), contexteConnuLe };
}

describe("quadrants macro à mois commun", () => {
  it("retient juillet stable malgré CPI août seul, et signale août partiel sans revenir au dernier quadrant directionnel", () => {
    const resultat = calculerQuadrants({
      "production-aa-ez": etat([[3, 1], [4, 1], [5, 1], [6, 2], [7, 2]]),
      "cpi-aa-ez": etat([[3, 3], [4, 3], [5, 3], [6, 2], [7, 3], [8, 4]]),
    }, { regions: ["EZ"], maintenant: Date.UTC(2026, 8, 23) });
    const zone = resultat.regions[0]!;
    expect(zone.points.at(-1)?.mois).toBe("2026-08");
    expect(dernierMoisCommunCalcule(zone)?.mois).toBe("2026-07");
    expect(dernierMoisCommunCalcule(zone)?.inflation.sens).toBe("stable");
    expect(dernierMoisCommunCalcule(zone)?.quadrant).toBeNull();
    expect(lecturesQuadrants(resultat)[0]).toMatchObject({ id: "macro:EZ:2026-07:courant", observeLe: null });
    expect(lecturesQuadrants(resultat)[0]?.limites.join(" ")).toMatch(/partiels.*2026-08/i);
  });
  it("calcule M−M3 en points avec quatre mois consécutifs et sépare le contexte PIB", () => {
    const resultat = calculerQuadrants({
      "production-aa-us": etat([[4, 1], [5, 1.2], [6, 1.5], [7, 2]]),
      "cpi-aa-us": etat([[4, 3], [5, 2.8], [6, 2.5], [7, 2]]),
      "pib-aa-us": { ...etat([[4, 2.1]]), points: [{ time: mois(4), value: 2.1 }] },
    }, { regions: ["US"], maintenant: Date.UTC(2026, 8, 2) });
    const dernier = resultat.regions[0]?.points.at(-1);
    expect(dernier?.mois).toBe("2026-07");
    expect(dernier?.croissance).toMatchObject({ sens: "accelere", courant: 2, precedent: 1, deltaPp: 1, periodePrecedente: "2026-04", periodeCourante: "2026-07", perimetre: "industrie hors construction · désaisonnalisé" });
    expect(dernier?.inflation).toMatchObject({ sens: "decelere", courant: 2, precedent: 3, deltaPp: -1 });
    expect(dernier?.quadrant).toBe("croissance-accelere-inflation-decelere");
    expect(dernier?.pib).toMatchObject({ valeur: 2.1, periode: "T2 2026" });
    expect(dernier?.finPeriode).toBe(Date.UTC(2026, 6, 31, 23, 59, 59, 999));
  });

  it("un mois intermédiaire manquant laisse l'axe inconnu, jamais une comparaison de points éloignés", () => {
    const resultat = calculerQuadrants({
      "production-aa-us": etat([[4, 1], [6, 1.5], [7, 2]]),
      "cpi-aa-us": etat([[4, 3], [5, 2.8], [6, 2.5], [7, 2]]),
    }, { regions: ["US"], maintenant: Date.UTC(2026, 8, 2) });
    const dernier = resultat.regions[0]?.points.at(-1);
    expect(dernier?.croissance.sens).toBe("inconnu");
    expect(dernier?.quadrant).toBeNull();
  });

  it("un axe stable ne force pas un quadrant et une transition exige deux quadrants connus", () => {
    const resultat = calculerQuadrants({
      "production-aa-us": etat([[1, 1], [2, 1], [3, 1], [4, 2], [5, 2], [6, 2], [7, 2]]),
      "cpi-aa-us": etat([[1, 3], [2, 3], [3, 3], [4, 2], [5, 2], [6, 2], [7, 2]]),
    }, { regions: ["US"], maintenant: Date.UTC(2026, 8, 2) });
    expect(resultat.regions[0]?.points.find((p) => p.mois === "2026-04")?.quadrant).toBe("croissance-accelere-inflation-decelere");
    expect(resultat.regions[0]?.points.at(-1)?.croissance.sens).toBe("stable");
    expect(resultat.regions[0]?.points.at(-1)?.quadrant).toBeNull();
    expect(resultat.regions[0]?.points.at(-1)?.transition).toBeNull();
  });

  it("date la transition seulement après deux mois classés consécutifs", () => {
    const resultat = calculerQuadrants({
      "production-aa-us": etat([[1, 1], [2, 1.5], [3, 1.5], [4, 2], [5, 1]]),
      "cpi-aa-us": etat([[1, 3], [2, 2.5], [3, 2.5], [4, 2], [5, 3]]),
    }, { regions: ["US"], maintenant: Date.UTC(2026, 5, 2) });
    expect(resultat.regions[0]?.points.at(-1)?.transition).toEqual({
      de: "croissance-accelere-inflation-decelere",
      vers: "croissance-decelere-inflation-accelere",
    });
  });

  it("une période courante ancienne mais disponible reste classée et sa preuve suit la récupération", () => {
    const resultat = calculerQuadrants({
      "production-aa-us": etat([[4, 1], [5, 1.2], [6, 1.5], [7, 2]]),
      "cpi-aa-us": etat([[4, 3], [5, 2.8], [6, 2.5], [7, 2]]),
    }, { regions: ["US"], maintenant: Date.UTC(2026, 8, 23) });
    expect(resultat.regions[0]?.points.at(-1)?.quadrant).toBe("croissance-accelere-inflation-decelere");
    expect(lecturesQuadrants(resultat)[0]?.validiteJusqua).toBe(Date.UTC(2026, 8, 2));
  });

  it("reconstitue la vue ALFRED ancienne à sa date civile malgré la date réelle d'analyse", () => {
    const ancien = (valeurs: Array<[number, number]>) => ({
      ...etat([]), contexteConnuLe: "2025-08-15", recupereTs: Date.UTC(2026, 8, 23),
      points: valeurs.map(([m, value]) => ({ time: Date.UTC(2025, m - 1, 1), value })),
    });
    const resultat = calculerQuadrants({
      "production-aa-us": ancien([[4, 1], [5, 1.2], [6, 1.5], [7, 2]]),
      "cpi-aa-us": ancien([[4, 3], [5, 2.8], [6, 2.5], [7, 2]]),
    }, { regions: ["US"], connuLe: "2025-08-15", maintenant: Date.UTC(2026, 8, 23) });
    expect(resultat.regions[0]?.points.at(-1)?.quadrant).toBe("croissance-accelere-inflation-decelere");
    expect(resultat.regions[0]?.points.at(-1)?.mois).toBe("2025-07");
    expect(lecturesQuadrants(resultat)[0]?.statut).toBe("partiel");
  });

  it("garde une lecture descriptive du cache conservé et marque sa preuve périmée", () => {
    const production = { ...etat([[4, 1], [5, 1.2], [6, 1.5], [7, 2]]), statut: "panne" as const, perime: true, message: "Source indisponible." };
    const resultat = calculerQuadrants({
      "production-aa-us": production,
      "cpi-aa-us": etat([[4, 3], [5, 2.8], [6, 2.5], [7, 2]]),
    }, { regions: ["US"], maintenant: Date.UTC(2026, 8, 2) });
    expect(resultat.regions[0]?.points.at(-1)?.quadrant).toBe("croissance-accelere-inflation-decelere");
    expect(resultat.regions[0]?.points.at(-1)?.croissance.perime).toBe(true);
    expect(lecturesQuadrants(resultat)[0]?.statut).toBe("perime");
    expect(lecturesQuadrants(resultat)[0]?.limites).toContain("Source indisponible.");
  });

  it("expire la preuve commune avec la plus ancienne récupération des deux axes", () => {
    const resultat = calculerQuadrants({
      "production-aa-us": etat([[4, 1], [5, 1.2], [6, 1.5], [7, 2]]),
      "cpi-aa-us": { ...etat([[4, 3], [5, 2.8], [6, 2.5], [7, 2]]), recupereTs: Date.UTC(2026, 8, 23) },
    }, { regions: ["US"], maintenant: Date.UTC(2026, 8, 23) });
    const preuve = lecturesQuadrants(resultat)[0];
    expect(preuve?.recupereLe).toBe(Date.UTC(2026, 8, 23));
    expect(preuve?.validiteJusqua).toBe(Date.UTC(2026, 8, 2));
  });

  it("explique l'absence de clé lorsque la famille FRED n'a pas chargé", () => {
    const sansCle: EtatSerie = { statut: "sansCle", points: [], majTs: null, message: "Clé FRED absente.", contexteConnuLe: null };
    const resultat = calculerQuadrants({ "production-aa-us": sansCle, "cpi-aa-us": sansCle }, { regions: ["US"], maintenant: Date.UTC(2026, 8, 2) });
    expect(resultat.regions[0]?.raison).toContain("Clé FRED absente");
  });

  it("une vue connue au refuse les sources non ALFRED et tout ancien millésime du store", () => {
    const resultat = calculerQuadrants({
      "production-aa-us": etat([[4, 1], [5, 1.2], [6, 1.5], [7, 2]], "2026-08-01"),
      "cpi-aa-us": etat([[4, 3], [5, 2.8], [6, 2.5], [7, 2]], "2026-08-01"),
      "production-aa-ez": etat([[4, 1], [5, 1], [6, 1], [7, 2]]),
      "cpi-aa-ez": etat([[4, 3], [5, 3], [6, 3], [7, 2]]),
    }, { regions: ["US", "EZ"], connuLe: "2026-08-02", maintenant: Date.UTC(2026, 8, 2) });
    expect(resultat.regions[0]?.points).toHaveLength(0);
    expect(resultat.regions[0]?.raison).toMatch(/millésime/i);
    expect(resultat.regions[1]?.points).toHaveLength(0);
    expect(resultat.regions[1]?.raison).toMatch(/ALFRED/);
  });

  it("publie une preuve datée du quadrant et garde l'inconnu hors des lectures fraîches", () => {
    const resultat = calculerQuadrants({
      "production-aa-us": etat([[4, 1], [5, 1.2], [6, 1.5], [7, 2]]),
      "cpi-aa-us": etat([[4, 3], [5, 2.8], [6, 2.5], [7, 2]]),
      "production-aa-ez": etat([[4, 1], [6, 1.5], [7, 2]]),
      "cpi-aa-ez": etat([[4, 3], [5, 2.8], [6, 2.5], [7, 2]]),
    }, { regions: ["US", "EZ"], maintenant: Date.UTC(2026, 8, 2) });
    const lectures = lecturesQuadrants(resultat);
    expect(lectures.find((l) => l.id.includes(":US:"))).toMatchObject({
      domaine: "quadrant", statut: "frais", observeLe: Date.UTC(2026, 6, 31, 23, 59, 59, 999),
      tags: [{ cle: "quadrant", valeur: "croissance-accelere-inflation-decelere" }],
      preuve: { fenetre: "RATE", reference: "production-aa-us/cpi-aa-us" },
    });
    expect(lectures.find((l) => l.id.includes(":EZ:"))?.statut).toBe("indisponible");
  });
});
