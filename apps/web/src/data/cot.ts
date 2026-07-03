/**
 * Rapport COT (Commitments of Traders) — CFTC, dataset « Legacy Futures Only ».
 *
 * Source : CFTC Public Reporting via l'API Socrata SODA (`publicreporting.cftc.gov`,
 * dataset `6dca-aqww`), SANS clé, routée en SAME-ORIGIN par le proxy générique /extapi
 * (hôte whitelisté). Un SEUL appel agrégé récupère les DERNIÈRES semaines de rapport
 * pour une WATCHLIST CURÉE d'instruments (majors FX, indices actions, or/argent, pétrole,
 * BTC/ETH CME) — filtrage server-side par `market_and_exchange_names in(...)`, tri par
 * date décroissante, limite couvrant plusieurs semaines.
 *
 * Métrique headline : POSITION NETTE SPÉCULATIVE (« non-commercial ») =
 * `noncomm_positions_long_all` − `noncomm_positions_short_all`. Le signal utile étant
 * « ce qui a changé cette semaine », on calcule aussi la VARIATION HEBDO en diffant les
 * DEUX derniers rapports par instrument (net_dernier − net_précédent) — cohérent avec les
 * champs `change_in_*` officiels du CFTC, mais recalculé côté client pour rester robuste.
 *
 * Ce module est PUR pour tout le parsing / la synthèse (testé dans cot.test.ts). Il expose
 * en plus un orchestrateur `chargerRapportCot` (fetch + cache + santé) — seul effet de bord.
 *
 * Dégradation gracieuse : source en panne ⇒ on préfère le dernier cache (localStorage) à un
 * résultat vide ; jamais d'exception propagée qui casserait l'UI.
 */
import { extUrl } from "./extapi";
import { healthStore } from "../store/health";

// ─────────────────────────── Types ───────────────────────────

/** Grande famille d'un instrument suivi (pilote le regroupement visuel). */
export type CotCategorie = "fx" | "indice" | "metal" | "energie" | "crypto";

/** Un instrument de la watchlist curée : nom EXACT côté CFTC + libellé FR + famille. */
export interface InstrumentCot {
  /** `market_and_exchange_names` EXACT (clé de filtre server-side + de jointure). */
  nom: string;
  /** Libellé court affiché dans la fenêtre. */
  libelle: string;
  /** Famille (regroupement). */
  categorie: CotCategorie;
}

/** Un point brut normalisé (une ligne de rapport pour un instrument, une semaine). */
export interface PointCot {
  nom: string;
  /** Date du rapport (ms epoch). */
  dateRapport: number;
  /** Position nette spéculative = longs − shorts (non-commercial). */
  net: number;
  /** Open interest total du contrat (contexte / échelle). */
  openInterest: number;
}

/** Ligne de synthèse d'un instrument : dernier net + variation hebdo. */
export interface LigneCot {
  nom: string;
  libelle: string;
  categorie: CotCategorie;
  /** Position nette spéculative du dernier rapport. */
  net: number;
  /** Variation hebdo du net (dernier − précédent), null si une seule semaine dispo. */
  delta: number | null;
  /** Open interest du dernier rapport. */
  openInterest: number;
  /** Date du dernier rapport de cet instrument (ms epoch). */
  dateRapport: number;
}

/** Résultat synthétisé complet, prêt à afficher. */
export interface ResumeCot {
  /** Lignes dans l'ordre de la watchlist (regroupement par famille contigu). */
  lignes: LigneCot[];
  /** Date du dernier rapport publié (max sur les lignes), null si vide. */
  dateRapport: number | null;
}

// ─────────────────────────── Watchlist curée ───────────────────────────

/**
 * Watchlist CURÉE (noms `market_and_exchange_names` EXACTS, vérifiés en direct sur le
 * dataset `6dca-aqww` le 2026-07-03). On ne retient que le contrat de RÉFÉRENCE par sous-
 * jacent (pas les micros, les cross-rates, ni les variantes financières) pour un tableau
 * de bord scannable — même logique de curation que le jeu FRED de `data/eco.ts`.
 */
export const WATCHLIST_COT: readonly InstrumentCot[] = [
  // Devises (majors CME + indice dollar ICE)
  { nom: "USD INDEX - ICE FUTURES U.S.", libelle: "Indice dollar (DXY)", categorie: "fx" },
  { nom: "EURO FX - CHICAGO MERCANTILE EXCHANGE", libelle: "Euro (EUR)", categorie: "fx" },
  { nom: "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE", libelle: "Yen (JPY)", categorie: "fx" },
  { nom: "BRITISH POUND - CHICAGO MERCANTILE EXCHANGE", libelle: "Livre (GBP)", categorie: "fx" },
  { nom: "CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE", libelle: "Dollar canadien (CAD)", categorie: "fx" },
  { nom: "AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE", libelle: "Dollar australien (AUD)", categorie: "fx" },
  { nom: "SWISS FRANC - CHICAGO MERCANTILE EXCHANGE", libelle: "Franc suisse (CHF)", categorie: "fx" },
  // Indices actions US (E-mini)
  { nom: "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE", libelle: "S&P 500 (E-mini)", categorie: "indice" },
  { nom: "NASDAQ MINI - CHICAGO MERCANTILE EXCHANGE", libelle: "Nasdaq 100 (E-mini)", categorie: "indice" },
  // Métaux précieux (COMEX)
  { nom: "GOLD - COMMODITY EXCHANGE INC.", libelle: "Or", categorie: "metal" },
  { nom: "SILVER - COMMODITY EXCHANGE INC.", libelle: "Argent", categorie: "metal" },
  // Énergie (NYMEX)
  { nom: "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE", libelle: "Pétrole WTI", categorie: "energie" },
  // Crypto (CME)
  { nom: "BITCOIN - CHICAGO MERCANTILE EXCHANGE", libelle: "Bitcoin (CME)", categorie: "crypto" },
  { nom: "ETHER CASH SETTLED - CHICAGO MERCANTILE EXCHANGE", libelle: "Ether (CME)", categorie: "crypto" },
] as const;

/** Familles dans l'ordre d'affichage + libellé d'en-tête de groupe. */
export const CATEGORIES_COT: readonly { id: CotCategorie; libelle: string }[] = [
  { id: "fx", libelle: "Devises" },
  { id: "indice", libelle: "Indices actions" },
  { id: "metal", libelle: "Métaux" },
  { id: "energie", libelle: "Énergie" },
  { id: "crypto", libelle: "Crypto (CME)" },
] as const;

// ─────────────────────────── Fonctions PURES : parsing & synthèse ───────────────────────────

/**
 * Parse un nombre CFTC (les champs numériques arrivent en CHAÎNES). Renvoie NaN pour une
 * valeur absente, vide ou non numérique (« » ne doit PAS devenir 0). Fonction PURE.
 */
export function nombreCot(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v !== "string") return NaN;
  const t = v.trim();
  if (t === "") return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Une ligne brute du dataset (champs utiles ; tout le reste ignoré). */
interface EnregistrementCot {
  market_and_exchange_names?: unknown;
  report_date_as_yyyy_mm_dd?: unknown;
  noncomm_positions_long_all?: unknown;
  noncomm_positions_short_all?: unknown;
  open_interest_all?: unknown;
}

/**
 * Transforme un enregistrement brut en point normalisé (net spéculatif + OI). Renvoie null
 * si le nom, la date, ou les positions long/short sont inexploitables. Fonction PURE (c'est
 * la « response-to-net-position transform »).
 */
export function pointCot(rec: unknown): PointCot | null {
  const r = rec as EnregistrementCot | null;
  const nom = typeof r?.market_and_exchange_names === "string" ? r.market_and_exchange_names : null;
  if (nom === null || nom.length === 0) return null;
  const dateStr = typeof r?.report_date_as_yyyy_mm_dd === "string" ? r.report_date_as_yyyy_mm_dd : "";
  const dateRapport = Date.parse(dateStr);
  if (!Number.isFinite(dateRapport)) return null;
  const longs = nombreCot(r?.noncomm_positions_long_all);
  const shorts = nombreCot(r?.noncomm_positions_short_all);
  if (!Number.isFinite(longs) || !Number.isFinite(shorts)) return null;
  const oi = nombreCot(r?.open_interest_all);
  return {
    nom,
    dateRapport,
    net: longs - shorts,
    openInterest: Number.isFinite(oi) ? oi : NaN,
  };
}

/**
 * Synthétise la réponse brute en lignes prêtes à afficher : filtre à la watchlist, regroupe
 * par instrument, retient les DEUX derniers rapports (tri date décroissante) et calcule le
 * net du dernier + la variation hebdo (dernier − précédent, null si une seule semaine).
 * L'ordre de sortie SUIT la watchlist (regroupement par famille contigu). Fonction PURE.
 */
export function resumerCot(
  records: unknown,
  watchlist: readonly InstrumentCot[] = WATCHLIST_COT,
): ResumeCot {
  const liste = Array.isArray(records) ? records : [];
  const suivis = new Set(watchlist.map((i) => i.nom));

  // Regroupe les points par nom (uniquement les instruments suivis).
  const parNom = new Map<string, PointCot[]>();
  for (const rec of liste) {
    const pt = pointCot(rec);
    if (pt === null || !suivis.has(pt.nom)) continue;
    const arr = parNom.get(pt.nom);
    if (arr) arr.push(pt);
    else parNom.set(pt.nom, [pt]);
  }

  const lignes: LigneCot[] = [];
  for (const inst of watchlist) {
    const pts = parNom.get(inst.nom);
    if (pts === undefined || pts.length === 0) continue;
    pts.sort((a, b) => b.dateRapport - a.dateRapport);
    const dernier = pts[0]!;
    const precedent = pts[1];
    lignes.push({
      nom: inst.nom,
      libelle: inst.libelle,
      categorie: inst.categorie,
      net: dernier.net,
      delta: precedent ? dernier.net - precedent.net : null,
      openInterest: dernier.openInterest,
      dateRapport: dernier.dateRapport,
    });
  }

  const dateRapport = lignes.length > 0 ? Math.max(...lignes.map((l) => l.dateRapport)) : null;
  return { lignes, dateRapport };
}

// ─────────────────────────── Orchestrateur (effet de bord) ───────────────────────────

const HOTE = "publicreporting.cftc.gov";
const DATASET = "6dca-aqww"; // Legacy Futures Only
const HEALTH_SOURCE = "cot:cftc";

const CACHE_KEY = "axiom:cot:cache:v1";
/** TTL du cache : 12 h (rapport publié une fois par semaine, le vendredi). */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Limite de lignes récupérées. La watchlist compte ~14 instruments partageant les MÊMES
 * dates de rapport hebdo ; tri par date décroissante ⇒ les 14 premières lignes = dernier
 * rapport, les 14 suivantes = précédent. 80 couvre confortablement ≥ 2 semaines (marge).
 */
const LIMITE = 80;

/** Construit le query string Socrata (encodage via URLSearchParams : `$`→%24, espaces→+). */
function construireRequete(watchlist: readonly InstrumentCot[]): string {
  const inList = watchlist.map((i) => `'${i.nom}'`).join(",");
  const params = new URLSearchParams();
  params.set(
    "$select",
    "market_and_exchange_names,report_date_as_yyyy_mm_dd,noncomm_positions_long_all,noncomm_positions_short_all,open_interest_all",
  );
  params.set("$where", `market_and_exchange_names in(${inList})`);
  params.set("$order", "report_date_as_yyyy_mm_dd DESC");
  params.set("$limit", String(LIMITE));
  return params.toString();
}

interface CacheCot {
  ts: number;
  resume: ResumeCot;
}

/** Lecture tolérante du cache (localStorage absent / JSON corrompu → null). */
function lireCache(): CacheCot | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<CacheCot> | null;
    if (!p || typeof p.ts !== "number" || !p.resume || !Array.isArray(p.resume.lignes)) return null;
    return { ts: p.ts, resume: p.resume as ResumeCot };
  } catch {
    return null;
  }
}

/** Écriture tolérante du cache (best-effort). */
function ecrireCache(resume: ResumeCot): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), resume }));
  } catch {
    /* best-effort : la persistance du COT n'est pas bloquante */
  }
}

/** Résultat de `chargerRapportCot`. */
export interface ChargementCot {
  resume: ResumeCot;
  /** Vrai si servi depuis le cache (aucune requête réseau émise ou repli sur cache). */
  depuisCache: boolean;
}

/**
 * Charge le rapport COT synthétisé (effet de bord : fetch + cache + santé).
 *  - cache frais (< 12 h) et pas de `force` → renvoyé tel quel, aucun réseau ;
 *  - sinon : 1 requête Socrata agrégée, synthèse, mise en cache.
 * Dégradation gracieuse : sur échec réseau/HTTP ou résultat vide, on renvoie le dernier
 * cache s'il existe (sinon un résumé vide) — jamais d'exception propagée.
 */
export async function chargerRapportCot(opts?: {
  force?: boolean;
  signal?: AbortSignal;
}): Promise<ChargementCot> {
  const cache = lireCache();
  if (!opts?.force && cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return { resume: cache.resume, depuisCache: true };
  }

  try {
    const qs = construireRequete(WATCHLIST_COT);
    const res = await fetch(extUrl(HOTE, `resource/${DATASET}.json?${qs}`), { signal: opts?.signal });
    if (!res.ok) throw new Error(`CFTC ${res.status}`);
    const json = (await res.json()) as unknown;
    const resume = resumerCot(json);

    // Réponse vide alors qu'un cache existe : on préfère le cache (échec probable en amont).
    if (resume.lignes.length === 0 && cache) {
      return { resume: cache.resume, depuisCache: true };
    }

    ecrireCache(resume);
    healthStore.getState().setEtat(HEALTH_SOURCE, "polling", { dernierMessageTs: Date.now() });
    return { resume, depuisCache: false };
  } catch (err) {
    if (typeof err !== "object" || err === null || (err as { name?: unknown }).name !== "AbortError") {
      healthStore.getState().marquerErreur(HEALTH_SOURCE, "Rapport COT (CFTC) indisponible");
    }
    return { resume: cache?.resume ?? { lignes: [], dateRapport: null }, depuisCache: true };
  }
}
