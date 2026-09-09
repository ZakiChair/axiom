/**
 * Archive locale des publications macro et des consensus observés.
 *
 * Elle ne reconstitue jamais de consensus : une prévision n'est conservée que si sa
 * collecte est strictement antérieure à l'heure de publication connue. Les deux archives
 * BLS ci-dessous sont des communiqués effectivement consultés le 9 septembre 2026.
 */
import { chargerPremieresPublicationsAlfred, chargerVueAlfred } from "./alfred";

export type TypePublication = "cpi" | "nfp" | "pce" | "retail";

export interface SourceArchive {
  nom: string;
  url: string;
}

export interface ValeurPublication {
  label: string;
  value: number;
  unit: string;
}

export interface ConsensusArchive {
  value: number | string;
  unit?: string;
  collectedAt: number;
  source: string;
}

export interface ArchivePublication {
  id: string;
  type: TypePublication;
  /** Période statistique, distincte du jour de publication. */
  period: string;
  publishedAt: number;
  /** false uniquement quand le document source donne l'heure à la minute. */
  timeApprox: boolean;
  source: SourceArchive;
  actual: ValeurPublication;
  /** Niveau/valeur réellement publié à l'origine, quand il est disponible. */
  valeurInitiale?: ValeurPublication;
  /** Vue ultérieure ALFRED ; son millésime est affichable séparément. */
  valeurRevisée?: ValeurPublication;
  consensusAvantAnnonce: ConsensusArchive | null;
}

const CLE_ARCHIVES = "axiom:eco:publications:v1";
const CLE_CONSENSUS = "axiom:eco:consensus:v1";
const TYPES = new Set<TypePublication>(["cpi", "nfp", "pce", "retail"]);

export const ARCHIVES_INITIALES_PUBLIEES: readonly ArchivePublication[] = [
  {
    id: "cpi-2026-07",
    type: "cpi",
    period: "2026-07",
    publishedAt: Date.parse("2026-08-12T12:30:00Z"),
    timeApprox: false,
    source: {
      nom: "Bureau of Labor Statistics — Consumer Price Index",
      url: "https://www.bls.gov/news.release/archives/cpi_08122026.htm",
    },
    actual: { label: "CPI global m/m SA", value: 0.1, unit: "%" },
    valeurInitiale: { label: "CPI global a/a NSA", value: 3.4, unit: "%" },
    consensusAvantAnnonce: null,
  },
  {
    id: "nfp-2026-08",
    type: "nfp",
    period: "2026-08",
    publishedAt: Date.parse("2026-09-04T12:30:00Z"),
    timeApprox: false,
    source: {
      nom: "Bureau of Labor Statistics — Employment Situation",
      url: "https://www.bls.gov/news.release/archives/empsit_09042026.htm",
    },
    actual: { label: "Variation PAYEMS publiée", value: 162, unit: "milliers" },
    valeurInitiale: { label: "Niveau PAYEMS, première publication", value: 159075, unit: "milliers" },
    consensusAvantAnnonce: null,
  },
];

function estObjet(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertArchive(value: unknown): asserts value is ArchivePublication {
  if (!estObjet(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.period !== "string" || !/^\d{4}-\d{2}$/.test(value.period)) {
    throw new Error("Archive invalide : id et période YYYY-MM requis.");
  }
  if (typeof value.type !== "string" || !TYPES.has(value.type as TypePublication)) throw new Error("Archive invalide : type inconnu.");
  if (!Number.isFinite(value.publishedAt) || typeof value.timeApprox !== "boolean") throw new Error("Archive invalide : heure de publication requise.");
  if (!estObjet(value.source) || typeof value.source.nom !== "string" || !value.source.nom.trim() || typeof value.source.url !== "string" || !/^https:\/\/.+/.test(value.source.url)) {
    throw new Error("Archive invalide : source HTTPS requise.");
  }
  if (!estObjet(value.actual) || typeof value.actual.label !== "string" || !value.actual.label.trim() || !Number.isFinite(value.actual.value) || typeof value.actual.unit !== "string" || !value.actual.unit.trim()) {
    throw new Error("Archive invalide : valeur publiée requise.");
  }
  if (value.consensusAvantAnnonce !== null) {
    const consensus = value.consensusAvantAnnonce;
    if (!estObjet(consensus) || (typeof consensus.value !== "string" && !Number.isFinite(consensus.value)) || !Number.isFinite(consensus.collectedAt) || typeof consensus.source !== "string" || !consensus.source.trim()) {
      throw new Error("Archive invalide : consensus malformé.");
    }
    if ((consensus.collectedAt as number) >= (value.publishedAt as number)) throw new Error("Le consensus doit être collecté avant l'annonce.");
  }
}

/** Garde pure de capture : après H0, la prévision est inutilisable historiquement. */
export function archiverConsensusAvantAnnonce(input: {
  id: string;
  type: TypePublication;
  publishedAt: number;
  consensus: number | string;
  source: SourceArchive;
  collectedAt: number;
}): ConsensusArchive | null {
  if (!Number.isFinite(input.publishedAt) || !Number.isFinite(input.collectedAt) || input.collectedAt >= input.publishedAt) return null;
  if (typeof input.consensus !== "string" && !Number.isFinite(input.consensus)) return null;
  if (!input.id.trim() || !TYPES.has(input.type) || !input.source.nom.trim() || !/^https:\/\/.+/.test(input.source.url)) return null;
  return { value: input.consensus, collectedAt: input.collectedAt, source: input.source.nom };
}

/** Reconnaissance volontairement étroite : les titres ambigus ne produisent aucune archive. */
export function typePublicationDepuisTitre(titre: string): TypePublication | null {
  const normalise = titre.toLowerCase();
  if (/\b(cpi|consumer price index)\b/.test(normalise)) return "cpi";
  if (/\b(nfp|non-?farm|employment situation)\b/.test(normalise)) return "nfp";
  if (/\b(pce|personal income and outlays)\b/.test(normalise)) return "pce";
  if (/\b(retail sales|retail and food services)\b/.test(normalise)) return "retail";
  return null;
}

/** Persiste la capture séparément de la publication, qui n'existe pas encore avant H0. */
export function conserverConsensusAvantAnnonce(input: {
  id: string;
  type: TypePublication;
  publishedAt: number;
  consensus: number | string;
  source: SourceArchive;
  collectedAt: number;
}): boolean {
  const consensus = archiverConsensusAvantAnnonce(input);
  if (consensus === null) return false;
  try {
    if (typeof localStorage === "undefined") return false;
    const raw = localStorage.getItem(CLE_CONSENSUS);
    const existants = raw ? JSON.parse(raw) as Record<string, ConsensusArchive> : {};
    existants[input.id] = consensus;
    localStorage.setItem(CLE_CONSENSUS, JSON.stringify(existants));
    return true;
  } catch {
    return false;
  }
}

/** Importe un JSON strict ; aucun secret ne fait partie du modèle autorisé. */
export function importerArchivesPublications(json: string): ArchivePublication[] {
  let brut: unknown;
  try {
    brut = JSON.parse(json);
  } catch {
    throw new Error("Import JSON invalide.");
  }
  if (!estObjet(brut) || brut.version !== 1 || !Array.isArray(brut.archives)) throw new Error("Import d'archive incompatible.");
  const ids = new Set<string>();
  return brut.archives.map((archive) => {
    assertArchive(archive);
    if (ids.has(archive.id)) throw new Error("Import d'archive : identifiant dupliqué.");
    ids.add(archive.id);
    return archive;
  });
}

export function exporterArchivesPublications(archives: readonly ArchivePublication[]): string {
  archives.forEach(assertArchive);
  return JSON.stringify({ version: 1, archives });
}

export function lireArchivesPublications(): ArchivePublication[] {
  try {
    if (typeof localStorage === "undefined") return [...ARCHIVES_INITIALES_PUBLIEES];
    const raw = localStorage.getItem(CLE_ARCHIVES);
    const importees = raw ? importerArchivesPublications(raw) : [];
    return fusionnerArchives([...ARCHIVES_INITIALES_PUBLIEES, ...importees]);
  } catch {
    return [...ARCHIVES_INITIALES_PUBLIEES];
  }
}

export function ecrireArchivesPublications(archives: readonly ArchivePublication[]): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(CLE_ARCHIVES, exporterArchivesPublications(archives));
    return true;
  } catch {
    return false;
  }
}

export function fusionnerArchives(archives: readonly ArchivePublication[]): ArchivePublication[] {
  const parId = new Map<string, ArchivePublication>();
  for (const archive of archives) parId.set(archive.id, archive);
  return [...parId.values()].sort((a, b) => a.publishedAt - b.publishedAt);
}

const SERIE_ALFRED: Record<TypePublication, { serie: string; units?: string; unit: string }> = {
  cpi: { serie: "CPIAUCSL", units: "pch", unit: "%" },
  nfp: { serie: "PAYEMS", unit: "milliers" },
  pce: { serie: "PCEPILFE", units: "pch", unit: "%" },
  retail: { serie: "RSAFS", unit: "millions USD nominaux" },
};

function bornesPeriode(period: string): { debut: string; fin: string } {
  const [annee, mois] = period.split("-").map(Number);
  const fin = new Date(Date.UTC(annee!, mois!, 0)).toISOString().slice(0, 10);
  return { debut: `${period}-01`, fin };
}

/**
 * Rattache une première publication et une vue ALFRED connue à date donnée. La variation
 * NFP publiée n'est volontairement jamais reconstruite par différence de deux vintages :
 * cette fonction expose des niveaux, chacun avec son propre millésime.
 */
export async function chargerVersionsAlfredPublication(
  archive: ArchivePublication,
  connuLe: string,
): Promise<ArchivePublication> {
  const configuration = SERIE_ALFRED[archive.type];
  const bornes = bornesPeriode(archive.period);
  try {
    const options = { ...bornes, units: configuration.units };
    const [premieres, vue] = await Promise.all([
      chargerPremieresPublicationsAlfred(configuration.serie, options),
      chargerVueAlfred(configuration.serie, connuLe, options),
    ]);
    const initiale = premieres.find((point) => point.periode === bornes.debut);
    const revisee = vue.find((point) => point.periode === bornes.debut);
    return {
      ...archive,
      valeurInitiale: initiale
        ? { label: `Niveau ALFRED, première publication (${initiale.connuDepuis})`, value: initiale.valeur, unit: configuration.unit }
        : archive.valeurInitiale,
      valeurRevisée: revisee
        ? { label: `Niveau ALFRED, connu le ${connuLe}`, value: revisee.valeur, unit: configuration.unit }
        : undefined,
    };
  } catch {
    return archive;
  }
}

export interface VersionHistoriqueAlfred {
  type: TypePublication;
  period: string;
  valeurInitiale: number;
  valeurRevisée: number | null;
  connuDepuisInitial: string;
  connuDepuisRevision: string | null;
  /** ALFRED date au jour : aucune heure de publication n'est inventée. */
  timeApprox: true;
}

function debutHistorique(connuLe: string, max: number): string {
  const [annee, mois] = connuLe.slice(0, 7).split("-").map(Number);
  const date = new Date(Date.UTC(annee!, mois! - 1 - Math.max(max + 2, 6), 1));
  return date.toISOString().slice(0, 10);
}

/** Historique borné des premières publications et de leur vue révisée, par période. */
export async function chargerHistoriqueVersionsAlfred(
  type: TypePublication,
  connuLe: string,
  max = 12,
): Promise<VersionHistoriqueAlfred[]> {
  if (!Number.isInteger(max) || max <= 0) return [];
  const configuration = SERIE_ALFRED[type];
  const options = { debut: debutHistorique(connuLe, max), fin: connuLe, units: configuration.units };
  try {
    const [premieres, vue] = await Promise.all([
      chargerPremieresPublicationsAlfred(configuration.serie, options),
      chargerVueAlfred(configuration.serie, connuLe, options),
    ]);
    const parPeriode = new Map(vue.map((observation) => [observation.periode, observation]));
    return premieres
      .slice()
      .sort((a, b) => a.periode.localeCompare(b.periode))
      .slice(-max)
      .map((initiale) => {
        const revisee = parPeriode.get(initiale.periode);
        return {
          type,
          period: initiale.periode.slice(0, 7),
          valeurInitiale: initiale.valeur,
          valeurRevisée: revisee?.valeur ?? null,
          connuDepuisInitial: initiale.connuDepuis,
          connuDepuisRevision: revisee?.connuDepuis ?? null,
          timeApprox: true,
        };
      });
  } catch {
    return [];
  }
}
