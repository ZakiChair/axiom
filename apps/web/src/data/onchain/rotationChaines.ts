/** Parts descriptives de l'économie des quatre chaînes, à dates quotidiennes communes. */
import type { LectureAnalyse } from "../analyseMultidomaine";
import { CHAINES_ECONOMIE, type ChaineEconomieId, type EconomieChainesResultat, type MetriqueEconomie, type PointEconomie } from "./economieChaines";

const JOUR = 86_400_000;
const FLUX = new Set<MetriqueEconomie>(["dex", "frais", "revenus"]);
const PRIX: Record<ChaineEconomieId, string | null> = { ethereum: "ETHUSDT", solana: "SOLUSDT", base: null, arbitrum: "ARBUSDT" };
export type HorizonRotation = 30 | 90;
export interface PersistanceRotation { gains: number; transitions: number; joursCouverts: number }
export interface LigneRotation {
  id: ChaineEconomieId;
  niveauDebut: number | null; niveauFin: number | null;
  partDebutPct: number | null; partFinPct: number | null; deltaPartPp: number | null;
  croissanceNiveauPct: number | null; persistance: PersistanceRotation;
}
export interface ResultatRotation {
  metrique: MetriqueEconomie; horizonJours: HorizonRotation;
  dateDebut: number | null; dateFin: number | null; periodeFluxJours: 1 | null;
  chaines: LigneRotation[]; couverture: { presentes: number; attendues: 4 };
  source: string; recupereLe: number; perime: boolean; limites: string[];
}
export function referencePrixChaine(id: ChaineEconomieId): string | null { return PRIX[id]; }

function jour(time: number): number { return Math.floor(time / JOUR) * JOUR; }
function indexer(points: readonly PointEconomie[], maintenant: number): Map<number, number> {
  const map = new Map<number, number>();
  for (const p of points) {
    if (!Number.isFinite(p.time) || p.time % JOUR !== 0 || p.time + JOUR > maintenant || !Number.isFinite(p.value) || p.value < 0) continue;
    const d = jour(p.time);
    // Une série journalière ne peut avoir deux observations différentes le même jour.
    if (map.has(d)) map.delete(d); else map.set(d, p.value);
  }
  return map;
}
function parts(valeurs: number[]): number[] | null {
  if (valeurs.length !== 4 || valeurs.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const total = valeurs.reduce((a, b) => a + b, 0);
  return total > 0 && Number.isFinite(total) ? valeurs.map((v) => 100 * v / total) : null;
}

export function calculerRotationChaines(donnees: EconomieChainesResultat, metrique: MetriqueEconomie, horizonJours: HorizonRotation, maintenant: number): ResultatRotation {
  const chaines = CHAINES_ECONOMIE.map(({ id }) => donnees.chaines.find((c) => c.id === id));
  const series = chaines.map((c) => c?.[metrique]);
  const maps = series.map((s) => s?.disponible ? indexer(s.serie, maintenant) : new Map<number, number>());
  const presentes = maps.filter((m) => m.size > 0).length;
  const dates = presentes === 4 ? [...maps[0]!.keys()].filter((d) => maps.every((m) => m.has(d))).sort((a, b) => a - b) : [];
  const dateFin = dates.at(-1) ?? null;
  const dateDebut = dateFin !== null && dates.includes(dateFin - horizonJours * JOUR) ? dateFin - horizonJours * JOUR : null;
  const entrees = dateDebut === null ? null : maps.map((m) => m.get(dateDebut)!);
  const sorties = dateFin === null ? null : maps.map((m) => m.get(dateFin)!);
  const partDebut = entrees === null ? null : parts(entrees);
  const partFin = sorties === null ? null : parts(sorties);
  const limites: string[] = [];
  if (presentes < 4) limites.push(`Cohorte incomplète : ${presentes}/4 chaînes avec historique.`);
  if (dateFin !== null && maps.some((m) => [...m.keys()].some((d) => d > dateFin))) limites.push("Observations plus récentes partielles : dernier jour commun antérieur conservé.");
  if (dateFin !== null && maintenant >= dateFin + 4 * JOUR) limites.push("Dernière journée commune close périmée (> 3 jours depuis sa clôture), même si une récupération est récente.");
  if (dateDebut === null) limites.push(`Borne de début exacte à ${horizonJours} jours indisponible.`);
  if (partDebut === null || partFin === null) limites.push("Part non calculable : cohorte ou dénominateur indisponible.");
  if (FLUX.has(metrique)) limites.push("Flux journaliers USD : chaque point est un intervalle complet d’un jour ; ni flux net ni cumul de capitaux.");
  if (metrique === "tvl") limites.push("TVL USD sensible aux prix : variation non assimilable à des entrées nettes.");
  const lignes: LigneRotation[] = CHAINES_ECONOMIE.map(({ id }, i) => {
    let gains = 0; let transitions = 0;
    const pointsDansHorizon = dates.filter((d) => dateFin !== null && d >= dateFin - horizonJours * JOUR);
    for (let j = 1; j < pointsDansHorizon.length; j++) {
      const avant = pointsDansHorizon[j - 1]!; const apres = pointsDansHorizon[j]!;
      if (apres - avant !== JOUR) continue;
      const p0 = parts(maps.map((m) => m.get(avant)!));
      const p1 = parts(maps.map((m) => m.get(apres)!));
      if (p0 === null || p1 === null) continue;
      transitions++;
      if (p1[i]! - p0[i]! > 0) gains++;
    }
    const debut = entrees?.[i] ?? null; const fin = sorties?.[i] ?? null;
    return { id, niveauDebut: debut, niveauFin: fin,
      partDebutPct: partDebut?.[i] ?? null, partFinPct: partFin?.[i] ?? null,
      deltaPartPp: partDebut !== null && partFin !== null ? partFin[i]! - partDebut[i]! : null,
      croissanceNiveauPct: debut !== null && debut > 0 && fin !== null ? 100 * (fin / debut - 1) : null,
      persistance: { gains, transitions, joursCouverts: pointsDansHorizon.length } };
  });
  return { metrique, horizonJours, dateDebut, dateFin, periodeFluxJours: FLUX.has(metrique) ? 1 : null,
    chaines: lignes, couverture: { presentes, attendues: 4 },
    source: [...new Set(series.map((s) => s?.source).filter((x): x is string => !!x))].join(" · ") || "DefiLlama",
    recupereLe: Math.min(donnees.recupereLe, ...series.map((s) => s?.recupereLe ?? donnees.recupereLe)),
    perime: series.some((s) => !s || s.perime) || (dateFin !== null && maintenant >= dateFin + 4 * JOUR), limites };
}

/** Preuve prête pour le registre T1 ; l'appelant ne publie que les résultats acquiss. */
export function lectureRotation(resultat: ResultatRotation, id: ChaineEconomieId): LectureAnalyse {
  const ligne = resultat.chaines.find((c) => c.id === id)!;
  const disponible = ligne.deltaPartPp !== null && resultat.dateDebut !== null && resultat.dateFin !== null;
  const limites = [...resultat.limites, "Persistance = transitions quotidiennes communes positives / transitions valides ; association descriptive, pas transfert de capitaux."];
  if (!disponible && limites.length === 0) limites.push("Comparaison indisponible.");
  const debut = resultat.dateDebut ?? resultat.dateFin ?? resultat.recupereLe;
  const fin = resultat.dateFin ?? resultat.recupereLe;
  return { id: `rotation:${resultat.metrique}:${resultat.horizonJours}:${id}`, domaine: "rotation", nature: "observation",
    conclusion: disponible ? `${id} : part ${ligne.deltaPartPp! >= 0 ? "+" : ""}${ligne.deltaPartPp!.toFixed(2)} pp sur ${resultat.horizonJours} j dans la cohorte Ethereum/Solana/Base/Arbitrum.` : `${id} : comparaison de part indisponible sur ${resultat.horizonJours} j.`,
    tags: [{ cle: "rotation", valeur: `${resultat.metrique}:${id}` }], instrument: null,
    horizon: { depuis: debut, jusqua: resultat.dateFin !== null ? fin + JOUR - 1 : fin }, unite: disponible ? "points de pourcentage" : null,
    valeur: ligne.deltaPartPp, source: resultat.source, observeLe: resultat.dateFin !== null ? fin + JOUR - 1 : null,
    recupereLe: resultat.recupereLe, validiteJusqua: resultat.dateFin !== null ? Math.min(resultat.recupereLe + 3 * JOUR, resultat.dateFin + 4 * JOUR) : null,
    statut: !disponible ? "indisponible" : resultat.perime ? "perime" : "frais",
    couverture: resultat.couverture, limites,
    preuve: { fenetre: "CHAIN", reference: `${resultat.metrique}:${id}:${resultat.dateDebut ?? "?"}:${resultat.dateFin ?? "?"}` } };
}
