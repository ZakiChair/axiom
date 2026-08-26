import { EXTAPI_HOSTS } from "../shared/extapi-hosts.js";

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
  | "ethscanapi";

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
};

const ROUTE_IDS: readonly ProxyRouteId[] = [
  "extapi",
  "fredapi",
  "coinalyzeapi",
  "tdapi",
  "mexcapi",
  "sosoapi",
  "bgapi",
  "ethscanapi",
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

function routeAndPath(source: URL): { route: ProxyRouteId; path: string } {
  const publicRoute = proxyRouteFromPathname(source.pathname);
  if (publicRoute !== null) return { route: publicRoute.route, path: safePath(publicRoute.path) };
  const routeValues = source.searchParams.getAll(PROXY_ROUTE_PARAM);
  const pathValues = source.searchParams.getAll(PROXY_PATH_PARAM);
  const route = routeValues[0];
  if (routeValues.length !== 1 || route === undefined || !isRouteId(route)) {
    throw new ProxyPolicyError(404, "route proxy inconnue");
  }
  if (pathValues.length !== 1) throw new ProxyPolicyError(400, "chemin proxy invalide");
  return { route, path: safePath(pathValues[0] ?? null) };
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

export function proxyUpstreamHeaders(headers: Headers, destinationHost: string, method: string): Headers {
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
  const contentType = headers.get("content-type");
  if (method.toUpperCase() === "POST" && contentType !== null) upstream.set("content-type", contentType);
  return upstream;
}

export function proxyRequestHasCredential(query: URLSearchParams, headers: Headers): boolean {
  const credentialQuery = [...query.keys()].some((key) => {
    const normalized = key.toLowerCase();
    return normalized === "apikey" || normalized.includes("api_key");
  });
  return credentialQuery || headers.has("authorization") || headers.has("x-soso-api-key");
}

export function proxyCacheControl(method: string, query: URLSearchParams, headers: Headers): string {
  return method.toUpperCase() === "GET" && !proxyRequestHasCredential(query, headers)
    ? "public, max-age=60, s-maxage=60"
    : "private, no-store";
}

export function planProxyRequest(requestUrl: string, method: string, headers: Headers): ProxyPlan {
  if (proxyNavigationForbidden(headers)) throw new ProxyPolicyError(403, "destination navigateur refusée");
  const source = new URL(requestUrl);
  const { route, path } = routeAndPath(source);
  const normalizedMethod = method.toUpperCase();

  let host: string;
  let upstreamPath: string;
  let methods: readonly string[];
  let allowedRedirectHosts: ReadonlySet<string>;
  if (route === "extapi") {
    const slash = path.indexOf("/");
    host = (slash === -1 ? path : path.slice(0, slash)).toLowerCase();
    upstreamPath = slash === -1 ? "" : path.slice(slash + 1);
    methods = ["GET", "HEAD"];
    allowedRedirectHosts = EXTAPI_WHITELIST;
    if (!proxyExtapiHostAllowed(host)) throw new ProxyPolicyError(403, "hôte proxy non autorisé");
  } else {
    const fixed = FIXED_ROUTES[route];
    host = fixed.host;
    upstreamPath = path;
    methods = fixed.methods;
    allowedRedirectHosts = new Set([host]);
  }
  if (!methods.includes(normalizedMethod)) {
    throw new ProxyPolicyError(405, "méthode proxy non autorisée", methods.join(", "));
  }
  if (normalizedMethod === "POST") {
    const contentType = headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new ProxyPolicyError(415, "type de requête refusé");
  }

  const target = new URL(`https://${host}`);
  target.pathname = upstreamPath.length > 0 ? `/${upstreamPath}` : "/";
  const query = originalQuery(source);
  target.search = query.toString();
  if (!proxyRedirectAllowed(target, allowedRedirectHosts)) {
    throw new ProxyPolicyError(403, "destination proxy refusée");
  }

  const privateResponse = proxyRequestHasCredential(query, headers);
  return {
    route,
    target,
    method: normalizedMethod,
    upstreamHeaders: proxyUpstreamHeaders(headers, host, normalizedMethod),
    allowedRedirectHosts,
    privateResponse,
    cacheControl: proxyCacheControl(normalizedMethod, query, headers),
  };
}
