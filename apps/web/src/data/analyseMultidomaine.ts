import { EXCHANGE_IDS, type ExchangeId } from "@axiom/types";

export type DomaineAnalyse = "quadrant" | "liquidite" | "rotation" | "geo" | "divergence";
export type StatutAnalyse = "frais" | "partiel" | "perime" | "indisponible";

export interface LectureAnalyse {
  id: string;
  domaine: DomaineAnalyse;
  nature: "observation" | "scenario-conditionnel";
  conclusion: string;
  tags: Array<{ cle: DomaineAnalyse; valeur: string }>;
  instrument: { symbol: string; source: ExchangeId } | null;
  horizon: { depuis: number; jusqua: number };
  unite: string | null;
  valeur: number | null;
  source: string;
  observeLe: number | null;
  recupereLe: number;
  validiteJusqua: number | null;
  statut: StatutAnalyse;
  couverture: { presentes: number; attendues: number } | null;
  limites: string[];
  preuve: { fenetre: "RATE" | "DOM" | "CHAIN" | "GLOBE" | "BRIEF"; reference: string };
}

const DOMAINES: readonly DomaineAnalyse[] = ["quadrant", "liquidite", "rotation", "geo", "divergence"];
const STATUTS: readonly StatutAnalyse[] = ["frais", "partiel", "perime", "indisponible"];
const FENETRES = ["RATE", "DOM", "CHAIN", "GLOBE", "BRIEF"] as const;
const CLES = ["id", "domaine", "nature", "conclusion", "tags", "instrument", "horizon", "unite", "valeur", "source", "observeLe", "recupereLe", "validiteJusqua", "statut", "couverture", "limites", "preuve"];
const objet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const cles = (v: Record<string, unknown>, attendues: readonly string[]): boolean => Object.keys(v).length === attendues.length && Object.keys(v).every((k) => attendues.includes(k));
const texte = (v: unknown, max = 500): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const nombre = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Vérifie une preuve importée avant de l'exposer au registre ou de la sérialiser. */
export function validerLectureAnalyse(brut: unknown): LectureAnalyse | null {
  if (!objet(brut) || !cles(brut, CLES)) return null;
  if (!texte(brut.id, 160) || !DOMAINES.includes(brut.domaine as DomaineAnalyse) ||
      (brut.nature !== "observation" && brut.nature !== "scenario-conditionnel") || !texte(brut.conclusion) ||
      !texte(brut.source) || !STATUTS.includes(brut.statut as StatutAnalyse)) return null;
  if (!Array.isArray(brut.tags) || brut.tags.length > 10 || !brut.tags.every((t) => objet(t) && cles(t, ["cle", "valeur"]) && DOMAINES.includes(t.cle as DomaineAnalyse) && texte(t.valeur, 80))) return null;
  if (brut.instrument !== null && (!objet(brut.instrument) || !cles(brut.instrument, ["symbol", "source"]) || !texte(brut.instrument.symbol, 160) || !EXCHANGE_IDS.includes(brut.instrument.source as ExchangeId))) return null;
  if (!objet(brut.horizon) || !cles(brut.horizon, ["depuis", "jusqua"]) || !nombre(brut.horizon.depuis) || !nombre(brut.horizon.jusqua) || brut.horizon.depuis > brut.horizon.jusqua) return null;
  if (brut.unite !== null && !texte(brut.unite, 80)) return null;
  if (brut.valeur !== null && !nombre(brut.valeur)) return null;
  if (brut.observeLe !== null && !nombre(brut.observeLe)) return null;
  if (!nombre(brut.recupereLe) || (brut.validiteJusqua !== null && !nombre(brut.validiteJusqua))) return null;
  if (brut.couverture !== null && (!objet(brut.couverture) || !cles(brut.couverture, ["presentes", "attendues"]) || !Number.isInteger(brut.couverture.presentes) || !Number.isInteger(brut.couverture.attendues) || (brut.couverture.presentes as number) < 0 || (brut.couverture.attendues as number) < 0 || (brut.couverture.presentes as number) > (brut.couverture.attendues as number))) return null;
  if (!Array.isArray(brut.limites) || brut.limites.length > 10 || !brut.limites.every((l) => texte(l))) return null;
  if (!objet(brut.preuve) || !cles(brut.preuve, ["fenetre", "reference"]) || !FENETRES.includes(brut.preuve.fenetre as typeof FENETRES[number]) || !texte(brut.preuve.reference, 500)) return null;
  if (brut.statut === "indisponible" && (brut.valeur !== null || brut.limites.length === 0)) return null;
  return brut as unknown as LectureAnalyse;
}

/** La péremption se requalifie à la lecture, jamais en réécrivant la date source. */
export function statutLectureAnalyse(lecture: LectureAnalyse, maintenant: number): StatutAnalyse {
  if (lecture.statut === "indisponible") return "indisponible";
  if (lecture.statut === "perime" || (lecture.validiteJusqua !== null && maintenant >= lecture.validiteJusqua)) return "perime";
  return lecture.statut;
}
