/** Capture synchrone des consensus ECO avant annonce, sans charger les archives ni ALFRED. */
import type { CaptureConsensus, IdentitePublication, MesurePublication, SourceArchive, TypePublication } from "./publicationArchive";

export const CLE_CONSENSUS = "axiom:eco:consensus:v2";
export const TYPES = new Set<TypePublication>(["cpi", "nfp", "pce", "retail"]);
export const MESURES = new Set<MesurePublication>(["cpi-global-mm-sa", "nfp-payems-change", "pce-core-mm-sa", "retail-nominal-mm"]);
const MESURE_PAR_TYPE: Readonly<Record<TypePublication, MesurePublication>> = {
  cpi: "cpi-global-mm-sa",
  nfp: "nfp-payems-change",
  pce: "pce-core-mm-sa",
  retail: "retail-nominal-mm",
};
export const MAX_ARCHIVES = 500;

const MAX_TEXTE = 240;

export function estObjet(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function assertCles(value: Record<string, unknown>, autorisees: readonly string[], nom: string): void {
  for (const cle of Object.keys(value)) if (!autorisees.includes(cle)) throw new Error(`${nom} : champ inconnu '${cle}'.`);
}
export function assertTexte(value: unknown, nom: string, max = MAX_TEXTE): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${nom} invalide.`);
  return value.trim();
}

export function assertTimestamp(value: unknown, nom: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < Date.UTC(2000, 0, 1) || value > Date.UTC(2101, 0, 1)) throw new Error(`${nom} invalide.`);
  return value;
}
export function normaliserSource(value: unknown): SourceArchive {
  if (!estObjet(value)) throw new Error("Source invalide.");
  assertCles(value, ["nom", "url"], "Source");
  const nom = assertTexte(value.nom, "Nom de source");
  const urlTexte = assertTexte(value.url, "URL source", 1_500);
  let url: URL;
  try { url = new URL(urlTexte); } catch { throw new Error("Source URL invalide."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Source URL non autorisée.");
  return { nom, url: url.toString() };
}

export function assertMesureDuType(type: TypePublication, mesure: MesurePublication, nom: string): void {
  if (MESURE_PAR_TYPE[type] !== mesure) throw new Error(`${nom} mesure incompatible avec le type.`);
}
export function cleEvenement(value: IdentitePublication & { publishedAt: number }): string { return `${value.country}:${value.mesure}:${value.publishedAt}`; }

/** Signale aux lecteurs UI un changement local, sans dépendance vers le store UI. */
export function notifierArchives(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("axiom:eco-archives-change"));
}

export function normaliserCapture(value: unknown): CaptureConsensus {
  if (!estObjet(value)) throw new Error("Capture consensus invalide.");
  assertCles(value, ["id", "type", "mesure", "country", "title", "publishedAt", "timeApprox", "consensus", "source", "collectedAt"], "Capture consensus");
  const id = assertTexte(value.id, "Identifiant capture", 160);
  if (typeof value.type !== "string" || !TYPES.has(value.type as TypePublication) || typeof value.mesure !== "string" || !MESURES.has(value.mesure as MesurePublication) || value.country !== "USD") throw new Error("Identité de capture invalide.");
  assertMesureDuType(value.type as TypePublication, value.mesure as MesurePublication, "Identité de capture");
  const publishedAt = assertTimestamp(value.publishedAt, "Heure de publication");
  if (typeof value.timeApprox !== "boolean") throw new Error("Précision horaire invalide.");
  if (!estObjet(value.consensus)) throw new Error("Consensus capture invalide.");
  assertCles(value.consensus, ["value", "unit"], "Consensus capture");
  if (typeof value.consensus.value !== "string" && (typeof value.consensus.value !== "number" || !Number.isFinite(value.consensus.value))) throw new Error("Consensus capture valeur invalide.");
  const unit = value.consensus.unit === undefined ? undefined : assertTexte(value.consensus.unit, "Consensus capture unité", 80);
  const collectedAt = assertTimestamp(value.collectedAt, "Collecte consensus");
  if (collectedAt >= publishedAt) throw new Error("Le consensus doit être collecté avant l'annonce.");
  return { id, type: value.type as TypePublication, mesure: value.mesure as MesurePublication, country: "USD", title: assertTexte(value.title, "Titre capture"), publishedAt, timeApprox: value.timeApprox, consensus: { value: value.consensus.value, ...(unit ? { unit } : {}) }, source: normaliserSource(value.source), collectedAt };
}

/** Rattachement ALFRED seulement aux évènements USD et à une mesure comparable. */
export function typePublicationDepuisEvenement(country: string, titre: string): IdentitePublication | null {
  if (country.trim().toUpperCase() !== "USD") return null;
  const normalise = titre.trim().replace(/\s+/g, " ").toLowerCase();
  if (/^core pce price index m\/m$/.test(normalise)) return { type: "pce", mesure: "pce-core-mm-sa", country: "USD" };
  if (/\bcore\b/.test(normalise)) return null;
  if (/^(cpi|consumer price index) m\/m$/.test(normalise)) return { type: "cpi", mesure: "cpi-global-mm-sa", country: "USD" };
  if (/^(nfp|non-?farm employment change|non-?farm payrolls|employment situation)$/.test(normalise)) return { type: "nfp", mesure: "nfp-payems-change", country: "USD" };
  if (/^retail sales m\/m$/.test(normalise)) return { type: "retail", mesure: "retail-nominal-mm", country: "USD" };
  return null;
}
/** Compatibilité limitée aux appelants anciens ; ne pas l'utiliser pour capturer ECO. */
export function typePublicationDepuisTitre(titre: string): TypePublication | null { return typePublicationDepuisEvenement("USD", titre)?.type ?? null; }

export function archiverConsensusAvantAnnonce(input: CaptureConsensus): CaptureConsensus | null {
  try { return normaliserCapture(input); } catch { return null; }
}
export function conserverConsensusAvantAnnonce(input: CaptureConsensus): boolean {
  const capture = archiverConsensusAvantAnnonce(input);
  if (capture === null) return false;
  try {
    if (typeof localStorage === "undefined") return false;
    const captures = lireCapturesConsensus();
    const index = captures.findIndex((item) => cleEvenement(item) === cleEvenement(capture));
    // Première collecte valable conservée : une lecture plus tardive ne réécrit pas l'historique.
    const estNouvelle = index < 0;
    if (estNouvelle) captures.push(capture);
    localStorage.setItem(CLE_CONSENSUS, JSON.stringify(captures));
    if (estNouvelle) notifierArchives();
    return true;
  } catch { return false; }
}
export function lireCapturesConsensus(): CaptureConsensus[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(CLE_CONSENSUS);
    if (!raw) return [];
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value) || value.length > MAX_ARCHIVES) return [];
    return value.map(normaliserCapture);
  } catch { return []; }
}
