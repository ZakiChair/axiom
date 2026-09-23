/** Lecture descriptive des résultats EXPY à partir des seules preuves archivées. */
import { EXCHANGE_IDS } from "@axiom/types";
import { identiteSemantiqueLecture } from "./analyseSynthese";
import type { LectureAnalyse } from "./analyseMultidomaine";
import { validerAnalyseAuSignal, type DossierDecision } from "./decisionDossier";
import { rMultiple, type TradeJournal } from "./expy";

export interface StatistiquesR {
  nR: number; moyenne: number | null; mediane: number | null; ecartType: number | null;
  erreurType: number | null; winRate: number | null; profitFactor: number | null;
  gains: number; pertes: number; breakeven: number;
}
export interface LigneContexte { tradeId: string; cle: string; r: number | null; fermeTs: number;
  lectures: Array<{ domaine: LectureAnalyse["domaine"]; conclusion: string; valeur: number | null; unite: string | null;
    statut: LectureAnalyse["statut"]; nature: LectureAnalyse["nature"]; captureLe: number }> }
export interface GroupeContexte { cle: string; total: number; fermes: number; sansR: number;
  debut: number | null; fin: number | null; joursDistincts: number; statistiques: StatistiquesR }
export interface ExclusionsContexte { ouverts: number; sansSource: number; dateInvalide: number; sansR: number;
  dossierAbsent: number; autreIdentite: number; sansAnalyse: number; posterieurEntree: number;
  posterieurCloture: number; preuveInvalide: number; lectureIncompatible: number }
export interface ResultatsContexte { dimension: string; dimensions: string[]; total: number;
  groupes: GroupeContexte[]; lignes: LigneContexte[]; exclusions: ExclusionsContexte }

export function statistiquesR(valeurs: readonly number[]): StatistiquesR {
  const rs = valeurs.filter(Number.isFinite).sort((a, b) => a - b);
  const nR = rs.length;
  const gains = rs.filter((r) => r > 0).length;
  const pertes = rs.filter((r) => r < 0).length;
  const breakeven = nR - gains - pertes;
  if (nR === 0) return { nR, moyenne: null, mediane: null, ecartType: null, erreurType: null,
    winRate: null, profitFactor: null, gains, pertes, breakeven };
  const somme = rs.reduce((a, b) => a + b, 0);
  const moyenne = somme / nR;
  const mediane = nR % 2 === 1 ? rs[Math.floor(nR / 2)]! : (rs[nR / 2 - 1]! + rs[nR / 2]!) / 2;
  const ecartType = nR >= 2 ? Math.sqrt(rs.reduce((a, r) => a + (r - moyenne) ** 2, 0) / (nR - 1)) : null;
  const plus = rs.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const moins = rs.filter((r) => r < 0).reduce((a, b) => a + b, 0);
  return { nR, moyenne, mediane, ecartType, erreurType: ecartType === null ? null : ecartType / Math.sqrt(nR),
    winRate: gains / nR, profitFactor: moins < 0 ? plus / -moins : null, gains, pertes, breakeven };
}

function compatible(lecture: LectureAnalyse, trade: TradeJournal): boolean {
  return lecture.instrument === null || (lecture.instrument.symbol === trade.symbol && lecture.instrument.source === trade.source);
}
function categorie(lecture: LectureAnalyse): string | null {
  if (lecture.nature !== "observation" || lecture.statut !== "frais") return null;
  if (lecture.domaine !== "quadrant" && lecture.domaine !== "divergence") return null;
  return lecture.tags.find((tag) => tag.cle === lecture.domaine)?.valeur ?? null;
}

/** Une partition par dimension choisie ; jamais de valeur du registre actuel. */
export function analyserContextes(trades: readonly TradeJournal[], dossiers: readonly DossierDecision[], dimension: string): ResultatsContexte {
  const exclusions: ExclusionsContexte = { ouverts: 0, sansSource: 0, dateInvalide: 0, sansR: 0,
    dossierAbsent: 0, autreIdentite: 0, sansAnalyse: 0, posterieurEntree: 0,
    posterieurCloture: 0, preuveInvalide: 0, lectureIncompatible: 0 };
  const index = new Map(dossiers.map((d) => [d.id, d]));
  const dimensions = new Set<string>();
  for (const d of dossiers) {
    const analyse = d.analyse === undefined ? null : validerAnalyseAuSignal(d.analyse, d.origine.ts);
    if (analyse) for (const lecture of analyse.lectures) dimensions.add(identiteSemantiqueLecture(lecture));
  }
  const vus = new Set<string>();
  const lignes: LigneContexte[] = [];
  for (const t of trades) {
    if (vus.has(t.id)) continue;
    vus.add(t.id);
    if (t.sortie === null || t.fermeTs === null) { exclusions.ouverts++; continue; }
    if (!t.source || !(EXCHANGE_IDS as readonly string[]).includes(t.source)) { exclusions.sansSource++; continue; }
    if (typeof t.ouvertTs !== "number" || typeof t.fermeTs !== "number"
      || !Number.isFinite(new Date(t.ouvertTs).getTime()) || !Number.isFinite(new Date(t.fermeTs).getTime())
      || t.ouvertTs > t.fermeTs) { exclusions.dateInvalide++; continue; }
    const entrees: LectureAnalyse[] = [];
    const suivantes: LectureAnalyse[] = [];
    const lectures: LigneContexte["lectures"] = [];
    for (const id of new Set(t.decisionIds ?? [])) {
      const d = index.get(id);
      if (!d) { exclusions.dossierAbsent++; continue; }
      if (d.origine.symbol !== t.symbol || d.origine.source !== t.source) { exclusions.autreIdentite++; continue; }
      if (!d.analyse) { exclusions.sansAnalyse++; continue; }
      const analyse = validerAnalyseAuSignal(d.analyse, d.origine.ts);
      if (!analyse) { exclusions.preuveInvalide++; continue; }
      if (d.origine.ts > t.fermeTs || analyse.captureLe > t.fermeTs) { exclusions.posterieurCloture++; continue; }
      const selection = analyse.lectures.filter((l) => identiteSemantiqueLecture(l) === dimension);
      for (const lecture of selection) {
        if (!compatible(lecture, t)) { exclusions.lectureIncompatible++; continue; }
        lectures.push({ domaine: lecture.domaine, conclusion: lecture.conclusion, valeur: lecture.valeur,
          unite: lecture.unite, statut: lecture.statut, nature: lecture.nature, captureLe: analyse.captureLe });
        if (d.origine.ts <= t.ouvertTs && analyse.captureLe <= t.ouvertTs) entrees.push(lecture);
        else { suivantes.push(lecture); exclusions.posterieurEntree++; }
      }
    }
    const categoriesEntree = new Set(entrees.map(categorie).filter((x): x is string => x !== null));
    const categoriesSuivantes = new Set(suivantes.map(categorie).filter((x): x is string => x !== null));
    const toutes = new Set([...categoriesEntree, ...categoriesSuivantes]);
    const cle = categoriesEntree.size === 0 ? "non-prouve" : toutes.size > 1 ? "mixte" : [...categoriesEntree][0]!;
    const calcule = rMultiple(t);
    const r = calcule !== null && Number.isFinite(calcule) ? calcule : null;
    if (r === null) exclusions.sansR++;
    lignes.push({ tradeId: t.id, cle, r, fermeTs: t.fermeTs, lectures });
  }
  const groupes = [...new Set(lignes.map((l) => l.cle))].sort().map((cle): GroupeContexte => {
    const membres = lignes.filter((l) => l.cle === cle);
    const dates = membres.map((l) => l.fermeTs);
    const rs = membres.map((l) => l.r).filter((r): r is number => r !== null);
    return { cle, total: membres.length, fermes: membres.length, sansR: membres.length - rs.length,
      debut: dates.length ? Math.min(...dates) : null, fin: dates.length ? Math.max(...dates) : null,
      joursDistincts: new Set(dates.map((date) => new Date(date).toISOString().slice(0, 10))).size,
      statistiques: statistiquesR(rs) };
  });
  return { dimension, dimensions: [...dimensions].sort(), total: lignes.length, groupes, lignes, exclusions };
}
