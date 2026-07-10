/**
 * Proxy des APIs sans CORS / à clé, RÉPLIQUE EXACTE des proxys de dev Vite
 * (apps/web/vite.config.ts) pour que le chemin de PROD (daemon) soit iso au dev :
 *   /fredapi      → https://api.stlouisfed.org       (clé api_key si absente)
 *   /coinalyzeapi → https://api.coinalyze.net        (clé api_key si absente)
 *   /tdapi        → https://api.twelvedata.com       (apikey TOUJOURS ajoutée, cf. Vite)
 *   /mexcapi      → https://api.mexc.com             (keyless, simple réécriture de chemin)
 *   /sosoapi      → https://openapi.sosovalue.com    (EN-TÊTE x-soso-api-key si absent)
 *   /ethscanapi   → https://api.etherscan.io         (clé apikey si absente)
 *
 * Rappel BUILD-CONTRACT : le daemon ne proxifie JAMAIS le chemin chaud (les WS de
 * marché du front restent DIRECTS). Ici, uniquement du REST à quota, mis en cache.
 */
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
 * Construit les 4 routes de proxy avec les clés injectées.
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
      // Twelve Data : Vite ajoute TOUJOURS `apikey` (pas de « si absente ») car le
      // front n'a pas de mécanisme d'override pour cette source → on réplique tel quel.
      prefix: "/tdapi",
      target: "https://api.twelvedata.com",
      rewrite: (chemin) => {
        const stripped = chemin.replace(/^\/tdapi/, "");
        const sep = stripped.includes("?") ? "&" : "?";
        return `${stripped}${sep}apikey=${cles.TWELVE_DATA_KEY}`;
      },
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
  ];
}

/**
 * Traite une requête proxifiée : cache GET (par préfixe), fetch amont, en-têtes
 * CORS + `X-Axiomd-Cache: hit|miss`. Les erreurs réseau renvoient un 502 propre
 * (le daemon ne plante pas).
 */
export async function traiterProxy(req: Request, url: URL, route: RouteProxy): Promise<Response> {
  const cheminEntrant = url.pathname + url.search;
  const urlAmont = route.target + route.rewrite(cheminEntrant);
  const cors = entetesCors(req);
  const entetesAmont = route.entetesAmont?.(req.headers) ?? {};

  if (req.method === "GET") {
    const ttlMs = ttlMsPourChemin(url.pathname);
    const cle = cleCache("GET", cheminEntrant);
    if (ttlMs > 0) {
      const hit = lireCache(cle);
      if (hit) {
        return new Response(hit.corps, {
          headers: { "content-type": hit.contentType, "x-axiomd-cache": "hit", ...cors },
        });
      }
    }
    let amont: Response;
    try {
      amont = await fetch(urlAmont, { method: "GET", headers: entetesAmont });
    } catch (err) {
      return reponseErreurAmont(err, cors);
    }
    const corps = new Uint8Array(await amont.arrayBuffer());
    const contentType = amont.headers.get("content-type") ?? "application/octet-stream";
    // On ne met en cache que les réponses valides (évite de figer une erreur transitoire).
    if (ttlMs > 0 && amont.ok) ecrireCache(cle, corps, contentType, ttlMs);
    return new Response(corps, {
      status: amont.status,
      headers: { "content-type": contentType, "x-axiomd-cache": "miss", ...cors },
    });
  }

  // Méthodes non-GET (rare pour ces APIs de lecture) : transfert direct, sans cache.
  const corpsReq = req.method === "HEAD" ? undefined : await req.arrayBuffer();
  let amont: Response;
  try {
    amont = await fetch(urlAmont, {
      method: req.method,
      body: corpsReq && corpsReq.byteLength > 0 ? corpsReq : undefined,
      headers: {
        ...(req.headers.get("content-type")
          ? { "content-type": req.headers.get("content-type") as string }
          : {}),
        ...entetesAmont,
      },
    });
  } catch (err) {
    return reponseErreurAmont(err, cors);
  }
  const corps = new Uint8Array(await amont.arrayBuffer());
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
// ⚠️ WHITELIST DUPLIQUÉE dans 3 fichiers (synchronisation MANUELLE) :
//   1. apps/daemon/src/proxy.ts       (ici — proxy de PROD, frontière d'autorité 403)
//   2. apps/web/vite.config.ts        (proxy de DEV — une entrée par hôte)
//   3. apps/web/src/data/extapi.ts    (helper front + constante documentée)
// Toute modification ici DOIT être répercutée dans les deux autres.

/** Hôtes autorisés pour /extapi (voir commentaire croisé ci-dessus). */
export const EXTAPI_WHITELIST: ReadonlySet<string> = new Set([
  "nfs.faireconomy.media", // ForexFactory JSON (calendrier éco)
  "www.coindesk.com", // RSS news
  "cointelegraph.com", // RSS news
  "www.theblock.co", // RSS news
  "decrypt.co", // RSS news
  "blockworks.com", // RSS news
  "api.alternative.me", // Fear & Greed Index
  "community-api.coinmetrics.io", // Coin Metrics Community (on-chain)
  "bitcoin-data.com", // BGeometrics (MVRV-Z, SOPR, NUPL)
  "api.llama.fi", // DefiLlama (ETF flows, TVL, fees)
  "mempool.space", // mempool / frais on-chain
  "blockchain.info", // stats on-chain
  "www.deribit.com", // options / term structure (public, sans clé)
  "dapi.binance.com", // Binance COIN-M (term structure)
  "fapi.binance.com", // Binance USD-M (dérivés : funding, top trader L/S)
  "api.coingecko.com", // CoinGecko (treemap, catégories)
  "api.fiscaldata.treasury.gov", // US Treasury Fiscal Data (rendements souverains US)
  "home.treasury.gov", // US Treasury Daily Par Yield Curve CSV (courbe des taux souverains US)
  "data-api.ecb.europa.eu", // ECB SDMX (courbe zone euro + taux directeur BCE)
  "stats.bis.org", // BIS SDMX WS_CBPOL (taux directeurs banques centrales)
  "api.imf.org", // IMF SDMX 3.0 IRFCL (réserves d'or par pays)
  "publicreporting.cftc.gov", // CFTC Socrata SODA (rapport COT)
  "cdn.cboe.com", // CBOE delayed quotes (GEX/DEX indices actions)
  "data.sec.gov", // SEC EDGAR (submissions, XBRL companyfacts) — panneau FUND
  "www.sec.gov", // SEC EDGAR (company_tickers.json, résolution ticker→CIK) — panneau FUND
  "api.gdeltproject.org", // GDELT (recherche news ciblée par mot-clé) — NEWS enrichi
  "www.mof.go.jp", // MOF Japon — CSV JGB (courbe des taux souverains JP)
  "www.rba.gov.au", // RBA Australie — CSV F2 (courbe des taux souverains AU)
  "feeds.bloomberg.com", // RSS Bloomberg (news macro — verticale economics)
  "www.cnbc.com", // RSS CNBC (news macro — Economy ; UA navigateur requis, défaut du proxy suffit)
]);

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

/** TTL cache /extapi par défaut (RSS et calendriers sont lents). */
const EXTAPI_TTL_DEFAUT_MS = 120_000;
/** TTL cache réduit pour les dérivés Binance (données quasi temps réel). */
const EXTAPI_TTL_DERIVES_MS = 30_000;

/**
 * TTL cache (ms) d'un hôte /extapi : 30 s pour fapi/dapi.binance.com (dérivés),
 * 120 s sinon (RSS, calendriers, on-chain lents). Fonction PURE (testée).
 * Réutilise le stockage de cache.ts, mais calcule le TTL ICI car cache.ts (hors
 * périmètre de cet agent) ne connaît que les 4 préfixes historiques.
 */
export function ttlMsExtapi(hote: string): number {
  if (hote === "fapi.binance.com" || hote === "dapi.binance.com") return EXTAPI_TTL_DERIVES_MS;
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
export async function traiterExtapi(req: Request, url: URL): Promise<Response> {
  const cors = entetesCors(req);
  const parsed = parseExtapiChemin(url.pathname);
  if (!parsed || !EXTAPI_WHITELIST.has(parsed.hote)) {
    return new Response(
      JSON.stringify({ erreur: "hôte non autorisé", hote: parsed?.hote ?? null }),
      { status: 403, headers: { "content-type": "application/json; charset=utf-8", ...cors } },
    );
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ erreur: "méthode non autorisée (GET uniquement)" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8", allow: "GET", ...cors },
    });
  }

  const cheminEntrant = url.pathname + url.search;
  const cle = cleCache("GET", cheminEntrant);
  const hit = lireCache(cle);
  if (hit) {
    return new Response(hit.corps, {
      headers: { "content-type": hit.contentType, "x-axiomd-cache": "hit", ...cors },
    });
  }

  const urlAmont = `https://${parsed.hote}${parsed.reste}${url.search}`;
  let amont: Response;
  try {
    amont = await fetch(urlAmont, {
      method: "GET",
      headers: { "user-agent": userAgentPourHote(parsed.hote), accept: "*/*" },
      signal: AbortSignal.timeout(EXTAPI_TIMEOUT_MS),
    });
  } catch (err) {
    return reponseErreurAmont(err, cors);
  }
  const corps = new Uint8Array(await amont.arrayBuffer());
  const contentType = amont.headers.get("content-type") ?? "application/octet-stream";
  // On ne met en cache que les réponses valides (évite de figer une erreur transitoire).
  if (amont.ok) ecrireCache(cle, corps, contentType, ttlMsExtapi(parsed.hote));
  return new Response(corps, {
    status: amont.status,
    headers: { "content-type": contentType, "x-axiomd-cache": "miss", ...cors },
  });
}

/** Enregistre les routes de proxy à clé + le proxy générique /extapi dans le routeur. */
export function enregistrerProxy(routeur: Routeur, cles: ProxyKeys): void {
  for (const route of construireRoutesProxy(cles)) {
    routeur.enregistrerPrefixe(route.prefix, (req, url) => traiterProxy(req, url, route));
  }
  // Proxy générique /extapi (Phase 3) : hôtes whitelistés, GET only, cache TTL.
  routeur.enregistrerPrefixe("/extapi", (req, url) => traiterExtapi(req, url));
}
