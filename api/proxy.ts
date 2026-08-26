import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  planProxyRequest,
  PROXY_MAX_REDIRECTS,
  PROXY_MAX_REQUEST_BYTES,
  PROXY_MAX_RESPONSE_BYTES,
  PROXY_TIMEOUT_MS,
  proxyMimeAllowed,
  proxyRedirectTarget,
  ProxyPolicyError,
  proxyUpstreamHeaders,
  type ProxyPlan,
} from "./_policy.js";

export const config = { maxDuration: 30 };

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "sandbox; default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const BODYLESS_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

function ipv4Octets(address: string): [number, number, number, number] | null {
  if (isIP(address) !== 4) return null;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return null;
  }
  return [parts[0] as number, parts[1] as number, parts[2] as number, parts[3] as number];
}

function publicIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  if (octets === null) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6Value(rawAddress: string): bigint | null {
  let address = rawAddress.replace(/^\[|\]$/g, "").toLowerCase();
  if (address.includes("%")) return null;
  const lastColon = address.lastIndexOf(":");
  const tail = lastColon === -1 ? address : address.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = ipv4Octets(tail);
    if (octets === null) return null;
    const [a, b, c, d] = octets;
    address =
      address.slice(0, lastColon + 1) +
      ((a << 8) | b).toString(16) +
      ":" +
      ((c << 8) | d).toString(16);
  }
  const sides = address.split("::");
  if (sides.length > 2) return null;
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides.length === 2 && sides[1] ? sides[1].split(":") : [];
  if (sides.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < (sides.length === 2 ? 1 : 0)) return null;
  const groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(parseInt(group, 16));
  return value;
}

function ipv6Prefix(address: bigint, base: bigint, length: number): boolean {
  const shift = BigInt(128 - length);
  return address >> shift === base >> shift;
}

const IPV6_MAPPED = ipv6Value("::ffff:0:0") as bigint;
const IPV6_NAT64 = ipv6Value("64:ff9b::") as bigint;
const IPV6_DOCUMENTATION = ipv6Value("2001:db8::") as bigint;
const IPV6_TEREDO = ipv6Value("2001::") as bigint;
const IPV6_BENCHMARK = ipv6Value("2001:2::") as bigint;
const IPV6_ORCHID = ipv6Value("2001:10::") as bigint;
const IPV6_ORCHID_V2 = ipv6Value("2001:20::") as bigint;
const IPV6_6TO4 = ipv6Value("2002::") as bigint;
const IPV6_6BONE = ipv6Value("3ffe::") as bigint;

function publicIpv6(address: string): boolean {
  const value = ipv6Value(address);
  if (value === null || value === 0n || value === 1n) return false;
  if (ipv6Prefix(value, IPV6_MAPPED, 96) || ipv6Prefix(value, IPV6_NAT64, 96)) {
    const ipv4 = Number(value & 0xffff_ffffn);
    return publicIpv4(
      `${(ipv4 >>> 24) & 255}.${(ipv4 >>> 16) & 255}.${(ipv4 >>> 8) & 255}.${ipv4 & 255}`,
    );
  }
  if (value >> 125n !== 1n) return false;
  if (ipv6Prefix(value, IPV6_DOCUMENTATION, 32)) return false;
  if (ipv6Prefix(value, IPV6_TEREDO, 32)) return false;
  if (ipv6Prefix(value, IPV6_BENCHMARK, 48)) return false;
  if (ipv6Prefix(value, IPV6_ORCHID, 28)) return false;
  if (ipv6Prefix(value, IPV6_ORCHID_V2, 28)) return false;
  if (ipv6Prefix(value, IPV6_6TO4, 16)) return false;
  if (ipv6Prefix(value, IPV6_6BONE, 16)) return false;
  return true;
}

export function publicIpAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  return family === 4 ? publicIpv4(normalized) : family === 6 ? publicIpv6(normalized) : false;
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
    throw new ProxyPolicyError(502, "destination DNS non publique refusée");
  }
}

function jsonError(status: number, message: string, allow?: string): Response {
  return Response.json(
    { erreur: message, statut: status },
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

function announcedLength(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

async function requestBody(
  request: Request,
  plan: ProxyPlan,
  signal: AbortSignal,
): Promise<ArrayBuffer | undefined> {
  if (plan.method !== "POST") return undefined;
  const announced = announcedLength(request.headers);
  if (announced !== null && announced > PROXY_MAX_REQUEST_BYTES) {
    throw new ProxyPolicyError(413, "corps de requête trop volumineux");
  }
  const body = await withAbort(request.arrayBuffer(), signal);
  if (body.byteLength > PROXY_MAX_REQUEST_BYTES) {
    throw new ProxyPolicyError(413, "corps de requête trop volumineux");
  }
  return body;
}

async function responseBody(
  response: Response,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const announced = announcedLength(response.headers);
  if (announced !== null && announced > PROXY_MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProxyPolicyError(502, "réponse amont trop volumineuse");
  }
  if (response.body === null) return new Uint8Array(new ArrayBuffer(0));
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > PROXY_MAX_RESPONSE_BYTES) {
        await reader.cancel("réponse amont trop volumineuse").catch(() => undefined);
        throw new ProxyPolicyError(502, "réponse amont trop volumineuse");
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function redirectedMethod(status: number, method: string): string {
  if (status === 303 && method !== "HEAD") return "GET";
  if ((status === 301 || status === 302) && method === "POST") return "GET";
  return method;
}

async function fetchUpstream(
  plan: ProxyPlan,
  requestHeaders: Headers,
  initialBody: ArrayBuffer | undefined,
  signal: AbortSignal,
): Promise<Response> {
  let target = plan.target;
  let method = plan.method;
  let body = initialBody;
  let redirects = 0;
  for (;;) {
    await validatePublicDestination(target, signal);
    const response = await fetch(target, {
      method,
      headers: proxyUpstreamHeaders(requestHeaders, target.hostname, method),
      body,
      redirect: "manual",
      signal,
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    await response.body?.cancel().catch(() => undefined);
    if (redirects >= PROXY_MAX_REDIRECTS) throw new ProxyPolicyError(502, "trop de redirections amont");
    const location = response.headers.get("location");
    if (location === null) throw new ProxyPolicyError(502, "redirection amont sans destination");
    const redirected = proxyRedirectTarget(location, target, plan.allowedRedirectHosts);
    if (redirected === null) throw new ProxyPolicyError(502, "destination de redirection refusée");
    redirects += 1;
    method = redirectedMethod(response.status, method);
    if (method === "GET" || method === "HEAD") body = undefined;
    target = redirected;
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
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("délai amont dépassé"));
  }, PROXY_TIMEOUT_MS);
  const abortFromClient = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) abortFromClient();
  else request.signal.addEventListener("abort", abortFromClient, { once: true });

  try {
    const body = await requestBody(request, plan, controller.signal);
    const upstream = await fetchUpstream(plan, request.headers, body, controller.signal);
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    if (!proxyMimeAllowed(contentType)) {
      await upstream.body?.cancel().catch(() => undefined);
      return jsonError(502, `type MIME amont refusé : ${contentType.split(";", 1)[0] ?? "inconnu"}`);
    }
    const responseHeaders = new Headers({
      "content-type": contentType,
      "cache-control": plan.cacheControl,
      "x-axiom-proxy": "vercel",
      ...SECURITY_HEADERS,
    });
    if (plan.method === "HEAD" || BODYLESS_STATUSES.has(upstream.status)) {
      await upstream.body?.cancel().catch(() => undefined);
      return new Response(null, { status: upstream.status, headers: responseHeaders });
    }
    const bodyResponse = await responseBody(upstream, controller.signal);
    return new Response(bodyResponse, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    if (error instanceof ProxyPolicyError) return jsonError(error.status, error.message, error.allow);
    if (timedOut) return jsonError(504, "délai amont dépassé");
    return jsonError(502, "amont injoignable");
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortFromClient);
  }
}

export default { fetch: handle };
