import { EXTAPI_HOSTS, extapiCheminAutorise } from "../shared/extapi-hosts.js";
import { NBS_HOST, NBS_CHEMIN } from "../shared/nbs-series.js";
import { DEFILLAMA_PRO_HEADER, DEFILLAMA_PRO_HOST, cheminDefillamaAmont, cleDefillamaValide } from "../shared/defillama-proxy.js";
import { CRYPTOQUANT_HOST, cheminCryptoQuantAmont, cleCryptoQuantValide } from "../shared/cryptoquant-proxy.js";
import { PROVIDER_ENV, PROVIDER_IDS, type ProviderId, type ProviderCapabilities } from "../shared/server-credentials.js";

export const PROXY_TIMEOUT_MS = 15_000;
export const PROXY_MAX_REDIRECTS = 5;
export const PROXY_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
export const PROXY_MAX_REQUEST_BYTES = 64 * 1024;
export const PROXY_ROUTE_PARAM = "__axiom_route";
export const PROXY_PATH_PARAM = "__axiom_path";

export class ProxyPolicyError extends Error {
  readonly status: number;
  readonly allow?: string;

  constructor(status: number, message: string, allow?: string) {
    super(message);
    this.name = "ProxyPolicyError";
    this.status = status;
    this.allow = allow;
  }
}

export type ProxyRouteId =
  | "extapi"
  | "fredapi"
  | "coinalyzeapi"
  | "tdapi"
  | "mexcapi"
  | "sosoapi"
  | "bgapi"
  | "ethscanapi"
  | "ccdataapi"
  | "defillamapro"
  | "cqapi"
  | "finnhubapi"
  | "coingeckoapi";

interface FixedRoute {
  host: string;
  methods: readonly string[];
}

const FIXED_ROUTES: Readonly<Record<Exclude<ProxyRouteId, "extapi">, FixedRoute>> = {
  fredapi: { host: "api.stlouisfed.org", methods: ["GET", "HEAD"] },
  coinalyzeapi: { host: "api.coinalyze.net", methods: ["GET", "HEAD"] },
  tdapi: { host: "api.twelvedata.com", methods: ["GET", "HEAD"] },
  mexcapi: { host: "api.mexc.com", methods: ["GET", "HEAD"] },
  sosoapi: { host: "openapi.sosovalue.com", methods: ["GET", "HEAD", "POST"] },
  bgapi: { host: "bitcoin-data.com", methods: ["GET", "HEAD"] },
  ethscanapi: { host: "api.etherscan.io", methods: ["GET", "HEAD"] },
  ccdataapi: { host: "min-api.cryptocompare.com", methods: ["GET", "HEAD"] },
  defillamapro: { host: DEFILLAMA_PRO_HOST, methods: ["GET"] },
  // CryptoQuant BASIC (licence personnelle) : lecture seule, liste fermée dans planProxyRequest.
  cqapi: { host: CRYPTOQUANT_HOST, methods: ["GET"] },
  finnhubapi: { host: "finnhub.io", methods: ["GET"] },
  coingeckoapi: { host: "api.coingecko.com", methods: ["GET"] },
};

// Liste NON vérifiée par le typage : toute nouvelle route doit y figurer (sinon 404 silencieux).
const ROUTE_IDS: readonly ProxyRouteId[] = [
  "extapi",
  "fredapi",
  "coinalyzeapi",
  "tdapi",
  "mexcapi",
  "sosoapi",
  "bgapi",
  "ethscanapi",
  "ccdataapi",
  "defillamapro",
  "cqapi",
  "finnhubapi",
  "coingeckoapi",
];
const ROUTES = new Set<ProxyRouteId>(ROUTE_IDS);
const EXTAPI_WHITELIST: ReadonlySet<string> = new Set(EXTAPI_HOSTS);
const FORBIDDEN_DESTINATIONS: ReadonlySet<string> = new Set([
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
const EXACT_ALLOWED_MIMES: ReadonlySet<string> = new Set([
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
  "application/x-rss+xml",
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
  "application/x-gzip",
]);
const EXACT_FORBIDDEN_MIMES: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/svg+xml",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
  "text/css",
  "application/pdf",
]);
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SEC_USER_AGENT = "AxiomTerminal/1.0 (contact: axiom-terminal@example.com)";

export interface ProxyPlan {
  route: ProxyRouteId;
  target: URL;
  method: string;
  upstreamHeaders: Headers;
  allowedRedirectHosts: ReadonlySet<string>;
  privateResponse: boolean;
  cacheControl: string;
  maxRedirects?: number;
  /** Secrets effectifs à expurger si l'amont les réimprime dans une réponse. */
  secretValues: readonly string[];
}

export function proxyExtapiHostAllowed(host: string): boolean {
  return EXTAPI_WHITELIST.has(host.toLowerCase());
}

export function proxyMimeAllowed(contentType: string): boolean {
  const mime = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (EXACT_FORBIDDEN_MIMES.has(mime)) return false;
  if (EXACT_ALLOWED_MIMES.has(mime)) return true;
  return /^application\/[a-z0-9!#$&^_.+-]+\+(?:json|xml|csv)$/.test(mime);
}

export function proxyNavigationForbidden(headers: Headers): boolean {
  const destination = (headers.get("sec-fetch-dest") ?? "").trim().toLowerCase();
  const mode = (headers.get("sec-fetch-mode") ?? "").trim().toLowerCase();
  const site = (headers.get("sec-fetch-site") ?? "").trim().toLowerCase();
  return mode === "navigate" || site === "cross-site" || FORBIDDEN_DESTINATIONS.has(destination);
}

export function proxyRedirectAllowed(url: URL, allowedHosts: ReadonlySet<string>): boolean {
  if (!extapiCheminAutorise(url.hostname, url.pathname)) return false;
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    allowedHosts.has(url.hostname.toLowerCase())
  );
}

function explicitAuthorityPort(location: string): boolean {
  const match = location.trim().match(/^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]*)/i);
  if (!match?.[1]) return false;
  const authority = match[1].slice(match[1].lastIndexOf("@") + 1);
  if (authority.startsWith("[")) {
    const bracket = authority.indexOf("]");
    return bracket !== -1 && authority.slice(bracket + 1).startsWith(":");
  }
  return authority.includes(":");
}

export function proxyRedirectTarget(
  location: string,
  current: URL,
  allowedHosts: ReadonlySet<string>,
): URL | null {
  if (location.length > 8_192 || location.includes("\\") || explicitAuthorityPort(location)) return null;
  try {
    const target = new URL(location, current);
    return proxyRedirectAllowed(target, allowedHosts) ? target : null;
  } catch {
    return null;
  }
}

function isRouteId(value: string): value is ProxyRouteId {
  return ROUTES.has(value as ProxyRouteId);
}

function safePath(value: string | null): string {
  if (value === null || value.length > 8_192) throw new ProxyPolicyError(400, "chemin proxy invalide");
  const path = value.replace(/^\/+/, "");
  let decoded = path;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    throw new ProxyPolicyError(400, "encodage du chemin proxy invalide");
  }
  if (
    decoded.includes("\\") ||
    decoded.includes("#") ||
    decoded.includes("\0") ||
    decoded.split("/").some((segment) => segment === "..")
  ) throw new ProxyPolicyError(400, "chemin proxy invalide");
  return path;
}

export function proxyRouteFromPathname(pathname: string): { route: ProxyRouteId; path: string } | null {
  for (const route of ROUTE_IDS) {
    const prefix = `/${route}`;
    if (pathname === prefix) return { route, path: "" };
    if (pathname.startsWith(`${prefix}/`)) return { route, path: pathname.slice(prefix.length + 1) };
  }
  return null;
}

/**
 * `path` : chemin validé, barres initiales retirées. `rawPath` : même chemin AVANT ce retrait,
 * pour les routes à liste fermée qui doivent refuser `/<route>//…` comme le daemon et Vite.
 */
function routeAndPath(source: URL): { route: ProxyRouteId; path: string; rawPath: string } {
  const publicRoute = proxyRouteFromPathname(source.pathname);
  if (publicRoute !== null) {
    return { route: publicRoute.route, path: safePath(publicRoute.path), rawPath: publicRoute.path };
  }
  const routeValues = source.searchParams.getAll(PROXY_ROUTE_PARAM);
  const pathValues = source.searchParams.getAll(PROXY_PATH_PARAM);
  const route = routeValues[0];
  if (routeValues.length !== 1 || route === undefined || !isRouteId(route)) {
    throw new ProxyPolicyError(404, "route proxy inconnue");
  }
  if (pathValues.length !== 1) throw new ProxyPolicyError(400, "chemin proxy invalide");
  const rawPath = pathValues[0] ?? null;
  return { route, path: safePath(rawPath), rawPath: rawPath ?? "" };
}

function originalQuery(source: URL): URLSearchParams {
  const metadataPaths = source.searchParams.getAll(PROXY_PATH_PARAM);
  const metadataPath = metadataPaths.length === 1 ? (metadataPaths[0] ?? "").replace(/^\/+/, "") : null;
  const query = new URLSearchParams();
  let syntheticPathRemoved = false;
  for (const [key, value] of source.searchParams) {
    if (key === PROXY_ROUTE_PARAM || key === PROXY_PATH_PARAM) continue;
    if (
      key === "path" &&
      metadataPath !== null &&
      !syntheticPathRemoved &&
      value.replace(/^\/+|\/$/g, "") === metadataPath.replace(/\/$/, "")
    ) {
      syntheticPathRemoved = true;
      continue;
    }
    query.append(key, value);
  }
  return query;
}

/** Environnement serveur injecté ; jamais importé par le navigateur. */
export type ProxyEnv = Readonly<Record<string, string | undefined>>;

export function serverCredential(provider: ProviderId, env: ProxyEnv): string | null {
  const value = env[PROVIDER_ENV[provider]]?.trim() ?? "";
  if (!/^[A-Za-z0-9._~+/=-]{1,480}$/.test(value)) return null;
  if (provider === "defillama" && !cleDefillamaValide(value)) return null;
  return value;
}

export function configuredProviders(env: ProxyEnv): ProviderCapabilities {
  return Object.fromEntries(PROVIDER_IDS.map((id) => [id, serverCredential(id, env) !== null])) as ProviderCapabilities;
}

const ROUTE_PROVIDER: Partial<Record<ProxyRouteId, ProviderId>> = {
  fredapi: "fred", coinalyzeapi: "coinalyze", tdapi: "twelvedata", sosoapi: "sosovalue",
  ethscanapi: "etherscan", bgapi: "bgeometrics", cqapi: "cryptoquant", ccdataapi: "ccdata",
  defillamapro: "defillama", finnhubapi: "finnhub", coingeckoapi: "coingecko",
};
const QUERY_CREDENTIAL: Partial<Record<ProxyRouteId, string>> = {
  fredapi: "api_key", coinalyzeapi: "api_key", tdapi: "apikey", ethscanapi: "apikey", finnhubapi: "token",
};
const HEADER_CREDENTIAL: Partial<Record<ProxyRouteId, readonly [string, string]>> = {
  bgapi: ["authorization", "Bearer "], cqapi: ["authorization", "Bearer "],
  ccdataapi: ["authorization", "Apikey "], sosoapi: ["x-soso-api-key", ""],
  defillamapro: [DEFILLAMA_PRO_HEADER, ""], coingeckoapi: ["x-cg-demo-api-key", ""],
};

/** Les clés du propriétaire ne donnent accès qu'aux lectures consommées par AXIOM. */
function serverPathAllowed(route: ProxyRouteId, path: string, query: URLSearchParams): boolean {
  switch (route) {
    case "fredapi": return ["fred/series/observations", "fred/release/dates", "fred/releases/dates"].includes(path);
    case "coinalyzeapi": return /^v1\/(?:open-interest|funding-rate|predicted-funding-rate|open-interest-history|funding-rate-history|long-short-ratio-history|liquidation-history|future-markets)$/.test(path);
    case "tdapi": return path === "time_series" || path === "quote";
    case "sosoapi": return ["openapi/v2/etf/currentEtfDataMetrics", "openapi/v1/etfs/summary-history"].includes(path);
    case "ethscanapi": return path === "v2/api" && query.get("chainid") === "1" &&
      ((query.get("module") === "stats" && ["ethsupply", "nodecount"].includes(query.get("action") ?? "")) ||
       (query.get("module") === "gastracker" && query.get("action") === "gasoracle"));
    case "bgapi": return /^v1\/(?:mvrv-zscore|sopr|nupl|puell-multiple|reserve-risk|realized-price|asopr|sth-sopr|lth-sopr|rhodl-ratio|cvdd|balanced-price|bitcoin-dominance|etf-flow-btc|realized-price-sth|realized-price-lth|realized-cap|supply-profit|supply-loss|exchange-netflow-btc|exchange-reserve-btc|sth-mvrv|lth-mvrv|nrpl-usd|vdd-multiple|aviv|open-interest-futures)(?:\/last)?$/.test(path);
    case "ccdataapi": return path === "data/overview/v1/historical/marketcap/all-assets/days";
    case "finnhubapi": return ["stock/profile2", "calendar/earnings", "news"].includes(path);
    case "coingeckoapi": return ["global", "coins/markets", "coins/categories", "companies/public_treasury/bitcoin"].includes(path) || /^coins\/[a-z0-9][a-z0-9-]{0,99}\/market_chart(?:\/range)?$/.test(path);
    case "defillamapro": case "cqapi": return true; // Leur politique dédiée valide aussi la query.
    default: return false;
  }
}

export function proxyUpstreamHeaders(
  headers: Headers,
  destinationHost: string,
  method: string,
  _env: ProxyEnv = {},
): Headers {
  const host = destinationHost.toLowerCase();
  const upstream = new Headers({
    accept: headers.get("accept") ?? "*/*",
    "user-agent": host === "data.sec.gov" || host === "www.sec.gov" ? SEC_USER_AGENT : USER_AGENT,
  });
  const sosoKey = headers.get("x-soso-api-key");
  if (host === "openapi.sosovalue.com" && sosoKey !== null && sosoKey.length > 0 && sosoKey.length <= 512) {
    upstream.set("x-soso-api-key", sosoKey);
  }
  const authorization = headers.get("authorization");
  if (
    host === "bitcoin-data.com" &&
    authorization !== null &&
    authorization.length <= 512 &&
    /^Bearer\s+\S+$/i.test(authorization)
  ) {
    upstream.set("authorization", authorization);
  }
  if (
    host === "min-api.cryptocompare.com" &&
    authorization !== null &&
    authorization.length <= 512 &&
    /^Apikey\s+\S+$/i.test(authorization)
  ) {
    upstream.set("authorization", authorization);
  }
  if (host === CRYPTOQUANT_HOST && cleCryptoQuantValide(authorization)) {
    upstream.set("authorization", authorization);
  }
  const cgKey = headers.get("x-cg-demo-api-key");
  if (host === "api.coingecko.com" && cgKey !== null && cgKey.length > 0 && cgKey.length <= 512) upstream.set("x-cg-demo-api-key", cgKey);
  const contentType = headers.get("content-type");
  if (method.toUpperCase() === "POST" && contentType !== null) upstream.set("content-type", contentType);
  return upstream;
}

export function proxyRequestHasCredential(query: URLSearchParams, headers: Headers): boolean {
  const credentialQuery = [...query.keys()].some((key) => {
    const normalized = key.toLowerCase();
    return normalized === "apikey" || normalized === "token" || normalized.includes("api_key");
  });
  return credentialQuery || headers.has("authorization") || headers.has("x-soso-api-key") || headers.has(DEFILLAMA_PRO_HEADER) || headers.has("x-cg-demo-api-key");
}

export function proxyCacheControl(method: string, query: URLSearchParams, headers: Headers): string {
  return method.toUpperCase() === "GET" && !proxyRequestHasCredential(query, headers)
    ? "public, max-age=60, s-maxage=60"
    : "private, no-store";
}

export function planProxyRequest(requestUrl: string, method: string, headers: Headers, env: ProxyEnv = process.env): ProxyPlan {
  if (proxyNavigationForbidden(headers)) throw new ProxyPolicyError(403, "destination navigateur refusée");
  const source = new URL(requestUrl);
  const { route, path, rawPath } = routeAndPath(source);
  const normalizedMethod = method.toUpperCase();
  const effectiveHeaders = new Headers(headers);
  const provider = ROUTE_PROVIDER[route];
  const serverKey = provider === undefined ? null : serverCredential(provider, env);
  const queryKey = QUERY_CREDENTIAL[route];
  const headerKey = HEADER_CREDENTIAL[route];
  let serverKeyUsed = false;
  if (serverKey !== null && headerKey !== undefined && !headers.has(headerKey[0]) &&
      !(route === "coingeckoapi" && source.searchParams.has("x_cg_demo_api_key"))) {
    effectiveHeaders.set(headerKey[0], `${headerKey[1]}${serverKey}`);
    serverKeyUsed = true;
  }

  let host: string;
  let upstreamPath: string;
  let methods: readonly string[];
  let allowedRedirectHosts: ReadonlySet<string>;
  if (route === "extapi") {
    const slash = path.indexOf("/");
    host = (slash === -1 ? path : path.slice(0, slash)).toLowerCase();
    upstreamPath = slash === -1 ? "" : path.slice(slash + 1);
    methods = host === NBS_HOST ? ["POST"] : ["GET", "HEAD"];
    allowedRedirectHosts = host === NBS_HOST ? new Set([NBS_HOST]) : EXTAPI_WHITELIST;
    if (!proxyExtapiHostAllowed(host)) throw new ProxyPolicyError(403, "hôte proxy non autorisé");
  } else {
    const fixed = FIXED_ROUTES[route];
    host = fixed.host;
    upstreamPath = path;
    methods = fixed.methods;
    allowedRedirectHosts = new Set([host]);
    if (route === "finnhubapi" || route === "coingeckoapi") {
      if (!serverPathAllowed(route, rawPath, originalQuery(source))) throw new ProxyPolicyError(404, "chemin fournisseur refusé");
      upstreamPath = `${route === "finnhubapi" ? "api/v1" : "api/v3"}/${path}`;
    }
    if (route === "defillamapro") {
      const key = effectiveHeaders.get(DEFILLAMA_PRO_HEADER);
      if (!cleDefillamaValide(key)) throw new ProxyPolicyError(401, "clé DefiLlama Pro absente ou invalide");
      const localQuery = originalQuery(source).toString();
      const allowedPath = cheminDefillamaAmont(`/defillamapro/${path}`, localQuery ? `?${localQuery}` : "");
      if (allowedPath === null) throw new ProxyPolicyError(404, "chemin DefiLlama Pro refusé");
      const [pathname, search = ""] = allowedPath.split("?", 2);
      upstreamPath = `${encodeURIComponent(key)}${pathname}`;
      source.search = search;
    }
    if (route === "cqapi") {
      // Méthode, credential effectif puis liste fermée, avant tout appel amont.
      if (!methods.includes(normalizedMethod)) {
        throw new ProxyPolicyError(405, "méthode proxy non autorisée", methods.join(", "));
      }
      if (!cleCryptoQuantValide(effectiveHeaders.get("authorization"))) {
        throw new ProxyPolicyError(401, "clé CryptoQuant absente ou invalide");
      }
      const localQuery = originalQuery(source).toString();
      // Chemin BRUT (barres initiales conservées) : `/cqapi//…` est refusé en 404, comme le
      // daemon et Vite qui comparent le pathname tel quel ; `safePath` l'a déjà validé.
      const allowedPath = cheminCryptoQuantAmont(`/cqapi/${rawPath}`, localQuery ? `?${localQuery}` : "");
      if (allowedPath === null) throw new ProxyPolicyError(404, "chemin CryptoQuant refusé");
      const [pathname = "", search = ""] = allowedPath.split("?", 2);
      // `target.pathname` est reconstruit plus bas avec un « / » initial.
      upstreamPath = pathname.replace(/^\/+/, "");
      // La query normalisée remplace la query entrante (relue par originalQuery ci-dessous).
      source.search = search;
    }
  }
  if (!methods.includes(normalizedMethod)) {
    throw new ProxyPolicyError(405, "méthode proxy non autorisée", methods.join(", "));
  }
  if (normalizedMethod === "POST") {
    const nbs = route === "extapi" && host === NBS_HOST && `/${upstreamPath}` === NBS_CHEMIN;
    if (!nbs && (route !== "sosoapi" || upstreamPath !== "openapi/v2/etf/currentEtfDataMetrics")) {
      throw new ProxyPolicyError(405, "POST non autorisé sur ce chemin", "GET, HEAD");
    }
    const contentType = headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new ProxyPolicyError(415, "type de requête refusé");
  }

  const target = new URL(`https://${host}`);
  target.pathname = upstreamPath.length > 0 ? `/${upstreamPath}` : "/";
  const query = originalQuery(source);
  if (serverKey !== null && queryKey !== undefined && !query.has(queryKey)) {
    query.set(queryKey, serverKey);
    serverKeyUsed = true;
  }
  if (serverKeyUsed && [...query.keys()].some((key) => query.getAll(key).length > 1)) throw new ProxyPolicyError(400, "paramètre fournisseur en double refusé");
  if (serverKeyUsed && !serverPathAllowed(route, rawPath, query)) throw new ProxyPolicyError(404, "chemin fournisseur refusé");
  for (const key of ["api_key", "apikey", "token", "x_cg_demo_api_key"]) {
    if (query.getAll(key).length > 1) throw new ProxyPolicyError(400, "credential en double refusé");
  }
  if (host === NBS_HOST && query.size > 0) throw new ProxyPolicyError(400, "paramètres NBS refusés");
  target.search = query.toString();
  if (route !== "defillamapro" && !proxyRedirectAllowed(target, allowedRedirectHosts)) {
    throw new ProxyPolicyError(403, "destination proxy refusée");
  }

  const upstreamHeaders = proxyUpstreamHeaders(effectiveHeaders, host, normalizedMethod);
  const privateResponse = proxyRequestHasCredential(query, effectiveHeaders);
  const secretValues = new Set<string>();
  for (const [name, value] of query) if (name === "apikey" || name === "token" || name.toLowerCase().includes("api_key")) secretValues.add(value);
  for (const name of ["authorization", "x-soso-api-key", "x-cg-demo-api-key", DEFILLAMA_PRO_HEADER]) {
    const value = effectiveHeaders.get(name);
    if (value) secretValues.add(name === "authorization" ? value.replace(/^\S+\s+/, "") : value);
  }
  return {
    route,
    target,
    method: normalizedMethod,
    upstreamHeaders,
    allowedRedirectHosts,
    privateResponse,
    cacheControl: proxyCacheControl(normalizedMethod, query, effectiveHeaders),
    maxRedirects: privateResponse || route === "defillamapro" || route === "cqapi" ? 0 : undefined,
    secretValues: [...secretValues].filter(Boolean),
  };
}
