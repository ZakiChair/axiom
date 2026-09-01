/**
 * Proxy des APIs sans CORS / à clé, RÉPLIQUE EXACTE des proxys de dev Vite
 * (apps/web/vite.config.ts) pour que le chemin de PROD (daemon) soit iso au dev :
 *   /fredapi      → https://api.stlouisfed.org       (clé api_key si absente)
 *   /coinalyzeapi → https://api.coinalyze.net        (clé api_key si absente)
 *   /tdapi        → https://api.twelvedata.com       (clé apikey si absente)
 *   /mexcapi      → https://api.mexc.com             (keyless, simple réécriture de chemin)
 *   /sosoapi      → https://openapi.sosovalue.com    (EN-TÊTE x-soso-api-key si absent)
 *   /ethscanapi   → https://api.etherscan.io         (clé apikey si absente)
 *   /bgapi → bitcoin-data.com (Bearer)
 *   /ccdataapi → min-api.cryptocompare.com (Apikey) — gestionnaire dédié traiterCcData, hors table
 *
 * Rappel BUILD-CONTRACT : le daemon ne proxifie JAMAIS le chemin chaud (les WS de
 * marché du front restent DIRECTS). Ici, uniquement du REST à quota, mis en cache.
 */
import { EXTAPI_HOSTS } from "../../../shared/extapi-hosts";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { cleCache, ecrireCache, lireCache, ttlMsPourChemin } from "./cache";
import { entetesCors } from "./cors";
import type { ProxyKeys } from "./env";
import type { Routeur } from "./router";

/**
 * Ajoute `<paramName>=<key>` à la query d'un chemin proxifié UNIQUEMENT si la
 * query n'en contient pas déjà une. Le proxy fournit une clé de repli (depuis
 * apps/web/.env) quand le front n'envoie aucune clé, mais une clé PERSONNELLE
 * déjà présente dans la query reste PRIORITAIRE et n'est jamais écrasée.
 *
 * COPIE VERBATIM de apps/web/src/data/apiKeyProxy.ts::appendApiKeyIfAbsent
 * (interdiction d'import cross-package apps/web ; source de vérité = ce commentaire).
 * Fonction PURE.
 */
export function appendApiKeyIfAbsent(path: string, paramName: string, key: string): string {
  if (key.length === 0) return path;
  const queryStart = path.indexOf("?");
  const query = queryStart === -1 ? "" : path.slice(queryStart + 1);
  const params = new URLSearchParams(query);
  if (params.has(paramName)) return path; // clé déjà fournie par le front → priorité à l'override
  const sep = queryStart === -1 ? "?" : "&";
  return `${path}${sep}${paramName}=${encodeURIComponent(key)}`;
}

/** Une route de proxy : préfixe entrant, amont, et réécriture du chemin. */
export interface RouteProxy {
  /** Préfixe entrant, ex. `/fredapi`. */
  prefix: string;
  /** Origine amont, ex. `https://api.stlouisfed.org`. */
  target: string;
  /** Réécriture : `chemin` = pathname+search commençant par `prefix` → chemin amont. */
  rewrite: (chemin: string) => string;
  /**
   * En-têtes à envoyer à l'amont, calculés depuis ceux du front (SoSoValue s'authentifie
   * par EN-TÊTE, pas par query param) : clé personnelle du front prioritaire, sinon repli
   * .env, sinon rien (l'amont répond 401). Absent → aucun en-tête particulier.
   */
  entetesAmont?: (entetesFront: Headers) => Record<string, string>;
}

/**
 * Construit les routes de proxy avec les clés injectées.
 * Chaque `rewrite` reproduit EXACTEMENT la réécriture du vite.config.ts correspondant.
 */
export function construireRoutesProxy(cles: ProxyKeys): RouteProxy[] {
  return [
    {
      prefix: "/fredapi",
      target: "https://api.stlouisfed.org",
      rewrite: (chemin) =>
        appendApiKeyIfAbsent(chemin.replace(/^\/fredapi/, ""), "api_key", cles.FRED_API_KEY),
    },
    {
      prefix: "/coinalyzeapi",
      target: "https://api.coinalyze.net",
      rewrite: (chemin) =>
        appendApiKeyIfAbsent(
          chemin.replace(/^\/coinalyzeapi/, ""),
          "api_key",
          cles.COINALYZE_API_KEY,
        ),
    },
    {
      // Twelve Data : la clé personnelle du front en query reste prioritaire ; le daemon
      // injecte TWELVE_DATA_KEY uniquement en repli, comme le proxy Vite local.
      prefix: "/tdapi",
      target: "https://api.twelvedata.com",
      rewrite: (chemin) =>
        appendApiKeyIfAbsent(
          chemin.replace(/^\/tdapi/, ""),
          "apikey",
          cles.TWELVE_DATA_KEY,
        ),
    },
    {
      prefix: "/mexcapi",
      target: "https://api.mexc.com",
      rewrite: (chemin) => chemin.replace(/^\/mexcapi/, ""),
    },
    {
      // SoSoValue : authentification par EN-TÊTE x-soso-api-key (pas de query param) →
      // réécriture = simple strip, l'injection de clé passe par `entetesAmont`.
      prefix: "/sosoapi",
      target: "https://openapi.sosovalue.com",
      rewrite: (chemin) => chemin.replace(/^\/sosoapi/, ""),
      entetesAmont: (entetesFront) => {
        const cle = entetesFront.get("x-soso-api-key") ?? cles.SOSOVALUE_API_KEY;
        const entetes: Record<string, string> = {};
        if (cle.length > 0) entetes["x-soso-api-key"] = cle;
        return entetes;
      },
    },
    {
      prefix: "/ethscanapi",
      target: "https://api.etherscan.io",
      rewrite: (chemin) =>
        appendApiKeyIfAbsent(chemin.replace(/^\/ethscanapi/, ""), "apikey", cles.ETHERSCAN_API_KEY),
    },
    {
      // BGeometrics : bitcoin-data.com n'accepte QUE l'en-tête `Authorization: Bearer <clé>`
      // (query param ou Authorization nu retombent sur le quota IP) → l'injection passe par
      // `entetesAmont`. Le front envoie déjà « Bearer <clé perso> » quand une clé personnelle
      // existe : on la relaie telle quelle (prioritaire) ; sinon repli .env préfixé « Bearer ».
      prefix: "/bgapi",
      target: "https://bitcoin-data.com",
      rewrite: (chemin) => chemin.replace(/^\/bgapi/, ""),
      entetesAmont: (entetesFront) => {
        const perso = entetesFront.get("authorization");
        const entetes: Record<string, string> = {};
        if (perso) entetes["authorization"] = perso;
        else if (cles.BGEOMETRICS_API_KEY.length > 0)
          entetes["authorization"] = `Bearer ${cles.BGEOMETRICS_API_KEY}`;
        return entetes;
      },
    },
  ];
}

/** Délai maximum d'un fetch amont des proxys à préfixe (ms) — même valeur que /extapi. */
const PROXY_TIMEOUT_MS = 15_000;

/** Dépendances injectables des tests de traiterProxy (cache + fetch). */
export interface OptionsProxy {
  fetchImpl?: FetchExtapi;
  lireCacheImpl?: typeof lireCache;
  ecrireCacheImpl?: typeof ecrireCache;
  timeoutMs?: number;
}

/**
 * Traite une requête proxifiée : cache GET (par préfixe), fetch amont, en-têtes
 * CORS + `X-Axiomd-Cache: hit|miss`. Les erreurs réseau renvoient un 502 propre
 * (le daemon ne plante pas).
 */
export async function traiterProxy(
  req: Request,
  url: URL,
  route: RouteProxy,
  options: OptionsProxy = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const lireCacheImpl = options.lireCacheImpl ?? lireCache;
  const ecrireCacheImpl = options.ecrireCacheImpl ?? ecrireCache;
  const delaiMs = Math.max(1, options.timeoutMs ?? PROXY_TIMEOUT_MS);
  const cheminEntrant = url.pathname + url.search;
  const urlAmont = route.target + route.rewrite(cheminEntrant);
  const cors = entetesCors(req);
  const entetesAmont = route.entetesAmont?.(req.headers) ?? {};

  if (req.method === "GET") {
    const ttlMs = ttlMsPourChemin(url.pathname);
    const cle = cleCache("GET", cheminEntrant);
    if (ttlMs > 0) {
      // Le cache est une OPTIMISATION : une panne SQLite (disque plein, base corrompue)
      // ne doit jamais faire échouer une requête dont l'amont est joignable — miss
      // forcé, même patron que /extapi (traiterExtapi).
      let hit: ReturnType<typeof lireCache> = null;
      try {
        hit = lireCacheImpl(cle);
      } catch (err) {
        console.error("[axiomd] cache proxy indisponible (miss forcé) :", err);
      }
      if (hit) {
        return new Response(hit.corps, {
          headers: { "content-type": hit.contentType, "x-axiomd-cache": "hit", ...cors },
        });
      }
    }
    // Timeout global : AbortController + setTimeout REF'D (pas AbortSignal.timeout()) —
    // même justification que recupererExtapiSecurise : minuteur annulable, déclenché
    // même si le fetch ne se résout que sur abort. Couvre en-têtes ET corps.
    let amont: Response;
    // ArrayBuffer (pas ArrayBufferLike) : BodyInit refuse le Uint8Array générique.
    let corps: Uint8Array<ArrayBuffer>;
    const controleur = new AbortController();
    const minuteur = setTimeout(
      () => controleur.abort(new Error(`timeout amont proxy dépassé (${delaiMs} ms)`)),
      delaiMs,
    );
    try {
      amont = await fetchImpl(urlAmont, {
        method: "GET",
        headers: entetesAmont,
        signal: controleur.signal,
      });
      corps = new Uint8Array(await amont.arrayBuffer());
    } catch (err) {
      return reponseErreurAmont(err, cors);
    } finally {
      clearTimeout(minuteur);
    }
    const contentType = amont.headers.get("content-type") ?? "application/octet-stream";
    // On ne met en cache que les réponses valides (évite de figer une erreur transitoire).
    if (ttlMs > 0 && amont.ok) {
      try {
        ecrireCacheImpl(cle, corps, contentType, ttlMs);
      } catch (err) {
        console.error("[axiomd] écriture cache proxy échouée :", err);
      }
    }
    return new Response(corps, {
      status: amont.status,
      headers: { "content-type": contentType, "x-axiomd-cache": "miss", ...cors },
    });
  }

  // Méthodes non-GET (rare pour ces APIs de lecture) : transfert direct, sans cache.
  const corpsReq = req.method === "HEAD" ? undefined : await req.arrayBuffer();
  let amont: Response;
  let corps: Uint8Array<ArrayBuffer>;
  const controleur = new AbortController();
  const minuteur = setTimeout(
    () => controleur.abort(new Error(`timeout amont proxy dépassé (${delaiMs} ms)`)),
    delaiMs,
  );
  try {
    amont = await fetchImpl(urlAmont, {
      method: req.method,
      body: corpsReq && corpsReq.byteLength > 0 ? corpsReq : undefined,
      headers: {
        ...(req.headers.get("content-type")
          ? { "content-type": req.headers.get("content-type") as string }
          : {}),
        ...entetesAmont,
      },
      signal: controleur.signal,
    });
    corps = new Uint8Array(await amont.arrayBuffer());
  } catch (err) {
    return reponseErreurAmont(err, cors);
  } finally {
    clearTimeout(minuteur);
  }
  return new Response(corps, {
    status: amont.status,
    headers: {
      "content-type": amont.headers.get("content-type") ?? "application/octet-stream",
      "x-axiomd-cache": "miss",
      ...cors,
    },
  });
}

function reponseErreurAmont(err: unknown, cors: Record<string, string>): Response {
  const message = err instanceof Error ? err.message : String(err);
  return new Response(JSON.stringify({ erreur: "amont injoignable", detail: message }), {
    status: 502,
    headers: { "content-type": "application/json; charset=utf-8", ...cors },
  });
}

// ─────────────────────────── Proxy générique /extapi (Phase 3) ───────────────────────────
//
// Route unique `/extapi/<hote>/<chemin...>` → réécrit vers `https://<hote>/<chemin>`
// UNIQUEMENT si `<hote>` figure dans EXTAPI_WHITELIST (sinon 403). GET only, User-Agent
// navigateur standard, timeout 15 s. Sert les APIs sans CORS de la Phase 3 (RSS news,
// calendriers éco, on-chain, Deribit, Binance fapi/dapi…) sans multiplier les préfixes.
//
// Source unique : shared/extapi-hosts.ts (aussi importée par vite.config + extapi.ts).
/** Hôtes autorisés pour /extapi (frontière d'autorité 403). */
export const EXTAPI_WHITELIST: ReadonlySet<string> = new Set(EXTAPI_HOSTS);

/** User-Agent navigateur standard : certains hôtes (RSS, Cloudflare) refusent un UA vide. */
const EXTAPI_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Hôtes exigeant un User-Agent CONFORME (identifiant + contact avec "@"), pas le UA navigateur
 * générique : la politique d'accès équitable de la SEC bloque/liste noire les UA sans
 * token de contact (@). Le UA DOIT inclure un identifiant de contact (ex: email) pour
 * passer le contrôle d'accès équitable de SEC. Un `fetch()` navigateur ne peut de toute
 * façon PAS surcharger `User-Agent` (en-tête interdit côté client) — ce proxy est le SEUL
 * endroit où l'injecter. */
const EXTAPI_USER_AGENT_SEC = "AxiomTerminal/1.0 (contact: axiom-terminal@example.com)";
const EXTAPI_USER_AGENT_HOTES: ReadonlyMap<string, string> = new Map([
  ["data.sec.gov", EXTAPI_USER_AGENT_SEC],
  ["www.sec.gov", EXTAPI_USER_AGENT_SEC],
]);

/** User-Agent à envoyer à l'amont pour un hôte /extapi donné. Fonction PURE (testée). */
export function userAgentPourHote(hote: string): string {
  return EXTAPI_USER_AGENT_HOTES.get(hote) ?? EXTAPI_USER_AGENT;
}

/** Délai maximum d'un fetch amont /extapi (ms). */
const EXTAPI_TIMEOUT_MS = 15_000;

/** Nombre maximal de redirections suivies manuellement par /extapi. */
export const EXTAPI_MAX_REDIRECTIONS = 5;

/** Taille maximale d'un corps /extapi, APRÈS décompression HTTP éventuelle (32 Mio). */
export const EXTAPI_TAILLE_MAX_CORPS = 32 * 1024 * 1024;

/** En-têtes de défense en profondeur ajoutés à TOUTES les réponses /extapi. */
const ENTETES_SECURITE_EXTAPI: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "sandbox; default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

/** Destinations Fetch qui pourraient interpréter le corps proxifié comme contenu actif. */
const DESTINATIONS_NAVIGATION_INTERDITES: ReadonlySet<string> = new Set([
  "document",
  "iframe",
  "frame",
  "script",
  "worker",
  "sharedworker",
  "serviceworker",
  "object",
  "embed",
  "style",
]);

/** MIME de données explicitement acceptés. HTML/SVG/JS/CSS/PDF restent refusés. */
const MIME_EXTAPI_AUTORISES: ReadonlySet<string> = new Set([
  "application/json",
  "application/ld+json",
  "application/geo+json",
  "application/x-ndjson",
  "application/ndjson",
  "text/json",
  "application/xml",
  "text/xml",
  "application/rss+xml",
  "application/atom+xml",
  "text/plain",
  "text/csv",
  "text/x-csv",
  "text/tab-separated-values",
  "application/csv",
  "application/x-csv",
  "application/vnd.ms-excel",
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
]);

/** Résolveur DNS injectable : renvoie toutes les adresses d'un hôte. */
export type ResoudreHoteExtapi = (hote: string) => Promise<readonly string[]>;

/** Sous-ensemble portable de fetch utilisé par /extapi (sans extensions statiques Bun). */
export type FetchExtapi = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Dépendances/options injectables des tests du proxy sécurisé. */
export interface OptionsExtapi {
  fetchImpl?: FetchExtapi;
  resoudreHote?: ResoudreHoteExtapi;
  lireCacheImpl?: typeof lireCache;
  ecrireCacheImpl?: typeof ecrireCache;
  timeoutMs?: number;
  tailleMaxCorps?: number;
  maxRedirections?: number;
  entetesAmont?: HeadersInit;
  hotesAutorises?: ReadonlySet<string>;
}

/** Réponse amont matérialisée seulement après toutes les gardes de sécurité. */
export interface ReponseAmontExtapi {
  corps: Uint8Array<ArrayBuffer>;
  contentType: string;
  status: number;
  headers: Headers;
}

/** Erreur de politique distincte d'une panne réseau ordinaire. */
class ErreurPolitiqueExtapi extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurPolitiqueExtapi";
  }
}

/** Retire les crochets d'un littéral IPv6 tel que renvoyé par URL.hostname. */
function sansCrochets(hote: string): string {
  return hote.startsWith("[") && hote.endsWith("]") ? hote.slice(1, -1) : hote;
}

/** Parse une adresse IPv4 canonique en quatre octets. */
function octetsIpv4(adresse: string): [number, number, number, number] | null {
  if (isIP(adresse) !== 4) return null;
  const p = adresse.split(".").map(Number);
  if (p.length !== 4 || p.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return null;
  return [p[0] as number, p[1] as number, p[2] as number, p[3] as number];
}

/** IPv4 publiquement routable (politique conservatrice : réservées/documentation refusées). */
function ipv4Publique(adresse: string): boolean {
  const o = octetsIpv4(adresse);
  if (!o) return false;
  const [a, b, c] = o;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64/10
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmark
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  return true;
}

/** Parse une IPv6 (avec `::` et éventuelle queue IPv4) en entier 128 bits. */
function valeurIpv6(adresseBrute: string): bigint | null {
  let adresse = sansCrochets(adresseBrute).toLowerCase();
  if (adresse.includes("%")) return null; // zone link-local (`%lo0`) jamais autorisée
  const posDernierDeuxPoints = adresse.lastIndexOf(":");
  const queue = posDernierDeuxPoints === -1 ? adresse : adresse.slice(posDernierDeuxPoints + 1);
  if (queue.includes(".")) {
    const octets = octetsIpv4(queue);
    if (!octets) return null;
    const [a, b, c, d] = octets;
    adresse =
      adresse.slice(0, posDernierDeuxPoints + 1) +
      ((a << 8) | b).toString(16) +
      ":" +
      ((c << 8) | d).toString(16);
  }
  const morceaux = adresse.split("::");
  if (morceaux.length > 2) return null;
  const gauche = morceaux[0] ? morceaux[0].split(":") : [];
  const droite = morceaux.length === 2 && morceaux[1] ? morceaux[1].split(":") : [];
  if (morceaux.length === 1 && gauche.length !== 8) return null;
  const manquants = 8 - gauche.length - droite.length;
  if (manquants < (morceaux.length === 2 ? 1 : 0)) return null;
  const groupes = [...gauche, ...Array<string>(manquants).fill("0"), ...droite];
  if (groupes.length !== 8 || groupes.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  let valeur = 0n;
  for (const groupe of groupes) valeur = (valeur << 16n) | BigInt(parseInt(groupe, 16));
  return valeur;
}

function ipv6DansPrefixe(adresse: bigint, base: bigint, longueur: number): boolean {
  const decalage = BigInt(128 - longueur);
  return adresse >> decalage === base >> decalage;
}

const IPV6_MAPPED = valeurIpv6("::ffff:0:0") as bigint;
const IPV6_NAT64 = valeurIpv6("64:ff9b::") as bigint;
const IPV6_DOCUMENTATION = valeurIpv6("2001:db8::") as bigint;
const IPV6_TEREDO = valeurIpv6("2001::") as bigint;
const IPV6_BENCHMARK = valeurIpv6("2001:2::") as bigint;
const IPV6_ORCHID = valeurIpv6("2001:10::") as bigint;
const IPV6_ORCHID_V2 = valeurIpv6("2001:20::") as bigint;
const IPV6_6TO4 = valeurIpv6("2002::") as bigint;
const IPV6_6BONE = valeurIpv6("3ffe::") as bigint;

/** IPv6 publiquement routable, en refusant aussi les plages tunnel/réservées ambiguës. */
function ipv6Publique(adresse: string): boolean {
  const valeur = valeurIpv6(adresse);
  if (valeur === null || valeur === 0n || valeur === 1n) return false;

  // IPv4 mappée / NAT64 : applique la politique IPv4 à la destination encapsulée.
  if (ipv6DansPrefixe(valeur, IPV6_MAPPED, 96) || ipv6DansPrefixe(valeur, IPV6_NAT64, 96)) {
    const v4 = Number(valeur & 0xffff_ffffn);
    return ipv4Publique(`${(v4 >>> 24) & 255}.${(v4 >>> 16) & 255}.${(v4 >>> 8) & 255}.${v4 & 255}`);
  }

  // Global unicast actuel = 2000::/3 ; les exceptions ci-dessous restent non sûres.
  if (valeur >> 125n !== 1n) return false;
  if (ipv6DansPrefixe(valeur, IPV6_DOCUMENTATION, 32)) return false;
  if (ipv6DansPrefixe(valeur, IPV6_TEREDO, 32)) return false;
  if (ipv6DansPrefixe(valeur, IPV6_BENCHMARK, 48)) return false;
  if (ipv6DansPrefixe(valeur, IPV6_ORCHID, 28)) return false;
  if (ipv6DansPrefixe(valeur, IPV6_ORCHID_V2, 28)) return false;
  if (ipv6DansPrefixe(valeur, IPV6_6TO4, 16)) return false;
  if (ipv6DansPrefixe(valeur, IPV6_6BONE, 16)) return false;
  return true;
}

/** Une adresse DNS/littérale est-elle publiquement routable ? Fonction PURE et testée. */
export function adresseIpPublique(adresseBrute: string): boolean {
  const adresse = sansCrochets(adresseBrute);
  const famille = isIP(adresse);
  return famille === 4 ? ipv4Publique(adresse) : famille === 6 ? ipv6Publique(adresse) : false;
}

/** Résolution DNS par défaut : toutes les réponses doivent être publiques. */
async function resoudreHotePublic(hote: string): Promise<readonly string[]> {
  const resultats = await lookup(hote, { all: true, verbatim: true });
  return resultats.map((r) => r.address);
}

/** Borne aussi la phase DNS avec le même signal que le fetch et la lecture du corps. */
function avecSignalExtapi<T>(promesse: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const interrompre = () => reject(signal.reason);
    signal.addEventListener("abort", interrompre, { once: true });
    promesse.then(
      (valeur) => {
        signal.removeEventListener("abort", interrompre);
        resolve(valeur);
      },
      (err) => {
        signal.removeEventListener("abort", interrompre);
        reject(err);
      },
    );
  });
}

/** Un type MIME amont est-il une donnée inerte acceptée par /extapi ? */
export function mimeExtapiAutorise(contentType: string): boolean {
  const mime = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (MIME_EXTAPI_AUTORISES.has(mime)) return true;
  return /^application\/[a-z0-9!#$&^_.+-]+\+(?:json|xml|csv)$/.test(mime);
}

/** Rejette les chargements capables d'interpréter le corps comme document/code actif. */
export function requeteNavigationExtapiInterdite(req: Request): boolean {
  const destination = (req.headers.get("sec-fetch-dest") ?? "").trim().toLowerCase();
  const mode = (req.headers.get("sec-fetch-mode") ?? "").trim().toLowerCase();
  return mode === "navigate" || DESTINATIONS_NAVIGATION_INTERDITES.has(destination);
}

/** Valide schéma, autorité et résolution DNS AVANT chaque fetch (initial et redirects). */
async function validerDestinationExtapi(
  url: URL,
  resoudreHote: ResoudreHoteExtapi,
  signal: AbortSignal,
  hotesAutorises: ReadonlySet<string>,
): Promise<void> {
  if (url.protocol !== "https:") throw new ErreurPolitiqueExtapi("schéma amont refusé (HTTPS requis)");
  if (url.username || url.password) throw new ErreurPolitiqueExtapi("identifiants dans l'URL refusés");
  if (url.port && url.port !== "443") throw new ErreurPolitiqueExtapi("port amont refusé (443 requis)");
  const hote = sansCrochets(url.hostname).toLowerCase();
  if (!hotesAutorises.has(hote)) throw new ErreurPolitiqueExtapi(`hôte de redirection non autorisé : ${hote}`);
  const adresses = isIP(hote) ? [hote] : await avecSignalExtapi(resoudreHote(hote), signal);
  if (adresses.length === 0) throw new ErreurPolitiqueExtapi(`résolution DNS vide : ${hote}`);
  if (adresses.some((adresse) => !adresseIpPublique(adresse))) {
    throw new ErreurPolitiqueExtapi(`destination DNS non publique refusée : ${hote}`);
  }
}

/** Lit un corps en flux avec pré-borne Content-Length ET borne réelle. */
async function lireCorpsExtapiBorne(res: Response, tailleMax: number): Promise<Uint8Array<ArrayBuffer>> {
  const longueur = res.headers.get("content-length");
  if (longueur !== null) {
    const annoncee = Number(longueur);
    if (Number.isFinite(annoncee) && annoncee > tailleMax) {
      await res.body?.cancel().catch(() => {});
      throw new ErreurPolitiqueExtapi(`corps amont trop volumineux (> ${tailleMax} octets)`);
    }
  }
  if (!res.body) return new Uint8Array();
  const lecteur = res.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > tailleMax) {
        await lecteur.cancel("corps /extapi trop volumineux").catch(() => {});
        throw new ErreurPolitiqueExtapi(`corps amont trop volumineux (> ${tailleMax} octets)`);
      }
      morceaux.push(value);
    }
  } finally {
    lecteur.releaseLock();
  }
  const corps = new Uint8Array(total);
  let offset = 0;
  for (const morceau of morceaux) {
    corps.set(morceau, offset);
    offset += morceau.byteLength;
  }
  return corps;
}

/**
 * Fetch /extapi durci : timeout GLOBAL, redirects manuels, revalidation DNS à chaque
 * saut, MIME inerte et lecture bornée. Exporté pour les tests d'intégration hors DB.
 */
export async function recupererExtapiSecurise(
  urlInitiale: string,
  options: OptionsExtapi = {},
): Promise<ReponseAmontExtapi> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resoudreHote = options.resoudreHote ?? resoudreHotePublic;
  const tailleMax = Math.max(1, options.tailleMaxCorps ?? EXTAPI_TAILLE_MAX_CORPS);
  const maxRedirections = Math.max(0, options.maxRedirections ?? EXTAPI_MAX_REDIRECTIONS);
  const hotesAutorises = options.hotesAutorises ?? EXTAPI_WHITELIST;
  // Timeout global : AbortController + setTimeout EXPLICITES, et NON AbortSignal.timeout().
  //
  // Raison (diagnostic CI du 2026-07-24) : le minuteur d'`AbortSignal.timeout()` est
  // UNREF'D — il ne maintient pas la boucle d'évènements vivante et peut donc ne JAMAIS
  // se déclencher quand il est le seul travail en attente. C'est exactement le cas d'un
  // appelant dont le fetch ne se résout que sur `abort` : plus rien ne fait avancer la
  // boucle, l'abort n'arrive pas, on attend indéfiniment. En CI le job en mourait au
  // timeout (aucune sortie pendant 3 min sur `proxy.test.ts`) ; en local le même test
  // passait — dépendre de l'ordonnancement d'un timer unref'd est intrinsèquement fragile.
  // Un `setTimeout` est ref'd : il se déclenche toujours.
  //
  // Bénéfice au passage : ce minuteur est ANNULABLE. L'ancien signal laissait un timer de
  // 15 s pendant après CHAQUE requête, y compris celles terminées en quelques ms.
  //
  // La raison d'abort est un `Error` NU (surtout pas `ErreurPolitiqueExtapi`) : `traiterExtapi`
  // distingue les deux pour son libellé — un timeout est « amont injoignable », pas un refus
  // de politique. Le statut reste 502 dans les deux cas.
  const controleur = new AbortController();
  const signal = controleur.signal;
  const delaiMs = Math.max(1, options.timeoutMs ?? EXTAPI_TIMEOUT_MS);
  const minuteur = setTimeout(
    () => controleur.abort(new Error(`timeout amont /extapi dépassé (${delaiMs} ms)`)),
    delaiMs,
  );
  let courante = new URL(urlInitiale);

  try {
    for (let redirections = 0; ; redirections++) {
      await validerDestinationExtapi(courante, resoudreHote, signal, hotesAutorises);
      const hote = sansCrochets(courante.hostname).toLowerCase();
      const entetes = new Headers({ "user-agent": userAgentPourHote(hote), accept: "*/*" });
      for (const [cle, valeur] of new Headers(options.entetesAmont)) entetes.set(cle, valeur);
      const amont = await fetchImpl(courante, {
        method: "GET",
        headers: entetes,
        signal,
        redirect: "manual",
      });
      if ([301, 302, 303, 307, 308].includes(amont.status)) {
        const location = amont.headers.get("location");
        await amont.body?.cancel().catch(() => {});
        if (redirections >= maxRedirections) throw new ErreurPolitiqueExtapi("trop de redirections amont");
        if (!location) throw new ErreurPolitiqueExtapi("redirection amont sans Location");
        try {
          courante = new URL(location, courante);
        } catch {
          throw new ErreurPolitiqueExtapi("Location de redirection amont invalide");
        }
        continue;
      }
      const contentType = amont.headers.get("content-type") ?? "application/octet-stream";
      if (!mimeExtapiAutorise(contentType)) {
        await amont.body?.cancel().catch(() => {});
        throw new ErreurPolitiqueExtapi(`type MIME amont refusé : ${contentType.split(";", 1)[0] ?? "inconnu"}`);
      }
      const corps = await lireCorpsExtapiBorne(amont, tailleMax);
      return { corps, contentType, status: amont.status, headers: amont.headers };
    }
  } finally {
    clearTimeout(minuteur);
  }
}

export async function traiterCcData(
  req: Request,
  url: URL,
  options: OptionsExtapi = {},
): Promise<Response> {
  const cors = entetesCors(req);
  const securite = ENTETES_SECURITE_EXTAPI;
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    ...securite,
    ...cors,
  };
  if (requeteNavigationExtapiInterdite(req)) {
    return new Response(JSON.stringify({ erreur: "navigation CCData interdite" }), {
      status: 403,
      headers,
    });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ erreur: "méthode CCData non autorisée" }), {
      status: 405,
      headers: { ...headers, allow: "GET" },
    });
  }
  const authorization = req.headers.get("authorization");
  if (
    authorization === null ||
    authorization.length > 512 ||
    !/^Apikey\s+\S+$/i.test(authorization)
  ) {
    return new Response(JSON.stringify({ erreur: "clé CCData absente ou invalide" }), {
      status: 401,
      headers,
    });
  }

  const hote = "min-api.cryptocompare.com";
  const chemin = url.pathname.replace(/^\/ccdataapi/, "");
  const cible = new URL(`https://${hote}`);
  cible.pathname = chemin.startsWith("/") ? chemin : `/${chemin}`;
  cible.search = url.search;
  let amont: ReponseAmontExtapi;
  try {
    amont = await recupererExtapiSecurise(cible.toString(), {
      ...options,
      entetesAmont: {
        accept: req.headers.get("accept") ?? "application/json",
        authorization,
      },
      hotesAutorises: new Set([hote]),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        erreur: err instanceof ErreurPolitiqueExtapi ? "amont CCData refusé" : "amont CCData injoignable",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 502, headers },
    );
  }

  const entetes: Record<string, string> = {
    "content-type": amont.contentType,
    "cache-control": "private, no-store",
    ...securite,
    ...cors,
  };
  const credits = amont.headers.get("x-rate-limit-remaining");
  if (credits !== null) entetes["x-rate-limit-remaining"] = credits;
  const statutSansCorps = amont.status === 204 || amont.status === 205 || amont.status === 304;
  return new Response(statutSansCorps ? null : amont.corps, {
    status: amont.status,
    headers: entetes,
  });
}

/** TTL cache /extapi par défaut (RSS et calendriers sont lents). */
const EXTAPI_TTL_DEFAUT_MS = 120_000;
/** TTL cache réduit pour les dérivés Binance (données quasi temps réel). */
const EXTAPI_TTL_DERIVES_MS = 30_000;
/**
 * TTL cache OpenSky : STRICTEMENT INFÉRIEUR à la cadence de poll du front
 * (INTERVALLE_POLL_MS = 120 s, data/globe/opensky.ts). Un TTL égal au poll créait un
 * aliasing : le cache étant écrit APRÈS la latence amont, le tick suivant tombait
 * toujours sur un hit → un instantané sur deux était resservi tel quel (avions figés
 * 4 min). À 90 s, chaque tick du front est un miss et repart à l'amont — la cadence
 * amont réelle reste 1 appel/120 s (le budget crédits commenté côté front tient).
 */
const EXTAPI_TTL_OPENSKY_MS = 90_000;

/**
 * TTL cache (ms) d'un hôte /extapi : 30 s pour fapi/dapi.binance.com (dérivés),
 * 90 s pour opensky-network.org (anti-aliasing avec le poll front, cf. ci-dessus),
 * 120 s sinon (RSS, calendriers, on-chain lents). Fonction PURE (testée).
 * Réutilise le stockage de cache.ts, mais calcule le TTL ICI car cache.ts (hors
 * périmètre de cet agent) ne connaît que les 4 préfixes historiques.
 */
export function ttlMsExtapi(hote: string): number {
  if (hote === "fapi.binance.com" || hote === "dapi.binance.com") return EXTAPI_TTL_DERIVES_MS;
  if (hote === "opensky-network.org") return EXTAPI_TTL_OPENSKY_MS;
  return EXTAPI_TTL_DEFAUT_MS;
}

/**
 * Extrait l'hôte (1er segment après `/extapi/`) et le reste du chemin. Fonction PURE.
 * Renvoie `null` si le chemin n'a pas la forme `/extapi/<hote>[/...]` (hôte manquant).
 * `reste` commence par `/` (ou est vide si aucun sous-chemin).
 */
export function parseExtapiChemin(pathname: string): { hote: string; reste: string } | null {
  if (pathname !== "/extapi" && !pathname.startsWith("/extapi/")) return null;
  const apres = pathname.slice("/extapi".length); // "" | "/" | "/hote/reste…"
  if (!apres.startsWith("/")) return null;
  const sansSlash = apres.slice(1); // "hote/reste…"
  const posSlash = sansSlash.indexOf("/");
  const hote = posSlash === -1 ? sansSlash : sansSlash.slice(0, posSlash);
  const reste = posSlash === -1 ? "" : sansSlash.slice(posSlash); // "/reste…" | ""
  if (hote.length === 0) return null;
  return { hote, reste };
}

/**
 * Construit l'URL amont `https://<hote><reste><search>` pour une requête /extapi,
 * ou `null` si l'hôte est absent / non whitelisté. Fonction PURE (testée).
 */
export function construireUrlAmontExtapi(pathname: string, search: string): string | null {
  const parsed = parseExtapiChemin(pathname);
  if (!parsed || !EXTAPI_WHITELIST.has(parsed.hote)) return null;
  return `https://${parsed.hote}${parsed.reste}${search}`;
}

/**
 * Traite une requête /extapi : whitelist (403 sinon), GET only (405 sinon), cache
 * TTL, fetch amont avec User-Agent navigateur + timeout 15 s. En-têtes CORS +
 * `X-Axiomd-Cache`. Dégradation gracieuse : amont injoignable → 502 propre.
 */
export async function traiterExtapi(req: Request, url: URL, options: OptionsExtapi = {}): Promise<Response> {
  const cors = entetesCors(req);
  const securite = ENTETES_SECURITE_EXTAPI;
  if (requeteNavigationExtapiInterdite(req)) {
    return new Response(JSON.stringify({ erreur: "navigation /extapi interdite (API fetch uniquement)" }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8", ...securite, ...cors },
    });
  }
  const parsed = parseExtapiChemin(url.pathname);
  if (!parsed || !EXTAPI_WHITELIST.has(parsed.hote)) {
    return new Response(
      JSON.stringify({ erreur: "hôte non autorisé", hote: parsed?.hote ?? null }),
      { status: 403, headers: { "content-type": "application/json; charset=utf-8", ...securite, ...cors } },
    );
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ erreur: "méthode non autorisée (GET uniquement)" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8", allow: "GET", ...securite, ...cors },
    });
  }

  const cheminEntrant = url.pathname + url.search;
  const cle = cleCache("GET", cheminEntrant);
  const lireCacheImpl = options.lireCacheImpl ?? lireCache;
  const ecrireCacheImpl = options.ecrireCacheImpl ?? ecrireCache;
  const tailleMax = Math.max(1, options.tailleMaxCorps ?? EXTAPI_TAILLE_MAX_CORPS);
  let hit: ReturnType<typeof lireCache> = null;
  try {
    hit = lireCacheImpl(cle);
  } catch (err) {
    console.error("[axiomd] cache /extapi indisponible (miss forcé) :", err);
  }
  if (hit) {
    if (hit.corps.byteLength <= tailleMax && mimeExtapiAutorise(hit.contentType)) {
      return new Response(hit.corps, {
        headers: {
          "content-type": hit.contentType,
          "x-axiomd-cache": "hit",
          "access-control-expose-headers": "x-axiomd-cache, x-rate-limit-remaining",
          ...securite,
          ...cors,
        },
      });
    }
    // Une ancienne entrée ne respectant plus la politique devient un miss ; une
    // réponse amont saine l'écrasera, sans exposer le corps historique.
    console.warn("[axiomd] entrée cache /extapi ignorée par la politique :", cle);
  }

  const urlAmont = `https://${parsed.hote}${parsed.reste}${url.search}`;
  let amont: ReponseAmontExtapi;
  try {
    amont = await recupererExtapiSecurise(urlAmont, options);
  } catch (err) {
    return new Response(
      JSON.stringify({
        erreur: err instanceof ErreurPolitiqueExtapi ? "amont refusé par la politique /extapi" : "amont injoignable",
        detail: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 502,
        headers: { "content-type": "application/json; charset=utf-8", ...securite, ...cors },
      },
    );
  }
  // On ne met en cache que les réponses valides (évite de figer une erreur transitoire).
  // Le cache ne stocke pas le statut : uniquement 200, sinon un hit deviendrait 200 à tort.
  if (amont.status === 200) {
    try {
      ecrireCacheImpl(cle, amont.corps, amont.contentType, ttlMsExtapi(parsed.hote));
    } catch (err) {
      // Le cache est une optimisation : une panne SQLite ne doit pas masquer une réponse saine.
      console.error("[axiomd] écriture cache /extapi échouée :", err);
    }
  }
  const entetes: Record<string, string> = {
    "content-type": amont.contentType,
    "x-axiomd-cache": "miss",
    "access-control-expose-headers": "x-axiomd-cache, x-rate-limit-remaining",
    ...securite,
    ...cors,
  };
  // Quota OpenSky : retransmettre l'en-tête de crédits restants (absent sur un hit —
  // le cache ne stocke que corps+content-type ; valeur indicative, miss uniquement).
  const credits = amont.headers.get("x-rate-limit-remaining");
  if (credits !== null) entetes["x-rate-limit-remaining"] = credits;
  const statutSansCorps = amont.status === 204 || amont.status === 205 || amont.status === 304;
  return new Response(statutSansCorps ? null : amont.corps, {
    status: amont.status,
    headers: entetes,
  });
}

/** Enregistre les routes de proxy à clé + le proxy générique /extapi dans le routeur. */
export function enregistrerProxy(routeur: Routeur, cles: ProxyKeys): void {
  for (const route of construireRoutesProxy(cles)) {
    routeur.enregistrerPrefixe(route.prefix, (req, url) => traiterProxy(req, url, route));
  }
  // /ccdataapi : gestionnaire DÉDIÉ durci (validation Apikey + gardes /extapi), PAS une
  // RouteProxy générique — traiterCcData recalcule cible, réécriture et validation lui-même.
  routeur.enregistrerPrefixe("/ccdataapi", (req, url) => traiterCcData(req, url));
  // Proxy générique /extapi (Phase 3) : hôtes whitelistés, GET only, cache TTL.
  routeur.enregistrerPrefixe("/extapi", (req, url) => traiterExtapi(req, url));
}
