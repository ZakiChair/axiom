import { getDefillamaProKey } from "../../store/defillamaKey";

export type TypeUnlock = "cliff" | "lineaire" | "autre";
export interface EvenementUnlock {
  date: number;
  quantite: number;
  type: TypeUnlock;
  categorie: string | null;
  description: string | null;
}
export interface TokenUnlock {
  id: string;
  nom: string;
  offreCirculante: number | null;
  /** Jamais déduit de circSupply : renseigné seulement par une source ajustée distincte. */
  flottantAjuste: number | null;
  sources: string[];
  events: EvenementUnlock[];
  prochaineDate: number | null;
  prochaineQuantite: number | null;
  capitalisationUsd: number | null;
  denominateurs: {
    prixUsd: Denominateur | null;
    volume24hUsd: Denominateur | null;
    flottantAjuste: Denominateur | null;
  };
}
export interface Denominateur { valeur: number; source: string; observeLe: number }
export interface BridgeVolume {
  date: number;
  entrantsUsd: number | null;
  sortantsUsd: number | null;
  netUsd: number | null;
  txEntrantes: number | null;
  txSortantes: number | null;
}
export interface DetailEmission {
  notes: string[];
  sources: string[];
  lastModified: number | null;
  seriesCumulees: Array<{ label: string; points: Array<{ date: number; unlockedCumule: number | null; emissionBruteCumulee: number | null; burnedCumule: number | null }> }>;
}

const fini = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const SOURCE_MARCHE = "CoinGecko /coins/markets (contexte actuel)";
const PARAMETRE_SECRET = /^(?:api[-_]?key|key|token|access[-_]?token|auth(?:orization)?|secret|password|credential)$/i;

/** URL de provenance cliquable sans credential intégré ni secret en query. */
const https = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try {
    const url = new URL(v);
    return url.protocol === "https:" && url.username === "" && url.password === "" &&
      [...url.searchParams.keys()].every((key) => !PARAMETRE_SECRET.test(key));
  } catch { return false; }
};

export function mapperEmissions(brut: unknown): TokenUnlock[] | null {
  if (!Array.isArray(brut)) return null;
  const out: TokenUnlock[] = [];
  for (const row of brut) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.gecko_id === "string" ? r.gecko_id : null;
    const nom = typeof r.name === "string" ? r.name : id;
    const sources = Array.isArray(r.sources) ? r.sources.filter(https) : [];
    if (!id || !nom || sources.length === 0) continue;
    const events: EvenementUnlock[] = [];
    if (Array.isArray(r.events)) for (const event of r.events) {
      if (!event || typeof event !== "object") continue;
      const e = event as Record<string, unknown>;
      const sec = fini(e.timestamp);
      const quantites = Array.isArray(e.noOfTokens) ? e.noOfTokens.map(fini).filter((x): x is number => x !== null && x >= 0) : [];
      if (sec === null || sec <= 0 || quantites.length === 0) continue;
      const rawType = typeof e.unlockType === "string" ? e.unlockType.toLowerCase() : "";
      events.push({
        date: sec * 1000,
        quantite: quantites.reduce((a, b) => a + b, 0),
        type: rawType === "cliff" ? "cliff" : rawType.includes("linear") ? "lineaire" : "autre",
        categorie: typeof e.category === "string" ? e.category : null,
        description: typeof e.description === "string" ? e.description : null,
      });
    }
    const next = r.nextEvent && typeof r.nextEvent === "object" ? r.nextEvent as Record<string, unknown> : null;
    const nextSec = fini(next?.date);
    out.push({ id, nom, offreCirculante: fini(r.circSupply), flottantAjuste: null, sources,
      events: events.sort((a, b) => a.date - b.date), prochaineDate: nextSec && nextSec > 0 ? nextSec * 1000 : null,
      prochaineQuantite: fini(next?.toUnlock), capitalisationUsd: fini(r.mcap),
      denominateurs: { prixUsd: null, volume24hUsd: null, flottantAjuste: null } });
  }
  return out;
}

export function enrichirDenominateurs(tokens: readonly TokenUnlock[], marches: ReadonlyArray<{ id: string; price: number; volume24hUsd: number | null; observeLe?: number | null }>): TokenUnlock[] {
  const parId = new Map(marches.map((m) => [m.id, m]));
  return tokens.map((token) => {
    const marche = parId.get(token.id); const observeLe = marche?.observeLe ?? null;
    const observationValide = observeLe !== null && Number.isFinite(observeLe) && observeLe > 1_230_768_000_000 && observeLe <= Date.now() + 5 * 60_000;
    return { ...token, denominateurs: {
      prixUsd: marche && observationValide && marche.price > 0 && Number.isFinite(marche.price) ? { valeur: marche.price, source: SOURCE_MARCHE, observeLe } : null,
      volume24hUsd: marche && observationValide && marche.volume24hUsd !== null && marche.volume24hUsd !== undefined && marche.volume24hUsd > 0 ? { valeur: marche.volume24hUsd, source: SOURCE_MARCHE, observeLe } : null,
      flottantAjuste: token.denominateurs.flottantAjuste,
    } };
  });
}

export function mapperBridgeVolumes(brut: unknown): BridgeVolume[] | null {
  if (!Array.isArray(brut)) return null;
  const out: BridgeVolume[] = [];
  for (const row of brut) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const sec = typeof r.date === "string" && /^\d+$/.test(r.date) ? Number(r.date) : null;
    if (sec === null || !Number.isFinite(sec) || sec * 1000 <= 1_230_768_000_000 || sec * 1000 > Date.now() + 5 * 60_000) continue;
    const entrantsUsd = fini(r.depositUSD); const sortantsUsd = fini(r.withdrawUSD);
    if ((entrantsUsd !== null && entrantsUsd < 0) || (sortantsUsd !== null && sortantsUsd < 0)) continue;
    out.push({ date: sec * 1000, entrantsUsd, sortantsUsd,
      netUsd: entrantsUsd === null || sortantsUsd === null ? null : entrantsUsd - sortantsUsd,
      txEntrantes: fini(r.depositTxs), txSortantes: fini(r.withdrawTxs) });
  }
  return out.sort((a, b) => a.date - b.date);
}

/** Type de l'événement exactement relié à `prochaineDate`, jamais déduit du passé. */
export function typeProchainUnlock(token: TokenUnlock): TypeUnlock | null {
  if (token.prochaineDate === null) return null;
  const types = new Set(token.events.filter((event) => event.date === token.prochaineDate).map((event) => event.type));
  return types.size === 1 ? [...types][0] ?? null : null;
}

export function mapperDetailEmission(brut: unknown): DetailEmission | null {
  if (!brut || typeof brut !== "object") return null;
  const root = brut as Record<string, unknown>;
  const body = root.body && typeof root.body === "object" ? root.body as Record<string, unknown> : null;
  if (!body) return null;
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : {};
  const documented = body.documentedData && typeof body.documentedData === "object" ? body.documentedData as Record<string, unknown> : {};
  const seriesCumulees: DetailEmission["seriesCumulees"] = [];
  if (Array.isArray(documented.data)) for (const section of documented.data) {
    if (!section || typeof section !== "object") continue;
    const s = section as Record<string, unknown>;
    if (typeof s.label !== "string" || !Array.isArray(s.data)) continue;
    const points = s.data.flatMap((point) => {
      if (!point || typeof point !== "object") return [];
      const p = point as Record<string, unknown>; const ts = fini(p.timestamp);
      return ts && ts > 0 ? [{ date: ts * 1000, unlockedCumule: fini(p.unlocked), emissionBruteCumulee: fini(p.rawEmission), burnedCumule: fini(p.burned) }] : [];
    });
    seriesCumulees.push({ label: s.label, points });
  }
  const parsedModified = typeof root.lastModified === "string" ? Date.parse(root.lastModified) : NaN;
  return { notes: Array.isArray(metadata.notes) ? metadata.notes.filter((v): v is string => typeof v === "string") : [], sources: Array.isArray(metadata.sources) ? metadata.sources.filter(https) : [], lastModified: Number.isFinite(parsedModified) ? parsedModified : null, seriesCumulees };
}

export function calculerRatiosUnlock(quantite: number, flottant: number | null, volume24hUsd: number | null,
  prixUsd: number | null = null): { pctFlottant: number | null; pctVolume24h: number | null } {
  const pctFlottant = flottant !== null && flottant > 0 ? quantite / flottant * 100 : null;
  const notionnel = prixUsd !== null && prixUsd > 0 ? quantite * prixUsd : null;
  return { pctFlottant, pctVolume24h: notionnel !== null && volume24hUsd !== null && volume24hUsd > 0 ? notionnel / volume24hUsd * 100 : null };
}

export function cheminDefillamaPro(local: string): string | null {
  const [path, query = ""] = local.replace(/^\/+/, "").split("?", 2);
  if (path === "emissions" && query === "") return "/api/emissions";
  const emission = /^emission\/([a-z0-9][a-z0-9-]{0,79})$/i.exec(path ?? "");
  if (emission && query === "") return `/api/emission/${emission[1]}`;
  const bridge = /^bridgevolume\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/.exec(path ?? "");
  if (bridge) {
    const params = new URLSearchParams(query);
    if ([...params.keys()].some((key) => key !== "id") || params.getAll("id").length > 1) return null;
    const id = params.get("id");
    if (id !== null && (!/^\d{1,9}$/.test(id) || Number(id) < 1)) return null;
    return `/bridges/bridgevolume/${bridge[1]}${id ? `?id=${id}` : ""}`;
  }
  return null;
}

export class ErreurAccesDefillama extends Error { constructor(readonly statut: number) {
  super(statut === 401 ? "Clé DefiLlama Pro absente ou refusée." : statut === 402 || statut === 403 ? "Abonnement DefiLlama Pro requis ou accès refusé." : statut === 429 ? "Quota DefiLlama Pro atteint." : "Données DefiLlama Pro indisponibles.");
} }

export async function chargerDefillamaPro(path: string, signal?: AbortSignal): Promise<unknown> {
  const key = getDefillamaProKey();
  if (key === null) throw new ErreurAccesDefillama(401);
  const allowed = cheminDefillamaPro(path);
  if (allowed === null) throw new ErreurAccesDefillama(400);
  const response = await fetch(`/defillamapro/${path}`, { headers: { "x-defillama-pro-key": key, accept: "application/json" }, cache: "no-store", redirect: "error", signal });
  if (!response.ok) throw new ErreurAccesDefillama(response.status);
  return response.json();
}

export function exporterCalendrier(tokens: TokenUnlock[]): string {
  const valides = tokens.filter((t) => t.sources.length > 0 && t.sources.every(https)).map((t) => ({
    id: t.id, nom: t.nom, offreCirculante: t.offreCirculante, flottantAjuste: t.flottantAjuste,
    sources: [...t.sources], events: t.events.map((e) => ({ date: e.date, quantite: e.quantite, type: e.type, categorie: e.categorie, description: e.description })),
    prochaineDate: t.prochaineDate, prochaineQuantite: t.prochaineQuantite, capitalisationUsd: t.capitalisationUsd,
    denominateurs: {
      prixUsd: t.denominateurs.prixUsd ? { ...t.denominateurs.prixUsd } : null,
      volume24hUsd: t.denominateurs.volume24hUsd ? { ...t.denominateurs.volume24hUsd } : null,
      flottantAjuste: t.denominateurs.flottantAjuste ? { ...t.denominateurs.flottantAjuste } : null,
    },
  }));
  return JSON.stringify({ version: 1, source: "DefiLlama Pro + documents liés", sourcesValidees: true, exporteLe: Date.now(), tokens: valides });
}

export function importerCalendrier(texte: string): TokenUnlock[] | null {
  try {
    if (texte.length > 8 * 1024 * 1024) return null;
    const doc = JSON.parse(texte) as { version?: unknown; sourcesValidees?: unknown; tokens?: unknown };
    const root = doc as Record<string, unknown>;
    if (!clesExactes(doc, ["version", "source", "sourcesValidees", "exporteLe", "tokens"]) || doc.version !== 1 || doc.sourcesValidees !== true || typeof root.source !== "string" || root.source.length > 300 || typeof root.exporteLe !== "number" || !Number.isFinite(root.exporteLe) || root.exporteLe < 1_230_768_000_000 || root.exporteLe > 7_258_118_400_000 || !Array.isArray(doc.tokens) || doc.tokens.length > 5_000) return null;
    const rows = doc.tokens as unknown[];
    if (!rows.every(tokenImportValide)) return null;
    return rows as TokenUnlock[];
  } catch { return null; }
}

function clesExactes(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key)) && allowed.every((key) => key in value);
}

function denominateurValide(v: unknown, flottant = false): v is Denominateur | null {
  if (v === null) return true;
  if (!v || typeof v !== "object" || !clesExactes(v, ["valeur", "source", "observeLe"])) return false;
  const d = v as Record<string, unknown>;
  const sourceValide = d.source === SOURCE_MARCHE || https(d.source);
  return typeof d.valeur === "number" && Number.isFinite(d.valeur) && d.valeur > 0 && d.valeur < 1e30 && typeof d.source === "string" && d.source.length > 0 && d.source.length <= 500 && sourceValide && (!flottant || https(d.source)) && typeof d.observeLe === "number" && Number.isFinite(d.observeLe) && d.observeLe > 1_230_768_000_000 && d.observeLe <= Date.now() + 5 * 60_000;
}

function tokenImportValide(v: unknown): v is TokenUnlock {
  if (!v || typeof v !== "object" || !clesExactes(v, ["id", "nom", "offreCirculante", "flottantAjuste", "sources", "events", "prochaineDate", "prochaineQuantite", "capitalisationUsd", "denominateurs"])) return false;
  const t = v as Record<string, unknown>;
  if (typeof t.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/i.test(t.id) || typeof t.nom !== "string" || t.nom.length === 0 || t.nom.length > 200) return false;
  if (!Array.isArray(t.sources) || t.sources.length === 0 || t.sources.length > 20 || !t.sources.every((s) => https(s) && s.length <= 2_000)) return false;
  if (!Array.isArray(t.events) || t.events.length > 10_000 || !t.events.every(evenementImportValide)) return false;
  const d = t.denominateurs as Record<string, unknown> | null;
  if (!d || !clesExactes(d, ["prixUsd", "volume24hUsd", "flottantAjuste"]) || !denominateurValide(d.prixUsd) || !denominateurValide(d.volume24hUsd) || !denominateurValide(d.flottantAjuste, true)) return false;
  for (const key of ["offreCirculante", "flottantAjuste", "prochaineDate", "prochaineQuantite", "capitalisationUsd"] as const) if (t[key] !== null && (typeof t[key] !== "number" || !Number.isFinite(t[key]) || t[key] < 0 || t[key] > 1e30)) return false;
  const prochaineDate = t.prochaineDate;
  if (prochaineDate !== null && (typeof prochaineDate !== "number" || prochaineDate < 1_230_768_000_000 || prochaineDate > 7_258_118_400_000)) return false;
  if (d.flottantAjuste !== null && t.flottantAjuste !== (d.flottantAjuste as Denominateur).valeur) return false;
  return true;
}

function evenementImportValide(v: unknown): boolean {
  if (!v || typeof v !== "object" || !clesExactes(v, ["date", "quantite", "type", "categorie", "description"])) return false;
  const e = v as Record<string, unknown>;
  return typeof e.date === "number" && Number.isFinite(e.date) && e.date > 1_230_768_000_000 && e.date < 7_258_118_400_000 && typeof e.quantite === "number" && Number.isFinite(e.quantite) && e.quantite >= 0 && e.quantite < 1e30 && ["cliff", "lineaire", "autre"].includes(String(e.type)) && (e.categorie === null || typeof e.categorie === "string" && e.categorie.length <= 200) && (e.description === null || typeof e.description === "string" && e.description.length <= 2_000);
}
