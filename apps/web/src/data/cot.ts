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
export interface PointBrutCot {
  nom: string;
  /** Date du rapport (ms epoch). */
  dateRapport: number;
  /** Position nette spéculative = longs − shorts (non-commercial). */
  net: number;
  /** Open interest total du contrat (contexte / échelle). */
  openInterest: number;
}

/**
 * Un point de la SÉRIE historique d'un instrument (forme compacte destinée aux calculs purs
 * de Task 2 — COT Index, deltas — et aux sparklines de Task 3). `t` = date de rapport en ms.
 */
export interface PointCot {
  /** Date du rapport (ms epoch). */
  t: number;
  /** Position nette spéculative = longs − shorts (non-commercial). */
  net: number;
  /** Open interest total du contrat (NaN si absent). */
  oi: number;
}

/** Ligne de synthèse d'un instrument : dernier net + variation hebdo + série 3 ans. */
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
  /** Série historique complète (~3 ans), triée chrono CROISSANTE. */
  serie: PointCot[];
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
 * dataset `6dca-aqww` le 2026-07-10 — tous les 14 noms résolvent toujours, dernier rapport
 * 2026-06-30 (inchangé depuis la vérification du 2026-07-08). On ne retient que le contrat
 * de RÉFÉRENCE par sous-jacent (pas les micros, les cross-rates, ni les variantes
 * financières) pour un tableau de bord scannable — même logique de curation que le jeu FRED
 * de `data/eco.ts`.
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
export function pointCot(rec: unknown): PointBrutCot | null {
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
 * par instrument, conserve la SÉRIE historique complète triée chrono croissante et calcule le
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
  const parNom = new Map<string, PointBrutCot[]>();
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
    // Tri chrono CROISSANT : la série (et ses consommateurs Task 2/3) l'attend ASC ; le dernier
    // rapport est donc en fin de tableau.
    pts.sort((a, b) => a.dateRapport - b.dateRapport);
    const serie: PointCot[] = pts.map((p) => ({ t: p.dateRapport, net: p.net, oi: p.openInterest }));
    const dernier = pts[pts.length - 1]!;
    const precedent = pts[pts.length - 2];
    lignes.push({
      nom: inst.nom,
      libelle: inst.libelle,
      categorie: inst.categorie,
      net: dernier.net,
      delta: precedent ? dernier.net - precedent.net : null,
      openInterest: dernier.openInterest,
      dateRapport: dernier.dateRapport,
      serie,
    });
  }

  const dateRapport = lignes.length > 0 ? Math.max(...lignes.map((l) => l.dateRapport)) : null;
  return { lignes, dateRapport };
}

/**
 * COT Index : position du net du DERNIER point dans son amplitude (min–max) sur la fenêtre des
 * `fenetreSem` derniers points de la série (défaut 156 ≈ 3 ans hebdo) — l'indice « Larry
 * Williams » classique, ramené sur 0-100. `null` si moins de 26 semaines d'historique total
 * (fenêtre trop courte pour être significative) ; 50 si la fenêtre est constante (amplitude
 * nulle, ratio indéfini). Fonction PURE.
 */
export function cotIndex(serie: PointCot[], fenetreSem = 156): number | null {
  if (serie.length < 26) return null;
  const fenetre = serie.slice(-fenetreSem);
  const nets = fenetre.map((p) => p.net);
  const min = Math.min(...nets);
  const max = Math.max(...nets);
  const dernier = nets[nets.length - 1]!;
  if (max === min) return 50;
  return ((dernier - min) / (max - min)) * 100;
}

/**
 * Variation du net sur `n` semaines : net du dernier point − net du point `n` positions plus tôt
 * dans la série. `null` si la série est trop courte pour reculer de `n` points. `n` compte les
 * POINTS de série (rapports publiés), pas les semaines calendaires — si la CFTC saute une
 * publication, la dérive peut être > 7 jours. Fonction PURE.
 */
export function deltaSemaines(serie: PointCot[], n: number): number | null {
  if (serie.length <= n) return null;
  const dernier = serie[serie.length - 1]!;
  const cible = serie[serie.length - 1 - n]!;
  return dernier.net - cible.net;
}

/**
 * Net rapporté à l'open interest, en pourcentage (échelle d'affichage de `BarreNet`). `null` si
 * l'OI n'est pas strictement positif (absent/NaN/0/négatif — `!(oi > 0)` couvre NaN sans cas
 * spécial). Fonction PURE.
 */
export function netSurOi(net: number, oi: number): number | null {
  if (!(oi > 0)) return null;
  return (net / oi) * 100;
}

// ─────────────────────────── Orchestrateur (effet de bord) ───────────────────────────

const HOTE = "publicreporting.cftc.gov";
const DATASET = "6dca-aqww"; // Legacy Futures Only
const HEALTH_SOURCE = "cot:cftc";

// Clé v2 : la synthèse conserve désormais la SÉRIE 3 ans par instrument (forme incompatible
// avec le cache v1, qui ne gardait que 2 rapports) ⇒ nouvelle clé pour éviter les faux hits.
const CACHE_KEY = "axiom:cot:cache:v2";
/** TTL du cache : 12 h (rapport publié une fois par semaine, le vendredi). */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Limite de lignes récupérées. ~14 instruments × ~156 rapports hebdo sur 3 ans ≈ 2184 lignes ;
 * 3000 couvre l'historique complet borné par le `$where` avec une marge confortable.
 */
const LIMITE = 3000;

/** Profondeur d'historique conservée : 3 ans (fenêtre du COT Index de Task 2). */
const HISTORIQUE_ANS = 3;

/**
 * Construit le query string Socrata (encodage via URLSearchParams : `$`→%24, espaces→+).
 * `nowMs` est INJECTÉ (pas de `Date.now()` interne) pour rendre la borne temporelle testable :
 * `$where report_date >= now − 3 ans` (calendaire) filtre server-side l'historique récupéré.
 */
export function construireRequete(watchlist: readonly InstrumentCot[], nowMs: number): string {
  const inList = watchlist.map((i) => `'${i.nom}'`).join(",");
  // Calcul en UTC de bout en bout (setUTC* + toISOString) : la borne est ainsi déterministe,
  // indépendante du fuseau de la machine. Socrata « floating timestamp » attend
  // `YYYY-MM-DDThh:mm:ss.sss` (sans suffixe Z), d'où le slice(0, 23).
  const borne = new Date(nowMs);
  borne.setUTCFullYear(borne.getUTCFullYear() - HISTORIQUE_ANS);
  const borneStr = borne.toISOString().slice(0, 23);
  const params = new URLSearchParams();
  params.set(
    "$select",
    "market_and_exchange_names,report_date_as_yyyy_mm_dd,noncomm_positions_long_all,noncomm_positions_short_all,open_interest_all",
  );
  params.set(
    "$where",
    `market_and_exchange_names in(${inList}) AND report_date_as_yyyy_mm_dd >= '${borneStr}'`,
  );
  params.set("$order", "report_date_as_yyyy_mm_dd DESC");
  params.set("$limit", String(LIMITE));
  return params.toString();
}

interface CacheCot {
  ts: number;
  resume: ResumeCot;
}

/**
 * `JSON.stringify(NaN)` produit `null` (NaN n'est pas représentable en JSON) : un `oi` ou un
 * `openInterest` absent (NaN par convention `nombreCot`) revient donc `null` après un aller-retour
 * localStorage, en violation du contrat `oi: number` / `openInterest: number`. On renormalise ici
 * à la LECTURE (toute valeur non finie ⇒ NaN) plutôt qu'à l'écriture, pour rester robuste même à
 * un cache écrit par une version antérieure du code. Fonction PURE.
 */
function normaliserResumeCache(resume: ResumeCot): ResumeCot {
  return {
    ...resume,
    lignes: resume.lignes.map((ligne) => ({
      ...ligne,
      openInterest: Number.isFinite(ligne.openInterest) ? ligne.openInterest : NaN,
      serie: ligne.serie.map((pt) => (Number.isFinite(pt.oi) ? pt : { ...pt, oi: NaN })),
    })),
  };
}

/** Lecture tolérante du cache (localStorage absent / JSON corrompu → null). */
function lireCache(): CacheCot | null {
  try {
    if (typeof localStorage === "undefined") return null;
    // Purge best-effort du cache v1 (clé obsolète après migration vers série 3 ans).
    // Blob orphelin, pas de failure si absent ou localStorage readonly.
    try {
      localStorage.removeItem("axiom:cot:cache:v1");
    } catch {
      /* silencieux */
    }
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<CacheCot> | null;
    if (!p || typeof p.ts !== "number" || !p.resume || !Array.isArray(p.resume.lignes)) return null;
    return { ts: p.ts, resume: normaliserResumeCache(p.resume as ResumeCot) };
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
    /* best-effort : la série 3 ans × 14 instruments peut dépasser le quota localStorage
       (QuotaExceededError) ; on avale silencieusement l'exception — pas de cache vaut mieux
       qu'une UI cassée, et le prochain chargement repartira du réseau. */
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
    const qs = construireRequete(WATCHLIST_COT, Date.now());
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
