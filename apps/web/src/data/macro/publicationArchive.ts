/** Archives locales ECO : données explicites, bornées et sans secret. */
import { chargerPremieresPublicationsAlfred, chargerVueAlfred } from "./alfred";
import {
  CLE_CONSENSUS, TYPES, MESURES, MAX_ARCHIVES,
  estObjet, assertCles, assertTexte, assertTimestamp, normaliserSource,
  assertMesureDuType, cleEvenement, notifierArchives, normaliserCapture, lireCapturesConsensus,
} from "./publicationConsensus";
// API historique conservée pour les lecteurs d'archives et leurs tests.
export {
  typePublicationDepuisEvenement, typePublicationDepuisTitre, archiverConsensusAvantAnnonce,
  conserverConsensusAvantAnnonce, lireCapturesConsensus,
} from "./publicationConsensus";

export type TypePublication = "cpi" | "nfp" | "pce" | "retail";
export type MesurePublication =
  | "cpi-global-mm-sa"
  | "nfp-payems-change"
  | "pce-core-mm-sa"
  | "retail-nominal-mm";

export interface SourceArchive { nom: string; url: string }
export interface ValeurPublication {
  label: string;
  value: number;
  unit: string;
  /** Date ALFRED connue, jamais transformée en heure. */
  knownAt?: string;
  transformation?: string;
}
export interface ConsensusArchive {
  value: number | string;
  unit?: string;
  collectedAt: number;
  source: SourceArchive;
}
export interface ArchivePublication {
  id: string;
  type: TypePublication;
  mesure: MesurePublication;
  country: "USD";
  period: string;
  publishedAt: number;
  timeApprox: boolean;
  source: SourceArchive;
  /** Mesure publiée dans le communiqué, indépendante des niveaux ALFRED. */
  actual: ValeurPublication;
  valeurInitiale?: ValeurPublication;
  valeurRevisée?: ValeurPublication;
  observationsComplementaires?: ValeurPublication[];
  consensusAvantAnnonce: ConsensusArchive | null;
}
export interface IdentitePublication {
  type: TypePublication;
  mesure: MesurePublication;
  country: "USD";
}
export interface CaptureConsensus extends IdentitePublication {
  id: string;
  title: string;
  publishedAt: number;
  timeApprox: boolean;
  consensus: { value: number | string; unit?: string };
  source: SourceArchive;
  collectedAt: number;
}
export interface DocumentArchives {
  version: 2;
  archives: ArchivePublication[];
  capturesConsensus: CaptureConsensus[];
}

const CLE_ARCHIVES = "axiom:eco:publications:v2";
const MAX_HISTORIQUE_ALFRED = 60;
const MAX_JSON = 1_000_000;

export const ARCHIVES_INITIALES_PUBLIEES: readonly ArchivePublication[] = [
  {
    id: "cpi-2026-07", type: "cpi", mesure: "cpi-global-mm-sa", country: "USD", period: "2026-07",
    publishedAt: Date.parse("2026-08-12T12:30:00Z"), timeApprox: false,
    source: { nom: "Bureau of Labor Statistics — Consumer Price Index", url: "https://www.bls.gov/news.release/archives/cpi_08122026.htm" },
    actual: { label: "CPI global m/m SA", value: 0.1, unit: "%", transformation: "m/m SA" },
    observationsComplementaires: [{ label: "CPI global a/a NSA", value: 3.4, unit: "%", transformation: "a/a NSA" }],
    consensusAvantAnnonce: null,
  },
  {
    id: "nfp-2026-08", type: "nfp", mesure: "nfp-payems-change", country: "USD", period: "2026-08",
    publishedAt: Date.parse("2026-09-04T12:30:00Z"), timeApprox: false,
    source: { nom: "Bureau of Labor Statistics — Employment Situation", url: "https://www.bls.gov/news.release/archives/empsit_09042026.htm" },
    actual: { label: "Variation PAYEMS publiée", value: 162, unit: "milliers", transformation: "variation mensuelle" },
    valeurInitiale: { label: "Niveau PAYEMS, première publication", value: 159075, unit: "milliers", knownAt: "2026-09-04" },
    consensusAvantAnnonce: null,
  },
];

function estDateCivile(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [annee, mois, jour] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(annee!, mois! - 1, jour!));
  return date.getUTCFullYear() === annee && date.getUTCMonth() === mois! - 1 && date.getUTCDate() === jour;
}
function assertPeriode(value: unknown): string {
  const period = assertTexte(value, "Période", 7);
  if (!/^\d{4}-\d{2}$/.test(period) || !estDateCivile(`${period}-01`)) throw new Error("Période YYYY-MM civile invalide.");
  return period;
}
function normaliserValeur(value: unknown, nom: string): ValeurPublication {
  if (!estObjet(value)) throw new Error(`${nom} invalide.`);
  assertCles(value, ["label", "value", "unit", "knownAt", "transformation"], nom);
  const label = assertTexte(value.label, `${nom} label`);
  if (typeof value.value !== "number" || !Number.isFinite(value.value)) throw new Error(`${nom} valeur invalide.`);
  const unit = assertTexte(value.unit, `${nom} unité`, 80);
  const knownAt = value.knownAt === undefined ? undefined : assertTexte(value.knownAt, `${nom} connuLe`, 10);
  if (knownAt !== undefined && !estDateCivile(knownAt)) throw new Error(`${nom} connuLe invalide.`);
  const transformation = value.transformation === undefined ? undefined : assertTexte(value.transformation, `${nom} transformation`, 80);
  return { label, value: value.value, unit, ...(knownAt ? { knownAt } : {}), ...(transformation ? { transformation } : {}) };
}
function normaliserConsensus(value: unknown, publishedAt: number): ConsensusArchive | null {
  if (value === null) return null;
  if (!estObjet(value)) throw new Error("Consensus invalide.");
  assertCles(value, ["value", "unit", "collectedAt", "source"], "Consensus");
  if (typeof value.value !== "string" && (typeof value.value !== "number" || !Number.isFinite(value.value))) throw new Error("Consensus valeur invalide.");
  const unit = value.unit === undefined ? undefined : assertTexte(value.unit, "Consensus unité", 80);
  const collectedAt = assertTimestamp(value.collectedAt, "Date de collecte du consensus");
  if (collectedAt >= publishedAt) throw new Error("Le consensus doit être collecté avant l'annonce.");
  return { value: value.value, ...(unit ? { unit } : {}), collectedAt, source: normaliserSource(value.source) };
}
function normaliserArchive(value: unknown): ArchivePublication {
  if (!estObjet(value)) throw new Error("Archive invalide.");
  assertCles(value, ["id", "type", "mesure", "country", "period", "publishedAt", "timeApprox", "source", "actual", "valeurInitiale", "valeurRevisée", "observationsComplementaires", "consensusAvantAnnonce"], "Archive");
  const id = assertTexte(value.id, "Identifiant archive", 160);
  if (typeof value.type !== "string" || !TYPES.has(value.type as TypePublication)) throw new Error("Archive type invalide.");
  if (typeof value.mesure !== "string" || !MESURES.has(value.mesure as MesurePublication)) throw new Error("Archive mesure invalide.");
  assertMesureDuType(value.type as TypePublication, value.mesure as MesurePublication, "Archive");
  if (value.country !== "USD") throw new Error("Archive pays invalide.");
  const period = assertPeriode(value.period);
  const publishedAt = assertTimestamp(value.publishedAt, "Heure de publication");
  if (typeof value.timeApprox !== "boolean") throw new Error("Précision horaire invalide.");
  const source = normaliserSource(value.source);
  const actual = normaliserValeur(value.actual, "Valeur publiée");
  const valeurInitiale = value.valeurInitiale === undefined ? undefined : normaliserValeur(value.valeurInitiale, "Valeur initiale");
  const valeurRevisée = value.valeurRevisée === undefined ? undefined : normaliserValeur(value.valeurRevisée, "Valeur révisée");
  if (value.observationsComplementaires !== undefined && (!Array.isArray(value.observationsComplementaires) || value.observationsComplementaires.length > 12)) throw new Error("Observations complémentaires invalides.");
  const observationsComplementaires = value.observationsComplementaires?.map((item) => normaliserValeur(item, "Observation complémentaire"));
  const consensusAvantAnnonce = normaliserConsensus(value.consensusAvantAnnonce, publishedAt);
  return { id, type: value.type as TypePublication, mesure: value.mesure as MesurePublication, country: "USD", period, publishedAt, timeApprox: value.timeApprox, source, actual, ...(valeurInitiale ? { valeurInitiale } : {}), ...(valeurRevisée ? { valeurRevisée } : {}), ...(observationsComplementaires ? { observationsComplementaires } : {}), consensusAvantAnnonce };
}

export function importerDocumentArchives(json: string): DocumentArchives {
  if (json.length > MAX_JSON) throw new Error("Import trop volumineux.");
  let brut: unknown;
  try { brut = JSON.parse(json); } catch { throw new Error("Import JSON invalide."); }
  if (!estObjet(brut)) throw new Error("Import d'archive incompatible.");
  assertCles(brut, ["version", "archives", "capturesConsensus"], "Document archive");
  if (brut.version !== 2 || !Array.isArray(brut.archives) || !Array.isArray(brut.capturesConsensus) || brut.archives.length > MAX_ARCHIVES || brut.capturesConsensus.length > MAX_ARCHIVES) throw new Error("Import d'archive incompatible.");
  const archives = brut.archives.map(normaliserArchive);
  const capturesConsensus = brut.capturesConsensus.map(normaliserCapture);
  if (new Set(archives.map((archive) => archive.id)).size !== archives.length) throw new Error("Import d'archive : identifiant dupliqué.");
  return { version: 2, archives, capturesConsensus };
}
/** Compatibilité : extrait seulement les archives validées du document v2. */
export function importerArchivesPublications(json: string): ArchivePublication[] { return importerDocumentArchives(json).archives; }
export function exporterArchivesPublications(archives: readonly ArchivePublication[], capturesConsensus = lireCapturesConsensus()): string {
  const document: DocumentArchives = { version: 2, archives: archives.map(normaliserArchive), capturesConsensus: capturesConsensus.map(normaliserCapture) };
  return JSON.stringify(document);
}
/** Modèle JSON valide, volontairement vide : il ne peut pas être confondu avec une donnée réelle. */
export function modeleImportArchivesPublications(): string {
  return JSON.stringify({ version: 2, archives: [], capturesConsensus: [] }, null, 2);
}
export function lireArchivesPublications(): ArchivePublication[] {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(CLE_ARCHIVES);
    const importees = raw ? importerDocumentArchives(raw) : { version: 2 as const, archives: [], capturesConsensus: [] };
    const captures = [...importees.capturesConsensus, ...lireCapturesConsensus()];
    const parCle = new Map(captures.map((capture) => [cleEvenement(capture), capture]));
    return fusionnerArchives([...ARCHIVES_INITIALES_PUBLIEES, ...importees.archives]).map((archive) => {
      const capture = parCle.get(cleEvenement(archive));
      return capture === undefined ? archive : { ...archive, consensusAvantAnnonce: { value: capture.consensus.value, ...(capture.consensus.unit ? { unit: capture.consensus.unit } : {}), collectedAt: capture.collectedAt, source: capture.source } };
    });
  } catch { return [...ARCHIVES_INITIALES_PUBLIEES]; }
}
export function ecrireDocumentArchives(document: DocumentArchives): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const normalise = importerDocumentArchives(JSON.stringify(document));
    localStorage.setItem(CLE_ARCHIVES, JSON.stringify(normalise));
    localStorage.setItem(CLE_CONSENSUS, JSON.stringify(normalise.capturesConsensus));
    notifierArchives();
    return true;
  } catch { return false; }
}
export function ecrireArchivesPublications(archives: readonly ArchivePublication[]): boolean { return ecrireDocumentArchives({ version: 2, archives: [...archives], capturesConsensus: lireCapturesConsensus() }); }
export function fusionnerArchives(archives: readonly ArchivePublication[]): ArchivePublication[] {
  const parId = new Map<string, ArchivePublication>();
  for (const archive of archives) parId.set(archive.id, archive);
  return [...parId.values()].sort((a, b) => a.publishedAt - b.publishedAt);
}

const SERIE_ALFRED: Record<TypePublication, { serie: string; units?: string; unit: string; transformation: string }> = {
  cpi: { serie: "CPIAUCSL", units: "pch", unit: "%", transformation: "m/m SA" },
  nfp: { serie: "PAYEMS", unit: "milliers", transformation: "niveau" },
  pce: { serie: "PCEPILFE", units: "pch", unit: "%", transformation: "m/m SA" },
  retail: { serie: "RSAFS", unit: "millions USD nominaux", transformation: "niveau nominal" },
};
function bornesPeriode(period: string): { debut: string; fin: string } { const [annee, mois] = period.split("-").map(Number); return { debut: `${period}-01`, fin: new Date(Date.UTC(annee!, mois!, 0)).toISOString().slice(0, 10) }; }
function debutHistorique(connuLe: string, max: number): string { if (!estDateCivile(connuLe)) throw new Error("Cutoff ALFRED invalide."); const [annee, mois] = connuLe.slice(0, 7).split("-").map(Number); return new Date(Date.UTC(annee!, mois! - 1 - Math.max(max + 2, 6), 1)).toISOString().slice(0, 10); }

export async function chargerVersionsAlfredPublication(archive: ArchivePublication, connuLe: string): Promise<ArchivePublication> {
  const configuration = SERIE_ALFRED[archive.type];
  const bornes = bornesPeriode(archive.period);
  try {
    const options = { ...bornes, units: configuration.units };
    const [premieres, vue] = await Promise.all([chargerPremieresPublicationsAlfred(configuration.serie, options), chargerVueAlfred(configuration.serie, connuLe, options)]);
    const initiale = premieres.find((point) => point.periode === bornes.debut && point.connuDepuis <= connuLe);
    const revisee = vue.find((point) => point.periode === bornes.debut);
    return { ...archive,
      valeurInitiale: initiale ? { label: `ALFRED ${configuration.transformation}, première publication`, value: initiale.valeur, unit: configuration.unit, knownAt: initiale.connuDepuis, transformation: configuration.transformation } : archive.valeurInitiale,
      valeurRevisée: revisee ? { label: `ALFRED ${configuration.transformation}, vue révisée`, value: revisee.valeur, unit: configuration.unit, knownAt: revisee.connuDepuis, transformation: configuration.transformation } : undefined,
    };
  } catch { return archive; }
}
export interface VersionHistoriqueAlfred { type: TypePublication; period: string; valeurInitiale: ValeurPublication; valeurRevisée: ValeurPublication | null; timeApprox: true }
export async function chargerHistoriqueVersionsAlfred(type: TypePublication, connuLe: string, max = 12): Promise<VersionHistoriqueAlfred[]> {
  if (!Number.isInteger(max) || max <= 0 || !estDateCivile(connuLe)) return [];
  const maxBorne = Math.min(max, MAX_HISTORIQUE_ALFRED);
  const configuration = SERIE_ALFRED[type];
  const options = { debut: debutHistorique(connuLe, maxBorne), fin: connuLe, units: configuration.units };
  try {
    const [premieres, vue] = await Promise.all([chargerPremieresPublicationsAlfred(configuration.serie, options), chargerVueAlfred(configuration.serie, connuLe, options)]);
    const parPeriode = new Map(vue.map((observation) => [observation.periode, observation]));
    return premieres.filter((initiale) => initiale.connuDepuis <= connuLe).sort((a, b) => a.periode.localeCompare(b.periode)).slice(-maxBorne).map((initiale) => {
      const revisee = parPeriode.get(initiale.periode);
      return { type, period: initiale.periode.slice(0, 7), valeurInitiale: { label: "Première publication ALFRED", value: initiale.valeur, unit: configuration.unit, knownAt: initiale.connuDepuis, transformation: configuration.transformation }, valeurRevisée: revisee ? { label: "Vue ALFRED", value: revisee.valeur, unit: configuration.unit, knownAt: revisee.connuDepuis, transformation: configuration.transformation } : null, timeApprox: true };
    });
  } catch { return []; }
}

export type SurprisePublication =
  | { disponible: true; valeur: number; unit: "milliers" | "point de pourcentage" }
  | { disponible: false; raison: string };

function nombreConsensusStrict(value: number | string, suffixe: "%" | "K", unit?: string): number | null {
  if (unit !== undefined && unit !== suffixe) return null;
  if (typeof value === "number") return unit === suffixe ? value : null;
  const texte = value.trim();
  const pattern = suffixe === "%"
    ? /^([+-]?\d+(?:[.,]\d+)?)\s*%$/
    : /^([+-]?\d+(?:[.,]\d+)?)\s*K$/;
  const match = pattern.exec(texte);
  if (!match) return null;
  const nombre = Number(match[1]!.replace(",", "."));
  return Number.isFinite(nombre) ? nombre : null;
}

/** Actual − consensus, seulement lorsqu'une unité explicite rend les deux valeurs comparables. */
export function calculerSurprisePublication(archive: ArchivePublication): SurprisePublication {
  const consensus = archive.consensusAvantAnnonce;
  if (consensus === null) return { disponible: false, raison: "consensus historique non archivé" };
  if (archive.type === "nfp") {
    const attendu = nombreConsensusStrict(consensus.value, "K", consensus.unit);
    if (archive.actual.unit !== "milliers" || attendu === null) return { disponible: false, raison: "unités NFP non comparables" };
    return { disponible: true, valeur: archive.actual.value - attendu, unit: "milliers" };
  }
  const attendu = nombreConsensusStrict(consensus.value, "%", consensus.unit);
  if (archive.actual.unit !== "%" || attendu === null) return { disponible: false, raison: "unités non comparables" };
  return { disponible: true, valeur: archive.actual.value - attendu, unit: "point de pourcentage" };
}
