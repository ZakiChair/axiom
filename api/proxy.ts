import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  planProxyRequest,
  PROXY_MAX_REDIRECTS,
  PROXY_MAX_REQUEST_BYTES,
  PROXY_MAX_RESPONSE_BYTES,
  PROXY_TIMEOUT_MS,
  proxyMimeAllowed,
  proxyRedirectAllowed,
  ProxyPolicyError,
  type ProxyPlan,
} from "./proxy-policy.js";

export const config = { maxDuration: 30 };

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "sandbox; default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

export function publicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
    const [a, b, c] = octets as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 192 && b === 88 && c === 99) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const normalized = address.toLowerCase().split("%", 1)[0] ?? "";
    if (!normalized.startsWith("2") && !normalized.startsWith("3")) return false;
    if (
      normalized.startsWith("2001:db8:") ||
      normalized.startsWith("2001:2:") ||
      normalized.startsWith("2001:10:") ||
      normalized.startsWith("2001:20:") ||
      normalized.startsWith("2002:") ||
      normalized.startsWith("3ffe:")
    ) return false;
    return true;
  }
  return false;
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function validatePublicDestination(target: URL, signal: AbortSignal): Promise<void> {
  const host = target.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await withAbort(lookup(host, { all: true, verbatim: true }), signal)).map((entry) => entry.address);
  if (addresses.length === 0 || addresses.some((address) => !publicIpAddress(address))) {
    throw new ProxyPolicyError(403, "destination DNS non publique refusée");
  }
}

function jsonError(status: number, message: string, allow?: string): Response {
  return Response.json(
    { erreur: message },
    {
      status,
      headers: {
        ...(allow ? { allow } : {}),
        "cache-control": "private, no-store",
        ...SECURITY_HEADERS,
      },
    },
  );
}

async function requestBody(request: Request, plan: ProxyPlan): Promise<ArrayBuffer | undefined> {
  if (plan.method !== "POST") return undefined;
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > PROXY_MAX_REQUEST_BYTES) {
    throw new ProxyPolicyError(413, "corps de requête trop volumineux");
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > PROXY_MAX_REQUEST_BYTES) {
    throw new ProxyPolicyError(413, "corps de requête trop volumineux");
  }
  return body;
}

async function responseBody(response: Response): Promise<ArrayBuffer> {
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > PROXY_MAX_RESPONSE_BYTES) {
    throw new ProxyPolicyError(502, "réponse amont trop volumineuse");
  }
  const body = await response.arrayBuffer();
  if (body.byteLength > PROXY_MAX_RESPONSE_BYTES) {
    throw new ProxyPolicyError(502, "réponse amont trop volumineuse");
  }
  return body;
}

function redirectedPlan(plan: ProxyPlan, target: URL): ProxyPlan {
  const headers = new Headers(plan.upstreamHeaders);
  headers.set(
    "user-agent",
    target.hostname === "data.sec.gov" || target.hostname === "www.sec.gov"
      ? "AxiomTerminal/1.0 (contact: axiom-terminal@example.com)"
      : headers.get("user-agent") ?? "AxiomTerminal/1.0",
  );
  return { ...plan, target, upstreamHeaders: headers };
}

async function fetchUpstream(plan: ProxyPlan, body: ArrayBuffer | undefined, signal: AbortSignal): Promise<Response> {
  let current = plan;
  for (let redirects = 0; ; redirects += 1) {
    await validatePublicDestination(current.target, signal);
    const response = await fetch(current.target, {
      method: current.method,
      headers: current.upstreamHeaders,
      body,
      redirect: "manual",
      signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel().catch(() => undefined);
    if (current.method !== "GET" && current.method !== "HEAD") {
      throw new ProxyPolicyError(502, "redirection amont refusée pour cette méthode");
    }
    if (redirects >= PROXY_MAX_REDIRECTS) throw new ProxyPolicyError(502, "trop de redirections amont");
    const location = response.headers.get("location");
    if (location === null) throw new ProxyPolicyError(502, "redirection amont sans destination");
    let target: URL;
    try {
      target = new URL(location, current.target);
    } catch {
      throw new ProxyPolicyError(502, "redirection amont invalide");
    }
    if (!proxyRedirectAllowed(target, current.allowedRedirectHosts)) {
      throw new ProxyPolicyError(403, "hôte de redirection non autorisé");
    }
    current = redirectedPlan(current, target);
  }
}

async function handle(request: Request): Promise<Response> {
  let plan: ProxyPlan;
  try {
    plan = planProxyRequest(request.url, request.method, request.headers);
  } catch (error) {
    if (error instanceof ProxyPolicyError) return jsonError(error.status, error.message, error.allow);
    return jsonError(400, "requête proxy invalide");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const body = await requestBody(request, plan);
    const upstream = await fetchUpstream(plan, body, controller.signal);
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    if (!proxyMimeAllowed(contentType)) {
      await upstream.body?.cancel().catch(() => undefined);
      return jsonError(502, `type MIME amont refusé : ${contentType.split(";", 1)[0] ?? "inconnu"}`);
    }
    const responseHeaders = new Headers({
      "content-type": contentType,
      "cache-control":
        plan.method === "GET" && !plan.privateResponse
          ? "public, s-maxage=60, stale-while-revalidate=300"
          : "private, no-store",
      "x-axiom-proxy": "vercel",
      ...SECURITY_HEADERS,
    });
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter !== null) responseHeaders.set("retry-after", retryAfter);
    if (plan.method === "HEAD") {
      await upstream.body?.cancel().catch(() => undefined);
      return new Response(null, { status: upstream.status, headers: responseHeaders });
    }
    return new Response(await responseBody(upstream), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    if (error instanceof ProxyPolicyError) return jsonError(error.status, error.message, error.allow);
    if (controller.signal.aborted) return jsonError(504, "délai amont dépassé");
    return jsonError(502, "amont injoignable");
  } finally {
    clearTimeout(timer);
  }
}

export default { fetch: handle };
