import { EXTAPI_HOSTS } from "../shared/extapi-hosts.js";

export const PROXY_TIMEOUT_MS = 15_000;
export const PROXY_MAX_REDIRECTS = 5;
export const PROXY_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
export const PROXY_MAX_REQUEST_BYTES = 64 * 1024;

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

type RouteId =
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

const FIXED_ROUTES: Readonly<Record<Exclude<RouteId, "extapi">, FixedRoute>> = {
  fredapi: { host: "api.stlouisfed.org", methods: ["GET", "HEAD"] },
  coinalyzeapi: { host: "api.coinalyze.net", methods: ["GET", "HEAD"] },
  tdapi: { host: "api.twelvedata.com", methods: ["GET", "HEAD"] },
  mexcapi: { host: "api.mexc.com", methods: ["GET", "HEAD"] },
  sosoapi: { host: "openapi.sosovalue.com", methods: ["GET", "HEAD", "POST"] },
  bgapi: { host: "bitcoin-data.com", methods: ["GET", "HEAD"] },
  ethscanapi: { host: "api.etherscan.io", methods: ["GET", "HEAD"] },
};

const ROUTES = new Set<RouteId>(["extapi", ...Object.keys(FIXED_ROUTES) as Array<Exclude<RouteId, "extapi">>]);
const EXTAPI_WHITELIST = new Set(EXTAPI_HOSTS);
const FORBIDDEN_DESTINATIONS = new Set([
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
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SEC_USER_AGENT = "AxiomTerminal/1.0 (contact: axiom-terminal@example.com)";

export interface ProxyPlan {
  route: RouteId;
  target: URL;
  method: string;
  upstreamHeaders: Headers;
  allowedRedirectHosts: ReadonlySet<string>;
  privateResponse: boolean;
}

export function proxyMimeAllowed(contentType: string): boolean {
  const mime = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (
    [
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
    ].includes(mime)
  ) return true;
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
    (url.port === "" || url.port === "443") &&
    allowedHosts.has(url.hostname.toLowerCase())
  );
}

function routeFrom(value: string | null): RouteId {
  if (value === null || !ROUTES.has(value as RouteId)) {
    throw new ProxyPolicyError(404, "route proxy inconnue");
  }
  return value as RouteId;
}

function safePath(value: string | null): string {
  if (value === null || value.length > 8_192) throw new ProxyPolicyError(400, "chemin proxy invalide");
  let decoded = value;
  try {
    for (let pass = 0; pass < 2; pass += 1) {
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
  return decoded.replace(/^\/+/, "");
}

function appendOriginalQuery(source: URL, target: URL): void {
  for (const [key, value] of source.searchParams) {
    if (key !== "__axiom_route" && key !== "__axiom_path") target.searchParams.append(key, value);
  }
}

function bearerHeader(value: string | null): string | null {
  if (value === null || value.length > 512 || !/^Bearer\s+\S+$/i.test(value)) return null;
  return value;
}

export function planProxyRequest(requestUrl: string, method: string, headers: Headers): ProxyPlan {
  if (proxyNavigationForbidden(headers)) throw new ProxyPolicyError(403, "destination navigateur refusée");
  const source = new URL(requestUrl);
  const route = routeFrom(source.searchParams.get("__axiom_route"));
  const path = safePath(source.searchParams.get("__axiom_path"));
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
    if (!EXTAPI_WHITELIST.has(host)) throw new ProxyPolicyError(403, "hôte proxy non autorisé");
  } else {
    const fixed = FIXED_ROUTES[route];
    host = fixed.host;
    upstreamPath = path;
    methods = fixed.methods;
    allowedRedirectHosts = new Set<string>([host]);
  }
  if (!methods.includes(normalizedMethod)) {
    throw new ProxyPolicyError(405, "méthode proxy non autorisée", methods.join(", "));
  }

  const target = new URL(`https://${host}/${upstreamPath}`);
  if (!proxyRedirectAllowed(target, allowedRedirectHosts)) {
    throw new ProxyPolicyError(403, "destination proxy refusée");
  }
  appendOriginalQuery(source, target);

  const upstreamHeaders = new Headers({
    accept: headers.get("accept") ?? "*/*",
    "user-agent": host === "data.sec.gov" || host === "www.sec.gov" ? SEC_USER_AGENT : USER_AGENT,
  });
  if (route === "sosoapi") {
    const key = headers.get("x-soso-api-key");
    if (key !== null && key.length > 0 && key.length <= 512) upstreamHeaders.set("x-soso-api-key", key);
  }
  if (route === "bgapi") {
    const authorization = bearerHeader(headers.get("authorization"));
    if (authorization !== null) upstreamHeaders.set("authorization", authorization);
  }
  if (normalizedMethod === "POST") {
    const contentType = headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new ProxyPolicyError(415, "type de requête refusé");
    upstreamHeaders.set("content-type", "application/json");
  }

  const credentialQuery = [...target.searchParams.keys()].some((key) => {
    const normalized = key.toLowerCase();
    return normalized === "api_key" || normalized === "apikey";
  });
  return {
    route,
    target,
    method: normalizedMethod,
    upstreamHeaders,
    allowedRedirectHosts,
    privateResponse:
      credentialQuery || upstreamHeaders.has("x-soso-api-key") || upstreamHeaders.has("authorization"),
  };
}

export default {
  fetch: () =>
    Response.json(
      { erreur: "route inexistante" },
      { status: 404, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } },
    ),
};
