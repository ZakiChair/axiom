import { describe, expect, it } from "vitest";
import type { EconomieChaine, EconomieChainesResultat, MetriqueEconomie, PointEconomie, SerieEconomie } from "./economieChaines";
import { calculerRotationChaines, lectureRotation, referencePrixChaine } from "./rotationChaines";
import { capturerLectures, remplacerLectures } from "../../store/analyseMultidomaine";

const JOUR = 86_400_000;
const FIN = Date.UTC(2026, 8, 20);
const ids = ["ethereum", "solana", "base", "arbitrum"] as const;
function serie(points: PointEconomie[]): SerieEconomie {
  const dernier = points.at(-1);
  return { disponible: points.length > 0, perime: false, serie: points, source: "DefiLlama TVL", recupereLe: FIN + JOUR,
    resume: { niveau: dernier?.value ?? null, observeLe: dernier?.time ?? null, variation30jPct: null, variation90jPct: null, variation365jPct: null } };
}
function donnees(valeurs: number[][], metrique: MetriqueEconomie = "tvl"): EconomieChainesResultat {
  return { recupereLe: FIN + JOUR, chaines: ids.map((id, i) => {
    const points = valeurs[i]!.map((value, n) => ({ time: FIN - (valeurs[i]!.length - 1 - n) * JOUR, value }));
    const vide = serie([]);
    return { id, libelle: id, tvl: vide, dex: vide, stablecoins: vide, frais: vide, revenus: vide, [metrique]: serie(points) } as EconomieChaine;
  }) };
}

describe("rotation de cohorte fixe", () => {
  it("compare les mêmes quatre chaînes : Ethereum 25 → 40 %, +15 pp", () => {
    const valeurs = [[100, 200], [100, 100], [100, 100], [100, 100]];
    const result = calculerRotationChaines(donnees(valeurs.map(([a, b]) => Array.from({ length: 31 }, (_, n) => n === 30 ? b! : a!))), "tvl", 30, FIN + JOUR);
    expect(result.dateDebut).toBe(FIN - 30 * JOUR);
    expect(result.dateFin).toBe(FIN);
    expect(result.chaines.find((c) => c.id === "ethereum")).toMatchObject({ partDebutPct: 25, partFinPct: 40, deltaPartPp: 15, croissanceNiveauPct: 100 });
    expect(result.couverture).toEqual({ presentes: 4, attendues: 4 });
  });

  it("refuse une part si une chaîne manque, sans renormaliser 3/4", () => {
    const result = calculerRotationChaines(donnees([[100, 200], [100, 100], [], [100, 100]]), "tvl", 30, FIN + JOUR);
    expect(result.chaines.every((c) => c.partFinPct === null)).toBe(true);
    expect(result.couverture.presentes).toBe(3);
  });

  it("la persistance compte seulement les transitions de jours consécutifs valides", () => {
    const base = [100, 100, 100, 100, 100];
    const a = [100, 120, 140, 120, 130];
    const data = donnees([a, base, base, base]);
    const result = calculerRotationChaines(data, "tvl", 30, FIN + JOUR);
    expect(result.chaines[0]!.persistance).toEqual({ gains: 3, transitions: 4, joursCouverts: 5 });
    data.chaines[2]!.tvl.serie.splice(2, 1);
    const trou = calculerRotationChaines(data, "tvl", 30, FIN + JOUR);
    expect(trou.chaines[0]!.persistance.transitions).toBe(2);
    expect(trou.chaines[0]!.persistance.joursCouverts).toBe(4);
  });

  it("garde la nature quotidienne des flux et leur source dans la preuve", () => {
    const values = ids.map(() => Array.from({ length: 31 }, () => 100));
    const result = calculerRotationChaines(donnees(values, "dex"), "dex", 30, FIN + JOUR);
    expect(result.periodeFluxJours).toBe(1);
    expect(lectureRotation(result, "ethereum").limites.join(" ")).toMatch(/flux journaliers|volume journalier/i);
  });

  it("Base n'a aucun prix de token de référence", () => {
    expect(referencePrixChaine("ethereum")).toBe("ETHUSDT");
    expect(referencePrixChaine("solana")).toBe("SOLUSDT");
    expect(referencePrixChaine("arbitrum")).toBe("ARBUSDT");
    expect(referencePrixChaine("base")).toBeNull();
  });

  it("périme la preuve sur le dernier jour commun clos retenu, même si le loader possède un point ouvert récent", () => {
    const maintenant = Date.UTC(2026, 8, 24, 12);
    const debut = Date.UTC(2026, 7, 21);
    const fin = Date.UTC(2026, 8, 20);
    const ouvert = Date.UTC(2026, 8, 24);
    const data = donnees(ids.map(() => [100, 110, 120]));
    for (const chaine of data.chaines) {
      chaine.tvl.serie = [{ time: debut, value: 100 }, { time: fin, value: 110 }, { time: ouvert, value: 120 }];
      chaine.tvl.perime = false;
      chaine.tvl.recupereLe = maintenant;
    }
    data.recupereLe = maintenant;
    const resultat = calculerRotationChaines(data, "tvl", 30, maintenant);
    expect(resultat.dateFin).toBe(fin);
    expect(resultat.perime).toBe(true);
    const preuve = lectureRotation(resultat, "ethereum");
    expect(preuve.statut).toBe("perime");
    expect(preuve.validiteJusqua).toBeLessThanOrEqual(maintenant);
    remplacerLectures("rotation", [preuve]);
    expect(capturerLectures(maintenant)[0]?.statut).toBe("perime");
    remplacerLectures("rotation", []);
  });
});
