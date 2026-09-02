/**
 * Flux NEWS crypto agrégés — RSS 2.0 + Atom via le proxy générique /extapi.
 *
 * Les flux RSS des grands médias crypto n'exposent AUCUN en-tête CORS : un appel
 * direct depuis le navigateur est bloqué. On les route donc en same-origin via
 * `/extapi/<hote>/<chemin>` (cf. data/extapi.ts). Chaque flux est indépendant :
 * un flux mort (404, redirection cross-origin, XML illisible) est marqué « erreur »
 * SANS casser les autres (Promise.allSettled + dégradation par flux).
 *
 * Parsing : extracteur XML PUR (sans dépendance ni DOMParser). Motivation : les tests
 * vitest tournent sous Node (pas de jsdom, aucune dépendance nouvelle autorisée) où
 * `DOMParser` n'existe pas ; l'extracteur par balises est donc testable partout ET
 * fonctionne à l'identique dans le navigateur. Il couvre les deux formats réels
 * rencontrés (RSS `<item>` / Atom `<entry>`), CDATA et entités HTML incluses.
 *
 * Fusion multi-flux : dédup par lien, tri par date décroissante. Rafraîchissement
 * périodique (3 min) via `pollLoop` (source « news » dans le registre santé).
 */
import type { Unsubscribe } from "@axiom/types";
import { extUrl } from "./extapi";
import { pollLoop } from "./pollLoop";
import { newsStore } from "../store/news";
import { getFinnhubKey } from "../store/finnhub";

// ─────────────────────────── Types & configuration des flux ───────────────────────────

/** Identifiant stable d'une source de news (clé des statuts par flux + badge). */
export type NewsSourceId =
  | "coindesk"
  | "cointelegraph"
  | "theblock"
  | "decrypt"
  | "blockworks"
  | "finnhub"
  | "finnhubfx"
  | "bloomberg"
  | "cnbc"
  | "gdelt";

/** Une news normalisée (issue d'un `<item>` RSS ou d'une `<entry>` Atom). */
export interface NewsItem {
  /** Clé stable : lien, sinon guid/id, sinon source+titre+date. Sert au dédup + « lu ». */
  id: string;
  /** Titre nettoyé (sans HTML ni entités). */
  title: string;
  /** Lien externe de l'article (chaîne vide si le flux n'en fournit aucun). */
  link: string;
  /** Horodatage ms epoch (0 si date absente/illisible → trié en fin de liste). */
  time: number;
  /** Source d'origine. */
  source: NewsSourceId;
  /** Résumé court, sans HTML (tronqué). */
  summary: string;
}

/** Description d'un flux RSS/Atom à interroger. */
export interface NewsFeed {
  id: NewsSourceId;
  /** Libellé affiché (badge). */
  label: string;
  /** Hôte whitelisté du proxy /extapi. */
  host: string;
  /** Chemin du flux (sans slash de tête). */
  path: string;
  /** Couleur du badge de source (accent visuel dense). */
  color: string;
  /** Type de parsing/récupération. Absent = `"xml"` (RSS/Atom via /extapi, comportement historique). */
  kind?: "xml" | "finnhub" | "gdelt";
  /** Catégorie Finnhub `/news` (kind "finnhub" uniquement ; absent = "general"). */
  category?: "general" | "forex" | "crypto" | "merger";
}

/**
 * Flux interrogés. Chemins VÉRIFIÉS en réel (2026-07) :
 *  - CoinDesk : `arc/outboundfeeds/rss` SANS slash final — la variante `.../rss/`
 *    renvoie un 308 vers une Location relative que le proxy ne peut pas suivre.
 *  - Cointelegraph / The Block / Decrypt : RSS 2.0 servi directement (200).
 *  - Blockworks : hôte `blockworks.com` (l'ancien `blockworks.co/feed` redirige
 *    en 308 vers ce domaine — hôte suivi + whitelists /extapi mises à jour
 *    2026-07-09) ; sert de l'Atom, couvert par parseFeed.
 *  - Bloomberg : `feeds.bloomberg.com/economics/news.rss` — verticale macro « economics »
 *    (vérifiée 200 le 2026-07-10, cf. docs/research/05) ; RSS 2.0 standard.
 *  - CNBC : `id/20910258/device/rss/rss.html` — verticale « Economy » (vérifiée 200 ;
 *    exige un UA navigateur, déjà envoyé par défaut par le proxy /extapi).
 * Bloomberg/CNBC ne sont PAS des API documentées pérennes : enrichissement dégradable
 * (un flux mort tombe en statut « erreur » sans casser les autres, cf. allSettled).
 */
export const NEWS_FEEDS: readonly NewsFeed[] = [
  { id: "coindesk", label: "CoinDesk", host: "www.coindesk.com", path: "arc/outboundfeeds/rss", color: "#f7a600" },
  { id: "cointelegraph", label: "Cointelegraph", host: "cointelegraph.com", path: "rss", color: "#fab617" },
  { id: "theblock", label: "The Block", host: "www.theblock.co", path: "rss.xml", color: "#4f8cff" },
  { id: "decrypt", label: "Decrypt", host: "decrypt.co", path: "feed", color: "#22c55e" },
  { id: "blockworks", label: "Blockworks", host: "blockworks.com", path: "feed", color: "#a855f7" },
  { id: "bloomberg", label: "Bloomberg", host: "feeds.bloomberg.com", path: "economics/news.rss", color: "#6366f1" },
  { id: "cnbc", label: "CNBC", host: "www.cnbc.com", path: "id/20910258/device/rss/rss.html", color: "#ef4444" },
  // Finnhub `/news` — appelé DIRECT (CORS ouvert), clé requise (cf. store/finnhub).
  // host/path ignorés pour ce `kind` (l'URL est construite dans fetchFlux) — laissés vides
  // plutôt que d'inventer une valeur trompeuse. Deux catégories du tier gratuit :
  // `general` (marché/business, historique) et `forex` (macro/devises, ajout bandeau).
  { id: "finnhub", label: "Finnhub", host: "", path: "", color: "#0ea5e9", kind: "finnhub", category: "general" },
  { id: "finnhubfx", label: "Finnhub FX", host: "", path: "", color: "#14b8a6", kind: "finnhub", category: "forex" },
];

/** Source du registre santé. */
const HEALTH_SOURCE = "news";
/** Intervalle de rafraîchissement (3 min). */
const NEWS_POLL_MS = 180_000;
/** Longueur max du résumé affiché. */
const SUMMARY_MAX = 200;

// ─────────────────────────── Extraction XML (pure, sans dépendance) ───────────────────────────

/** Retire un éventuel enrobage `<![CDATA[ ... ]]>` (contenu conservé tel quel). */
function retirerCData(s: string): string {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  return m ? (m[1] ?? "") : s;
}

/** Table d'entités nommées usuelles des flux RSS/Atom. */
const ENTITES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Décode les entités HTML (nommées + numériques). `&amp;` traité en dernier (anti double-décodage). */
function decoderEntites(s: string): string {
  let out = s.replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => codePoint(parseInt(h, 16)));
  out = out.replace(/&#(\d+);/g, (_, d: string) => codePoint(parseInt(d, 10)));
  out = out.replace(/&lt;|&gt;|&quot;|&apos;|&#39;|&nbsp;/g, (e) => ENTITES[e] ?? e);
  return out.replace(/&amp;/g, "&");
}

/** Code point → chaîne, en ignorant les valeurs invalides (jamais bloquant). */
function codePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/**
 * Contenu texte de la PREMIÈRE balise `<tag>…</tag>` du bloc (CDATA + entités décodés,
 * espaces normalisés). Le lookahead `(?=[\s/>])` empêche de confondre un préfixe de
 * namespace (`<content:encoded>` ne matche pas `content`). Chaîne vide si absente.
 */
function texteBalise(bloc: string, tag: string): string {
  const re = new RegExp(`<${tag}(?=[\\s/>])[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(bloc);
  if (!m) return "";
  return normaliserEspaces(decoderEntites(retirerCData(m[1] ?? "")));
}

/** Retire les balises HTML d'un fragment, décode, tronque et normalise les espaces. */
function texteResume(bloc: string, ...tags: string[]): string {
  let brut = "";
  for (const t of tags) {
    brut = premierContenu(bloc, t);
    if (brut) break;
  }
  const sansHtml = retirerCData(brut).replace(/<[^>]+>/g, " ");
  const texte = normaliserEspaces(decoderEntites(sansHtml));
  return texte.length > SUMMARY_MAX ? `${texte.slice(0, SUMMARY_MAX).trimEnd()}…` : texte;
}

/** Contenu BRUT (CDATA non retiré) de la première balise `<tag>` — utilisé par texteResume. */
function premierContenu(bloc: string, tag: string): string {
  const re = new RegExp(`<${tag}(?=[\\s/>])[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(bloc);
  return m ? (m[1] ?? "") : "";
}

/** Effondre toute suite d'espaces/retours en un seul espace, puis trim. */
function normaliserEspaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Lien d'une `<entry>` Atom : href de la balise `<link>` en préférant `rel="alternate"`
 * (ou l'absence de rel) ; sinon le premier href rencontré. Chaîne vide si aucun.
 */
function hrefAtom(bloc: string): string {
  let secours = "";
  for (const l of bloc.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const attrs = l[1] ?? "";
    const href = /\bhref=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href) continue;
    const rel = /\brel=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (rel === undefined || rel === "alternate") return decoderEntites(href.trim());
    if (!secours) secours = href;
  }
  return secours ? decoderEntites(secours.trim()) : "";
}

/** Découpe le XML en blocs `<tag>…</tag>` (item RSS ou entry Atom). */
function blocs(xml: string, tag: "item" | "entry"): string[] {
  const re = new RegExp(`<${tag}(?=[\\s/>])[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1] ?? "");
  return out;
}

/** Convertit une date RSS (RFC-822) ou Atom (ISO-8601) en ms epoch ; 0 si illisible. */
export function parseDate(s: string): number {
  if (!s) return 0;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? t : 0;
}

/** Parse un bloc `<item>` RSS 2.0. `null` si le titre manque (entrée inexploitable). */
function parseItemRss(bloc: string, source: NewsSourceId): NewsItem | null {
  const title = texteBalise(bloc, "title");
  if (!title) return null;
  const link = texteBalise(bloc, "link");
  const guid = texteBalise(bloc, "guid");
  const time = parseDate(texteBalise(bloc, "pubDate"));
  const summary = texteResume(bloc, "description");
  const id = link || guid || `${source}:${title}:${time}`;
  return { id, title, link, time, source, summary };
}

/** Parse une `<entry>` Atom. `null` si le titre manque. */
function parseEntreeAtom(bloc: string, source: NewsSourceId): NewsItem | null {
  const title = texteBalise(bloc, "title");
  if (!title) return null;
  const link = hrefAtom(bloc) || texteBalise(bloc, "id");
  const time = parseDate(texteBalise(bloc, "published") || texteBalise(bloc, "updated"));
  const summary = texteResume(bloc, "summary", "content");
  const id = link || `${source}:${title}:${time}`;
  return { id, title, link, time, source, summary };
}

/**
 * Parse un flux RSS 2.0 OU Atom en news normalisées. Détection par présence de blocs
 * `<item>` (RSS) sinon `<entry>` (Atom). Fonction PURE (testée sur fixtures inline).
 */
export function parseFeed(xml: string, source: NewsSourceId): NewsItem[] {
  const items = blocs(xml, "item");
  if (items.length > 0) {
    return items.map((b) => parseItemRss(b, source)).filter((n): n is NewsItem => n !== null);
  }
  const entries = blocs(xml, "entry");
  return entries.map((b) => parseEntreeAtom(b, source)).filter((n): n is NewsItem => n !== null);
}

// ─────────────────────────── Parseurs sources non-XML (pures) ───────────────────────────

/**
 * Parse la réponse Finnhub `/news` (tableau plat). PURE, défensive. `source` distingue
 * les catégories interrogées (general = "finnhub", forex = "finnhubfx") — défaut
 * "finnhub" pour ne pas changer le contrat historique.
 */
export function parseFinnhubNews(json: unknown, source: NewsSourceId = "finnhub"): NewsItem[] {
  if (!Array.isArray(json)) return [];
  const out: NewsItem[] = [];
  for (const brut of json) {
    if (brut === null || typeof brut !== "object") continue; // élément non exploitable, on l'ignore
    const it = brut as { headline?: unknown; url?: unknown; datetime?: unknown; summary?: unknown; id?: unknown };
    if (typeof it.headline !== "string" || it.headline.length === 0) continue;
    const time = typeof it.datetime === "number" ? it.datetime * 1000 : 0;
    const link = typeof it.url === "string" ? it.url : "";
    out.push({
      id: link || `${source}:${String(it.id)}`,
      title: it.headline,
      link,
      time,
      source,
      summary: typeof it.summary === "string" ? it.summary.slice(0, SUMMARY_MAX) : "",
    });
  }
  return out;
}

/**
 * Convertit un `seendate` GDELT (ISO 8601 COMPACT sans séparateurs, ex.
 * "20260707T120000Z") en ms epoch. `Date.parse` ne comprend PAS ce format compact
 * (contrairement au RFC-822/ISO-8601 « standard » des flux RSS/Atom) : on réinsère les
 * séparateurs avant délégation à `parseDate`. Repli sur `parseDate` brut si la forme
 * diffère (robustesse si GDELT fait évoluer le format). PURE.
 */
function parseGdeltSeenDate(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s.trim());
  if (!m) return parseDate(s);
  const [, y, mo, d, h, mi, se] = m;
  return parseDate(`${y}-${mo}-${d}T${h}:${mi}:${se}Z`);
}

/** Parse la réponse GDELT DOC 2.0 (`{ articles: [...] }`). PURE, défensive. */
export function parseGdeltNews(json: unknown): NewsItem[] {
  const articles = (json as { articles?: unknown })?.articles;
  if (!Array.isArray(articles)) return [];
  const out: NewsItem[] = [];
  for (const brut of articles) {
    if (brut === null || typeof brut !== "object") continue; // élément non exploitable, on l'ignore
    const it = brut as { title?: unknown; url?: unknown; seendate?: unknown };
    if (typeof it.title !== "string" || it.title.length === 0) continue;
    const link = typeof it.url === "string" ? it.url : "";
    const time = typeof it.seendate === "string" ? parseGdeltSeenDate(it.seendate) : 0;
    out.push({ id: link || `gdelt:${it.title}:${time}`, title: it.title, link, time, source: "gdelt", summary: "" });
  }
  return out;
}

// ─────────────────────────── Fusion multi-flux (pure) ───────────────────────────

/**
 * Fusionne plusieurs listes de news : dédup par LIEN (à défaut par id), en gardant la
 * plus récente en cas de doublon, puis tri par date décroissante. Fonction PURE.
 */
export function fusionner(listes: NewsItem[][]): NewsItem[] {
  const parCle = new Map<string, NewsItem>();
  for (const liste of listes) {
    for (const it of liste) {
      const cle = it.link || it.id;
      const existant = parCle.get(cle);
      if (existant === undefined || it.time > existant.time) parCle.set(cle, it);
    }
  }
  return [...parCle.values()].sort((a, b) => b.time - a.time);
}

// ─────────────────────────── Filtre « symbole actif » (pur) ───────────────────────────

/** Suffixes de cotation retirés pour isoler le ticker (du plus long au plus court). */
const SUFFIXES_COTATION = ["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USD", "EUR", "BTC", "ETH"];

/** Isole le ticker de base d'un symbole (« BTCUSDT » → « BTC »). */
function baseSymbole(symbol: string): string {
  const s = symbol.trim().toUpperCase().replace("/", "");
  for (const q of SUFFIXES_COTATION) {
    if (s.length > q.length && s.endsWith(q)) return s.slice(0, -q.length);
  }
  return s;
}

/**
 * Mots-clés (nom complet + ticker) associés aux 30+ actifs majeurs, pour filtrer les
 * news pertinentes au symbole affiché. Volontairement conservateur (heuristique) :
 * les tickers courts/ambigus s'appuient sur la correspondance par MOT ENTIER en aval.
 */
const MOTS_SYMBOLE: Record<string, string[]> = {
  BTC: ["bitcoin", "btc"],
  ETH: ["ethereum", "ether", "eth"],
  SOL: ["solana", "sol"],
  BNB: ["binance coin", "bnb"],
  XRP: ["ripple", "xrp"],
  ADA: ["cardano", "ada"],
  DOGE: ["dogecoin", "doge"],
  AVAX: ["avalanche", "avax"],
  DOT: ["polkadot", "dot"],
  LINK: ["chainlink", "link"],
  MATIC: ["polygon", "matic"],
  POL: ["polygon", "pol"],
  TRX: ["tron", "trx"],
  LTC: ["litecoin", "ltc"],
  SHIB: ["shiba inu", "shib"],
  UNI: ["uniswap", "uni"],
  ATOM: ["cosmos", "atom"],
  XLM: ["stellar", "xlm"],
  NEAR: ["near protocol", "near"],
  APT: ["aptos", "apt"],
  ARB: ["arbitrum", "arb"],
  OP: ["optimism", "op"],
  FIL: ["filecoin", "fil"],
  ICP: ["internet computer", "icp"],
  HBAR: ["hedera", "hbar"],
  INJ: ["injective", "inj"],
  SUI: ["sui"],
  SEI: ["sei"],
  TIA: ["celestia", "tia"],
  AAVE: ["aave"],
  MKR: ["maker", "makerdao", "mkr"],
  PEPE: ["pepe"],
  WIF: ["dogwifhat", "wif"],
};

/**
 * Mots-clés de recherche news dérivés d'un symbole (« ETHUSDT » → [ethereum, ether, eth]).
 * Repli : le ticker de base seul si l'actif n'est pas cartographié. Fonction PURE.
 */
export function symbolKeywords(symbol: string): string[] {
  const base = baseSymbole(symbol);
  return MOTS_SYMBOLE[base] ?? (base.length >= 2 ? [base.toLowerCase()] : []);
}

/** Échappe une chaîne pour usage littéral dans une RegExp. */
function echapperRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * La news matche-t-elle l'un des mots-clés ? Correspondance par MOT ENTIER (bornes de
 * mot) sur titre + résumé, insensible à la casse — limite les faux positifs des tickers
 * courts (ex. « op », « link »). Liste vide → toujours faux. Fonction PURE.
 */
export function estPertinentPourSymbole(item: NewsItem, motsCles: string[]): boolean {
  if (motsCles.length === 0) return false;
  const texte = `${item.title} ${item.summary}`.toLowerCase();
  return motsCles.some((kw) => {
    const k = kw.toLowerCase();
    return new RegExp(`(^|[^a-z0-9])${echapperRegex(k)}([^a-z0-9]|$)`, "i").test(texte);
  });
}

// ─────────────────────────── Horodatage relatif (pur) ───────────────────────────

/** Formatte un âge en « à l'instant » / « il y a 4 min » / « il y a 2 h » / « il y a 3 j ». */
export function tempsRelatif(ts: number, maintenant: number = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const delta = Math.max(0, maintenant - ts);
  const min = Math.floor(delta / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  if (j < 7) return `il y a ${j} j`;
  return `il y a ${Math.floor(j / 7)} sem`;
}

// ─────────────────────────── Récupération réseau + veille ───────────────────────────

/**
 * Récupère et parse un flux. Lève en cas d'échec réseau/HTTP (capté par allSettled).
 * Ramifie sur `feed.kind` : Finnhub est appelé DIRECT (CORS ouvert, clé requise, hors
 * proxy /extapi) ; l'absence de `kind` (5 flux RSS/Atom historiques) est INCHANGÉE.
 */
async function fetchFlux(feed: NewsFeed, signal?: AbortSignal): Promise<NewsItem[]> {
  if (feed.kind === "finnhub") {
    const cle = getFinnhubKey();
    if (cle === null) throw new Error(`${feed.label} : clé absente`);
    const categorie = feed.category ?? "general";
    const res = await fetch(`https://finnhub.io/api/v1/news?category=${categorie}&token=${cle}`, { signal });
    if (!res.ok) throw new Error(`${feed.label} HTTP ${res.status}`);
    return parseFinnhubNews(await res.json(), feed.id);
  }
  const res = await fetch(extUrl(feed.host, feed.path), { signal });
  if (!res.ok) throw new Error(`${feed.label} HTTP ${res.status}`);
  const xml = await res.text();
  return parseFeed(xml, feed.id);
}

/** Récupère et parse la recherche GDELT ciblée (mots-clés du symbole). Lève sur échec. */
async function fetchGdelt(motsCles: string[], signal?: AbortSignal): Promise<NewsItem[]> {
  const requete = encodeURIComponent(motsCles.join(" OR "));
  const url = extUrl("api.gdeltproject.org", `api/v2/doc/doc?query=${requete}&mode=artlist&format=json&maxrecords=20`);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`GDELT HTTP ${res.status}`);
  return parseGdeltNews(await res.json());
}

/** Statut d'un flux après un cycle. */
export type FeedStatut = "ok" | "vide" | "erreur";

/** Résultat d'un cycle de récupération multi-flux. */
export interface ResultatNews {
  items: NewsItem[];
  statuts: Partial<Record<NewsSourceId, FeedStatut>>;
  toutEnErreur: boolean;
}

/**
 * Interroge tous les flux en parallèle (dégradation par flux) puis fusionne. Si
 * `motsClesGdelt` est fourni et non vide, une recherche GDELT ciblée est ajoutée
 * DYNAMIQUEMENT à la volée (statut reporté sous la clé `"gdelt"`) ; absent/vide →
 * comportement INCHANGÉ (seuls les flux statiques `NEWS_FEEDS`).
 */
export async function fetchToutesLesNews(signal?: AbortSignal, motsClesGdelt?: string[]): Promise<ResultatNews> {
  const inclureGdelt = motsClesGdelt !== undefined && motsClesGdelt.length > 0;
  const taches: Array<Promise<NewsItem[]>> = NEWS_FEEDS.map((f) => fetchFlux(f, signal));
  if (inclureGdelt) taches.push(fetchGdelt(motsClesGdelt, signal));

  const resultats = await Promise.allSettled(taches);
  const listes: NewsItem[][] = [];
  const statuts: Partial<Record<NewsSourceId, FeedStatut>> = {};
  resultats.forEach((r, i) => {
    const id: NewsSourceId | undefined = i < NEWS_FEEDS.length ? NEWS_FEEDS[i]?.id : "gdelt";
    if (id === undefined) return;
    if (r.status === "fulfilled") {
      listes.push(r.value);
      statuts[id] = r.value.length > 0 ? "ok" : "vide";
    } else {
      statuts[id] = "erreur";
    }
  });
  return {
    items: fusionner(listes),
    statuts,
    toutEnErreur: resultats.every((r) => r.status === "rejected"),
  };
}

/**
 * Mots-clés GDELT courants de la veille — ÉTAT du module, lu au début de chaque cycle
 * (null = pas d'appel GDELT, flux statiques seuls). Posé via `definirMotsClesVeille`.
 */
let motsClesVeille: string[] | null = null;

/** Boucle UNIQUE partagée entre TOUS les appelants (refcount, cf. demarrerVeilleNews). */
let veillePartagee: { stop: Unsubscribe; abonnes: number } | null = null;

/** Boucle de veille effective (un pollLoop). Interne — voir demarrerVeilleNews. */
function creerBoucleVeille(): Unsubscribe {
  return pollLoop(
    async (signal, isCancelled) => {
      // Mots-clés lus au DÉBUT du cycle : un changement pendant un fetch en vol est pris
      // en compte au cycle suivant (ou via le cycle immédiat de definirMotsClesVeille).
      const { items, statuts, toutEnErreur } = await fetchToutesLesNews(signal, motsClesVeille ?? undefined);
      if (isCancelled()) return;
      if (toutEnErreur) {
        newsStore.getState().setStatuts(statuts);
        throw new Error("Tous les flux news sont hors ligne");
      }
      newsStore.getState().appliquerResultat(items, statuts);
    },
    NEWS_POLL_MS,
    // Affichage seul (bandeau + fenêtre NEWS), aucun consommateur d'alerte → suspendable
    // onglet masqué ; la reprise rafraîchit une fois si la période est dépassée.
    { immediate: true, source: HEALTH_SOURCE, suspendreSiMasque: true }
  );
}

/** Normalise des mots-clés de veille : liste vide (ou null) → null. Fonction PURE. */
export function normaliserMotsCles(motsCles: string[] | null): string[] | null {
  return motsCles !== null && motsCles.length > 0 ? motsCles : null;
}

/**
 * Égalité de deux jeux de mots-clés NORMALISÉS (élément par élément, ordre significatif —
 * suffisant : ils proviennent de `symbolKeywords`, d'ordre stable). Fonction PURE.
 */
export function memesMotsCles(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Définit les mots-clés GDELT de la veille partagée (null ou liste vide = pas d'appel
 * GDELT, comportement « sans filtre »). Pris en compte au cycle suivant ; la pose de
 * NOUVEAUX mots-clés déclenche EN PLUS un cycle immédiat : le pollLoop partagé est
 * remplacé par un neuf (`immediate: true`) — l'ancien est annulé (abort), son cycle en
 * vol éventuel ne livre rien (isCancelled), donc pas de résultat obsolète ; au pire un
 * statut santé « closed » transitoire. La remise à null est PARESSEUSE (prise en compte
 * au cycle suivant : les items GDELT résiduels disparaissent en ≤ 3 min, comme quand
 * l'ancienne boucle dédiée s'arrêtait) — pas de repoll complet inutile à la désactivation
 * du filtre. Appel idempotent : mots-clés identiques → aucun redémarrage.
 *
 * DÉFENSIF — le DERNIER appel gagne : il n'y a qu'UN état de mots-clés (pas de refcount
 * par appelant). Le cas réel est un seul consommateur GDELT (le panneau NEWS) ; si
 * plusieurs coexistaient, le dernier appel définirait les mots-clés pour tous. Appelable
 * aussi boucle arrêtée : l'état est mémorisé et lu au prochain démarrage.
 */
export function definirMotsClesVeille(motsCles: string[] | null): void {
  const apres = normaliserMotsCles(motsCles);
  if (memesMotsCles(motsClesVeille, apres)) return; // rien ne change : pas de cycle inutile
  motsClesVeille = apres;
  if (apres !== null && veillePartagee !== null) {
    veillePartagee.stop();
    veillePartagee.stop = creerBoucleVeille(); // refcount inchangé, les Unsubscribe restent valides
  }
}

/**
 * Démarre la veille news (poll 3 min, source « news » du registre santé). À appeler au
 * montage d'un consommateur (panneau NEWS, bandeau ticker) ; l'`Unsubscribe` retourné
 * (idempotent) libère l'abonnement au démontage.
 *
 * Boucle UNIQUE refcomptée, partagée par tous les appelants : bandeau ticker permanent +
 * panneau NEWS ouverts ensemble ne font qu'UN polling (le second abonné réutilise les
 * items ≤ 3 min du store, pas de refetch immédiat). La recherche GDELT ciblée (filtre
 * symbole du panneau) n'est PLUS une boucle dédiée : c'est un ÉTAT de la veille, posé via
 * `definirMotsClesVeille` — une seule boucle ⇒ plus d'écrasements croisés de `items`
 * (flip-flop GDELT) ni de flux pollés en double.
 *
 * Si TOUS les flux échouent, on conserve les news précédentes (pas d'écrasement à vide)
 * et on laisse pollLoop marquer la source en erreur (backoff).
 */
export function demarrerVeilleNews(): Unsubscribe {
  if (veillePartagee === null) veillePartagee = { stop: creerBoucleVeille(), abonnes: 0 };
  const partagee = veillePartagee;
  partagee.abonnes += 1;
  let libere = false;
  return () => {
    if (libere) return; // idempotent (StrictMode / double cleanup)
    libere = true;
    partagee.abonnes -= 1;
    if (partagee.abonnes <= 0 && veillePartagee === partagee) {
      partagee.stop();
      veillePartagee = null;
    }
  };
}
