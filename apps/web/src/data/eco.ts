/**
 * Calendrier économique (ECO) — fusion de TROIS sources, sans backend dédié.
 *
 * Sources (toutes gratuites, routées par des proxys same-origin existants) :
 *   1. ForexFactory  : /extapi/nfs.faireconomy.media/ff_calendar_thisweek.json
 *        → LA source riche (impact, prévision, précédent, actuel) sur la semaine
 *          courante, TOUTES devises. Sans en-tête CORS → proxy générique /extapi.
 *          Débit respecté : au plus 2 fetch / 5 min + cache localStorage 12 h
 *          (1 poll par session en usage normal).
 *   2. FRED releases : /fredapi/fred/releases/dates (clé injectée par le proxy)
 *        → calendrier de publication des statistiques US AU-DELÀ de la semaine FF
 *          (schedule à venir). Pas d'impact/prévision côté FRED : on ne RETIENT
 *          qu'un jeu CURÉ de publications qui font bouger le marché (CPI, NFP, GDP…),
 *          en leur assignant un impact connu ; le reste (bruit) est ignoré.
 *   3. FOMC (statique): dates de décision 2026-2027 codées en dur (cf. constante).
 *
 * Ce module est PUR pour tout le parsing / la fusion / le mapping d'impact (testé
 * dans eco.test.ts). Il expose en plus un orchestrateur `chargerEvenementsEco`
 * (fetch + cache + garde de débit + santé) — la seule partie à effet de bord.
 *
 * Dégradation gracieuse : toute source en panne est simplement absente du résultat
 * (aucune exception propagée). Sans réseau du tout, on renvoie au moins les dates
 * FOMC statiques (+ le cache s'il existe).
 */
import { extUrl } from "./extapi";
import { healthStore } from "../store/health";

// ─────────────────────────── Types ───────────────────────────

/** Niveau d'impact d'un évènement (badge + filtre + marqueurs « fort impact »). */
export type EcoImpact = "high" | "medium" | "low" | "holiday";

/** Provenance d'un évènement fusionné. */
export type EcoSource = "forexfactory" | "fred" | "fomc";

/** Un évènement du calendrier, normalisé et indépendant de la source. */
export interface EcoEvent {
  /** Identifiant stable (dédoublonnage + clé de rendu). */
  id: string;
  /** Horodatage ms epoch (UTC). */
  time: number;
  /** Devise / région concernée (ex. « USD », « EUR »). */
  country: string;
  /** Intitulé de l'évènement. */
  title: string;
  /** Impact estimé. */
  impact: EcoImpact;
  /** Source d'origine. */
  source: EcoSource;
  /** Prévision consensus (chaîne brute FF), si connue. */
  forecast?: string;
  /** Valeur précédente (chaîne brute FF), si connue. */
  previous?: string;
  /** Valeur publiée (chaîne brute FF), si déjà sortie. */
  actual?: string;
  /** Vrai quand l'HEURE est approximée (FRED/FOMC ne donnent qu'une date). */
  timeApprox?: boolean;
}

/** Poids ordinal d'un impact (tri secondaire + seuil des marqueurs). */
export function rangImpact(impact: EcoImpact): number {
  switch (impact) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    case "holiday":
      return 0;
  }
}

// ─────────────────────────── 1) ForexFactory ───────────────────────────

/** Mappe l'impact ForexFactory (« High »/« Medium »/« Low »/« Holiday ») → EcoImpact. */
export function mapImpactFf(brut: unknown): EcoImpact {
  const s = typeof brut === "string" ? brut.trim().toLowerCase() : "";
  if (s === "high") return "high";
  if (s === "medium") return "medium";
  if (s === "holiday") return "holiday";
  return "low"; // « Low » et tout inconnu → faible (jamais un marqueur fort)
}

/** Normalise un intitulé pour la clé de dédoublonnage (minuscules, alphanumérique). */
function normaliserTitre(titre: string): string {
  return titre.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Construit l'identifiant stable d'un évènement. */
function idEvenement(source: EcoSource, time: number, titre: string): string {
  return `${source}:${time}:${normaliserTitre(titre)}`;
}

/** Chaîne non vide nettoyée, ou undefined (pour forecast/previous/actual). */
function champ(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Une entrée brute du flux ff_calendar_thisweek.json (champs utiles). */
interface EntreeFf {
  title?: unknown;
  country?: unknown;
  date?: unknown;
  impact?: unknown;
  forecast?: unknown;
  previous?: unknown;
  actual?: unknown;
}

/**
 * Parse le flux ForexFactory (tableau JSON). Tolérant : ignore toute entrée sans
 * intitulé ou sans date exploitable. `date` est un ISO 8601 avec offset de fuseau
 * (ex. « 2026-06-30T08:30:00-04:00 ») → l'epoch obtenu est correct quel que soit le
 * fuseau local. Fonction PURE.
 */
export function parseForexFactory(donnees: unknown): EcoEvent[] {
  if (!Array.isArray(donnees)) return [];
  const out: EcoEvent[] = [];
  for (const brut of donnees as EntreeFf[]) {
    const titre = champ(brut?.title);
    const dateStr = typeof brut?.date === "string" ? brut.date : "";
    const time = Date.parse(dateStr);
    if (titre === undefined || !Number.isFinite(time)) continue;
    const country = champ(brut?.country) ?? "—";
    out.push({
      id: idEvenement("forexfactory", time, titre),
      time,
      country,
      title: titre,
      impact: mapImpactFf(brut?.impact),
      source: "forexfactory",
      forecast: champ(brut?.forecast),
      previous: champ(brut?.previous),
      actual: champ(brut?.actual),
    });
  }
  return out;
}

// ─────────────────────────── 2) FRED releases ───────────────────────────

/**
 * Publications FRED CURÉES qui font bouger le marché. FRED expose > 1000 « releases » :
 * on ne garde que ces publications US majeures (repérées par MOTIF sur `release_name`,
 * les intitulés étant stables côté FRED) et on leur assigne un impact connu — le reste
 * est ignoré pour ne pas noyer le calendrier. Motifs en minuscules (test insensible à
 * la casse). Source des intitulés : https://api.stlouisfed.org/fred/releases
 */
const FRED_CURATION: ReadonlyArray<{ motif: string; impact: EcoImpact }> = [
  { motif: "consumer price index", impact: "high" }, // CPI
  { motif: "employment situation", impact: "high" }, // NFP / chômage
  { motif: "gross domestic product", impact: "high" }, // PIB
  { motif: "personal income and outlays", impact: "high" }, // PCE (inflation Fed)
  { motif: "retail and food services", impact: "high" }, // ventes au détail
  { motif: "producer price index", impact: "medium" }, // PPI
  { motif: "job openings and labor turnover", impact: "medium" }, // JOLTS
  { motif: "unemployment insurance weekly claims", impact: "medium" }, // inscriptions chômage
  { motif: "industrial production", impact: "low" },
  { motif: "new residential construction", impact: "low" }, // mises en chantier
  { motif: "money stock measures", impact: "low" }, // M2 (H.6)
];

/** Impact curé d'une publication FRED (ou null si hors périmètre → à ignorer). */
export function impactPublicationFred(nom: string): EcoImpact | null {
  const n = nom.toLowerCase();
  for (const { motif, impact } of FRED_CURATION) {
    if (n.includes(motif)) return impact;
  }
  return null;
}

/** Réponse partielle de /fred/releases/dates (champs utiles). */
interface ReponseFredReleases {
  release_dates?: Array<{ release_id?: unknown; release_name?: unknown; date?: unknown }>;
}

/**
 * Heure d'ancrage par défaut des publications FRED, en UTC. FRED ne donne qu'une DATE
 * (« YYYY-MM-DD ») ; la majorité des statistiques US sortent à 08:30 heure de l'Est,
 * soit ~12:30 UTC (heure d'été). On pose donc l'heure à 12:30 UTC et on marque
 * `timeApprox` — l'exactitude vient de ForexFactory pour la semaine courante.
 */
const FRED_HEURE_UTC_MS = (12 * 60 + 30) * 60 * 1000;

/**
 * Parse /fred/releases/dates en ne retenant que les publications curées. `date` est
 * « YYYY-MM-DD » (sans heure) → ancrée à FRED_HEURE_UTC_MS (approx.). Fonction PURE.
 */
export function parseFredReleases(donnees: unknown): EcoEvent[] {
  const rep = donnees as ReponseFredReleases | null;
  const liste = rep?.release_dates;
  if (!Array.isArray(liste)) return [];
  const out: EcoEvent[] = [];
  for (const r of liste) {
    const nom = champ(r?.release_name);
    const dateStr = typeof r?.date === "string" ? r.date : "";
    if (nom === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    const impact = impactPublicationFred(nom);
    if (impact === null) continue; // publication non curée → ignorée
    const jour = Date.parse(`${dateStr}T00:00:00Z`);
    if (!Number.isFinite(jour)) continue;
    const time = jour + FRED_HEURE_UTC_MS;
    out.push({
      id: idEvenement("fred", time, nom),
      time,
      country: "USD",
      title: nom,
      impact,
      source: "fred",
      timeApprox: true,
    });
  }
  return out;
}

// ─────────────────────────── 3) FOMC (statique) ───────────────────────────

/**
 * Dates des décisions du FOMC 2026-2027 (2ᵉ jour de réunion = jour de la décision).
 * Source : calendrier officiel Réserve fédérale (federalreserve.gov/monetarypolicy/
 * fomccalendars.htm). La décision est publiée à 14:00 heure de l'Est ≈ 18:00 UTC
 * (heure d'été) / 19:00 UTC (heure d'hiver) — on pose 18:30 UTC en compromis et on
 * marque `timeApprox`. Ces dates COMPLÈTENT ForexFactory au-delà de la semaine courante.
 */
export const FOMC_DATES: readonly string[] = [
  // 2026
  "2026-01-28",
  "2026-03-18",
  "2026-04-29",
  "2026-06-17",
  "2026-07-29",
  "2026-09-16",
  "2026-10-28",
  "2026-12-09",
  // 2027 (susceptible d'ajustement quand la Fed publiera le calendrier définitif)
  "2027-01-27",
  "2027-03-17",
  "2027-04-28",
  "2027-06-16",
  "2027-07-28",
  "2027-09-22",
  "2027-11-03",
  "2027-12-15",
];

/** Heure d'ancrage de la décision FOMC en UTC (≈14:00 ET, cf. commentaire). */
const FOMC_HEURE_UTC_MS = (18 * 60 + 30) * 60 * 1000;

/** Construit les évènements FOMC statiques (décision de taux directeur). Fonction PURE. */
export function evenementsFomc(): EcoEvent[] {
  const out: EcoEvent[] = [];
  for (const d of FOMC_DATES) {
    const jour = Date.parse(`${d}T00:00:00Z`);
    if (!Number.isFinite(jour)) continue;
    const time = jour + FOMC_HEURE_UTC_MS;
    const title = "Décision FOMC (taux directeur)";
    out.push({
      id: idEvenement("fomc", time, title),
      time,
      country: "USD",
      title,
      impact: "high",
      source: "fomc",
      timeApprox: true,
    });
  }
  return out;
}

// ─────────────────────────── Fusion & tri ───────────────────────────

/** Clé de JOUR UTC (« YYYY-MM-DD ») d'un horodatage ms. */
function jourUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Fusionne les trois sources et trie chronologiquement (à venir en tête après filtrage
 * amont ; ici tri ascendant brut). Règle de dédoublonnage : ForexFactory fait AUTORITÉ
 * sur les jours qu'il couvre (heures + impact + prévisions exacts). On écarte donc toute
 * entrée FRED/FOMC tombant un jour DÉJÀ présent dans le jeu FF — elles ne servent qu'à
 * prolonger le calendrier AU-DELÀ de la semaine FF. Dédoublonnage résiduel par `id`.
 * Fonction PURE.
 */
export function fusionnerEvenementsEco(
  ff: EcoEvent[],
  fred: EcoEvent[],
  fomc: EcoEvent[]
): EcoEvent[] {
  const joursFf = new Set(ff.map((e) => jourUtc(e.time)));
  const horsFf = (e: EcoEvent): boolean => !joursFf.has(jourUtc(e.time));
  const fusion = [...ff, ...fred.filter(horsFf), ...fomc.filter(horsFf)];

  const vus = new Set<string>();
  const uniques: EcoEvent[] = [];
  for (const e of fusion) {
    if (vus.has(e.id)) continue;
    vus.add(e.id);
    uniques.push(e);
  }
  uniques.sort((a, b) => a.time - b.time || rangImpact(b.impact) - rangImpact(a.impact));
  return uniques;
}

// ─────────────────────────── Orchestrateur (effet de bord) ───────────────────────────

const CACHE_KEY = "axiom:eco:cache:v1";
const FETCH_LOG_KEY = "axiom:eco:fetchLog:v1";
/** TTL du cache : 12 h (le calendrier bouge lentement). */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** Garde de débit ForexFactory : au plus 2 fetch par fenêtre de 5 min. */
const RATE_MAX = 2;
const RATE_WINDOW_MS = 5 * 60 * 1000;

/** Fenêtre FRED : à partir d'aujourd'hui jusqu'à ~45 j en avant (calendrier à venir). */
const FRED_FENETRE_JOURS = 45;

const HEALTH_FF = "eco:forexfactory";
const HEALTH_FRED = "eco:fred";

interface CacheEco {
  ts: number;
  events: EcoEvent[];
}

/** Lecture tolérante du cache (localStorage absent / JSON corrompu → null). */
function lireCache(): CacheEco | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<CacheEco> | null;
    if (!p || typeof p.ts !== "number" || !Array.isArray(p.events)) return null;
    return { ts: p.ts, events: p.events as EcoEvent[] };
  } catch {
    return null;
  }
}

/** Écriture tolérante du cache (best-effort). */
function ecrireCache(events: EcoEvent[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), events }));
  } catch {
    /* best-effort : la persistance du calendrier n'est pas bloquante */
  }
}

/** Horodatages des fetch récents (purgés hors fenêtre). */
function lireFetchLog(): number[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(FETCH_LOG_KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(p)) return [];
    const now = Date.now();
    return p.filter((t): t is number => typeof t === "number" && now - t < RATE_WINDOW_MS);
  } catch {
    return [];
  }
}

/** Enregistre un fetch maintenant (après purge). Best-effort. */
function noterFetch(): void {
  try {
    if (typeof localStorage === "undefined") return;
    const log = lireFetchLog();
    log.push(Date.now());
    localStorage.setItem(FETCH_LOG_KEY, JSON.stringify(log));
  } catch {
    /* best-effort */
  }
}

/** La garde de débit autorise-t-elle un nouveau fetch réseau ? */
function fetchAutorise(): boolean {
  return lireFetchLog().length < RATE_MAX;
}

/** L'erreur est-elle une annulation (AbortController) ? (sans dépendre de DOMException). */
function estAbort(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

/** Récupère + parse ForexFactory (marque la santé). Renvoie [] en cas d'échec. */
async function fetchForexFactory(signal?: AbortSignal): Promise<EcoEvent[]> {
  try {
    const res = await fetch(extUrl("nfs.faireconomy.media", "ff_calendar_thisweek.json"), {
      signal,
    });
    if (!res.ok) throw new Error(`ForexFactory ${res.status}`);
    const json = (await res.json()) as unknown;
    const events = parseForexFactory(json);
    healthStore.getState().setEtat(HEALTH_FF, "polling", { dernierMessageTs: Date.now() });
    return events;
  } catch (err) {
    if (!estAbort(err)) {
      healthStore.getState().marquerErreur(HEALTH_FF, "Calendrier ForexFactory indisponible");
    }
    return [];
  }
}

/** Récupère + parse les publications FRED à venir (marque la santé). [] si échec. */
async function fetchFredReleases(signal?: AbortSignal): Promise<EcoEvent[]> {
  try {
    const debut = new Date().toISOString().slice(0, 10);
    const fin = new Date(Date.now() + FRED_FENETRE_JOURS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const params = new URLSearchParams({
      file_type: "json",
      realtime_start: debut,
      realtime_end: fin,
      include_release_dates_with_no_data: "true", // publications À VENIR (sans données encore)
      sort_order: "asc",
      order_by: "release_date",
      limit: "1000",
    });
    // Clé injectée par le proxy /fredapi (.env) : on n'envoie AUCUNE clé côté front.
    const res = await fetch(`/fredapi/fred/releases/dates?${params.toString()}`, { signal });
    if (!res.ok) throw new Error(`FRED releases ${res.status}`);
    const json = (await res.json()) as unknown;
    const events = parseFredReleases(json);
    healthStore.getState().setEtat(HEALTH_FRED, "polling", { dernierMessageTs: Date.now() });
    return events;
  } catch (err) {
    if (!estAbort(err)) {
      healthStore.getState().marquerErreur(HEALTH_FRED, "Calendrier FRED indisponible");
    }
    return [];
  }
}

/** Résultat de `chargerEvenementsEco`. */
export interface ChargementEco {
  events: EcoEvent[];
  /** Vrai si servi depuis le cache (pas de requête réseau émise). */
  depuisCache: boolean;
  /** Vrai si la garde de débit a bloqué un rafraîchissement demandé. */
  brideDebit?: boolean;
}

/**
 * Charge le calendrier fusionné (effet de bord : fetch + cache + santé).
 *  - cache frais (<12 h) et pas de `force` → renvoyé tel quel, aucun réseau ;
 *  - garde de débit dépassée (2 fetch / 5 min) → renvoie le cache (ou juste FOMC) ;
 *  - sinon : fetch FF + FRED en parallèle, fusion avec FOMC statique, mise en cache.
 * Si FF ET FRED échouent tous les deux, on préfère un cache existant à un résultat
 * appauvri (FOMC seul).
 */
export async function chargerEvenementsEco(opts?: {
  force?: boolean;
  signal?: AbortSignal;
}): Promise<ChargementEco> {
  const cache = lireCache();
  if (!opts?.force && cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return { events: cache.events, depuisCache: true };
  }
  if (!fetchAutorise()) {
    return {
      events: cache?.events ?? evenementsFomc(),
      depuisCache: true,
      brideDebit: true,
    };
  }

  noterFetch();
  const [ff, fred] = await Promise.all([
    fetchForexFactory(opts?.signal),
    fetchFredReleases(opts?.signal),
  ]);

  // Les deux sources réseau vides = échec probable : on garde le cache s'il existe.
  if (ff.length === 0 && fred.length === 0 && cache) {
    return { events: cache.events, depuisCache: true };
  }

  const events = fusionnerEvenementsEco(ff, fred, evenementsFomc());
  ecrireCache(events);
  return { events, depuisCache: false };
}
