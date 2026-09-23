import { statutLectureAnalyse, validerLectureAnalyse, type DomaineAnalyse, type LectureAnalyse } from "../data/analyseMultidomaine";

const registre = new Map<DomaineAnalyse, LectureAnalyse[]>();
const MAX_LECTURES = 50;
const copie = (lecture: LectureAnalyse): LectureAnalyse => structuredClone(lecture);

/** Remplace atomiquement les preuves acquises d'un producteur, sans conserver ses références. */
export function remplacerLectures(domaine: DomaineAnalyse, lectures: readonly LectureAnalyse[]): void {
  const uniques = new Set<string>();
  const valides: LectureAnalyse[] = [];
  for (const lecture of lectures) {
    if (valides.length >= MAX_LECTURES) break;
    if (lecture.domaine !== domaine || validerLectureAnalyse(lecture) === null || uniques.has(lecture.id)) continue;
    uniques.add(lecture.id);
    valides.push(copie(lecture));
  }
  registre.set(domaine, valides);
  const toutes = [...registre.values()].flat();
  if (toutes.length > MAX_LECTURES) {
    const gardees = new Set(toutes.sort((a, b) => b.recupereLe - a.recupereLe).slice(0, MAX_LECTURES));
    for (const [cle, valeurs] of registre) registre.set(cle, valeurs.filter((valeur) => gardees.has(valeur)));
  }
}
export function lireLectures(maintenant: number): LectureAnalyse[] {
  return [...registre.values()].flatMap((lectures) => lectures.map((lecture) => ({ ...copie(lecture), statut: statutLectureAnalyse(lecture, maintenant) })));
}
/** Snapshot synchrone ; exclut toute observation/récupération/posture future. */
export function capturerLectures(maintenant: number): LectureAnalyse[] {
  return lireLectures(maintenant).filter((lecture) => lecture.horizon.jusqua <= maintenant && lecture.recupereLe <= maintenant && (lecture.observeLe === null || lecture.observeLe <= maintenant));
}
