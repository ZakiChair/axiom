import { describe, expect, test } from "bun:test";
import proxyFunction, { publicIpAddress } from "../../../api/proxy";
import {
  planProxyRequest,
  proxyCacheControl,
  proxyExtapiHostAllowed,
  ProxyPolicyError,
  proxyMimeAllowed,
  proxyNavigationForbidden,
  proxyRedirectAllowed,
  proxyRedirectTarget,
} from "../../../api/_policy";

function url(route: string, path: string, query = ""): string {
  const params = new URLSearchParams({ __axiom_route: route, __axiom_path: path });
  params.append("path", path);
  if (query) {
    for (const [key, value] of new URLSearchParams(query)) params.append(key, value);
  }
  return `https://axiom.test/api/proxy?${params}`;
}

function policyError(run: () => unknown): ProxyPolicyError {
  try {
    run();
  } catch (error) {
    if (error instanceof ProxyPolicyError) return error;
    throw error;
  }
  throw new Error("erreur de politique attendue");
}

describe("proxy Vercel", () => {
  test("utilise une seule fonction Web Standard et des utilitaires non exposés", async () => {
    expect(typeof proxyFunction.fetch).toBe("function");
    const policySource = await Bun.file(new URL("../../../api/_policy.ts", import.meta.url)).text();
    const handlerSource = await Bun.file(new URL("../../../api/proxy.ts", import.meta.url)).text();
    expect(policySource).not.toMatch(/export\s+default/);
    expect(handlerSource).toContain("export default { fetch: handle }");
    expect(`${policySource}\n${handlerSource}`).not.toMatch(/\b(?:process|Bun|Deno)\.env\b/);
  });

  test("place les huit rewrites avant le fallback SPA", async () => {
    const config = (await Bun.file(new URL("../../../vercel.json", import.meta.url)).json()) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    const required = [
      "/extapi/:path*",
      "/fredapi/:path*",
      "/coinalyzeapi/:path*",
      "/tdapi/:path*",
      "/mexcapi/:path*",
      "/sosoapi/:path*",
      "/bgapi/:path*",
      "/ethscanapi/:path*",
    ];
    const fallbackIndex = config.rewrites.findIndex((rewrite) => rewrite.destination === "/index.html");
    const proxyRewrites = config.rewrites.slice(0, fallbackIndex);
    expect(fallbackIndex).toBeGreaterThan(0);
    expect(required.every((source) => proxyRewrites.some((rewrite) => rewrite.source === source))).toBe(true);
    expect(required.every((source) => proxyRewrites.some((rewrite) => rewrite.source === `${source}/`))).toBe(true);
    expect(proxyRewrites.every((rewrite) => rewrite.destination.startsWith("/api/proxy?"))).toBe(true);
    expect(config.rewrites[fallbackIndex]).toEqual({ source: "/(.*)", destination: "/index.html" });
  });

  test("réécrit extapi vers la whitelist partagée et conserve path et query", () => {
    expect(proxyExtapiHostAllowed("api.alternative.me")).toBe(true);
    expect(proxyExtapiHostAllowed("example.invalid")).toBe(false);
    const plan = planProxyRequest(
      url("extapi", "api.alternative.me/fng/", "limit=90&format=json&path=legitime"),
      "GET",
      new Headers(),
    );
    expect(plan.target.toString()).toBe(
      "https://api.alternative.me/fng/?limit=90&format=json&path=legitime",
    );
    expect(plan.privateResponse).toBe(false);
  });

  test("refuse un hôte extapi hors whitelist", () => {
    const error = policyError(() =>
      planProxyRequest(url("extapi", "example.invalid/data"), "GET", new Headers()),
    );
    expect(error.status).toBe(403);
  });

  test("réécrit une route publique originale ou réécrite sans changer son autorité", () => {
    const publicPlan = planProxyRequest(
      "https://axiom.test/fredapi/fred/series/observations?series_id=DFF&api_key=personnelle",
      "GET",
      new Headers(),
    );
    const rewrittenPlan = planProxyRequest(
      url("fredapi", "fred/series/observations", "series_id=DFF&api_key=personnelle"),
      "GET",
      new Headers(),
    );
    expect(publicPlan.target.toString()).toBe(rewrittenPlan.target.toString());
    expect(publicPlan.target.hostname).toBe("api.stlouisfed.org");
    expect(publicPlan.target.pathname).toBe("/fred/series/observations");
    expect(publicPlan.target.searchParams.get("api_key")).toBe("personnelle");
    expect(publicPlan.privateResponse).toBe(true);
  });

  test("fixe l'autorité des sept routes spécifiques", () => {
    for (const [route, host] of [
      ["fredapi", "api.stlouisfed.org"],
      ["coinalyzeapi", "api.coinalyze.net"],
      ["tdapi", "api.twelvedata.com"],
      ["mexcapi", "api.mexc.com"],
      ["sosoapi", "openapi.sosovalue.com"],
      ["bgapi", "bitcoin-data.com"],
      ["ethscanapi", "api.etherscan.io"],
    ] as const) {
      expect(planProxyRequest(url(route, "v1/data"), "GET", new Headers()).target.hostname).toBe(host);
    }
  });

  test("refuse traversée et encodages imbriqués du chemin", () => {
    for (const path of [
      "api.alternative.me/../secret",
      "api.alternative.me/%252e%252e/secret",
      "api.alternative.me/%255csecret",
    ]) {
      expect(policyError(() => planProxyRequest(url("extapi", path), "GET", new Headers())).status).toBe(400);
    }
  });

  test("limite les méthodes et réserve POST à SoSoValue", () => {
    expect(planProxyRequest(url("mexcapi", "api/v3/ping"), "HEAD", new Headers()).method).toBe("HEAD");
    expect(
      planProxyRequest(
        url("sosoapi", "openapi/v2/etf/currentEtfDataMetrics"),
        "POST",
        new Headers({ "content-type": "application/json" }),
      ).method,
    ).toBe("POST");
    for (const [route, path] of [
      ["extapi", "api.alternative.me/fng/"],
      ["fredapi", "fred/series/observations"],
    ] as const) {
      const error = policyError(() => planProxyRequest(url(route, path), "POST", new Headers()));
      expect(error.status).toBe(405);
      expect(error.allow).toBe("GET, HEAD");
    }
  });

  test("refuse un POST SoSoValue qui n'est pas JSON", () => {
    const error = policyError(() =>
      planProxyRequest(
        url("sosoapi", "openapi/v2/etf/currentEtfDataMetrics"),
        "POST",
        new Headers({ "content-type": "text/plain" }),
      ),
    );
    expect(error.status).toBe(415);
  });

  test("SoSoValue relaie seulement sa clé et le content-type POST", () => {
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      "x-soso-api-key": "personnelle",
      authorization: "Bearer ne-pas-relayer",
      cookie: "session=secret",
      "x-extra": "interdit",
    });
    const plan = planProxyRequest(
      url("sosoapi", "openapi/v2/etf/currentEtfDataMetrics"),
      "POST",
      headers,
    );
    expect(plan.upstreamHeaders.get("x-soso-api-key")).toBe("personnelle");
    expect(plan.upstreamHeaders.get("content-type")).toBe("application/json; charset=utf-8");
    expect(plan.upstreamHeaders.has("authorization")).toBe(false);
    expect(plan.upstreamHeaders.has("cookie")).toBe(false);
    expect(plan.upstreamHeaders.has("x-extra")).toBe(false);
    expect(plan.privateResponse).toBe(true);
  });

  test("Authorization est relayé uniquement vers bitcoin-data.com", () => {
    const headers = new Headers({ authorization: "Bearer personnelle", cookie: "secret" });
    const bitcoin = planProxyRequest(url("bgapi", "v1/sopr"), "GET", headers);
    const fred = planProxyRequest(url("fredapi", "fred/series/observations"), "GET", headers);
    const extapi = planProxyRequest(url("extapi", "bitcoin-data.com/v1/sopr"), "GET", headers);
    expect(bitcoin.upstreamHeaders.get("authorization")).toBe("Bearer personnelle");
    expect(extapi.upstreamHeaders.get("authorization")).toBe("Bearer personnelle");
    expect(fred.upstreamHeaders.has("authorization")).toBe(false);
    expect(
      planProxyRequest(url("bgapi", "v1/sopr"), "GET", new Headers({ authorization: "Basic secret" }))
        .upstreamHeaders.has("authorization"),
    ).toBe(false);
    expect(bitcoin.upstreamHeaders.has("cookie")).toBe(false);
    expect(fred.privateResponse).toBe(true);
  });

  test("cache public seulement les GET sans clé", () => {
    expect(proxyCacheControl("GET", new URLSearchParams("symbol=BTC"), new Headers())).toContain("public");
    expect(proxyCacheControl("GET", new URLSearchParams("api_key=personnelle"), new Headers())).toBe(
      "private, no-store",
    );
    expect(proxyCacheControl("GET", new URLSearchParams(), new Headers({ authorization: "Bearer x" }))).toBe(
      "private, no-store",
    );
    expect(proxyCacheControl("HEAD", new URLSearchParams(), new Headers())).toBe("private, no-store");
    expect(proxyCacheControl("POST", new URLSearchParams(), new Headers())).toBe("private, no-store");
  });

  test("refuse navigation, script et appel cross-site", () => {
    expect(proxyNavigationForbidden(new Headers({ "sec-fetch-mode": "navigate" }))).toBe(true);
    expect(proxyNavigationForbidden(new Headers({ "sec-fetch-dest": "script" }))).toBe(true);
    expect(proxyNavigationForbidden(new Headers({ "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(proxyNavigationForbidden(new Headers({ "sec-fetch-site": "same-origin" }))).toBe(false);
  });

  test("valide strictement les redirections", () => {
    const allowed = new Set(["api.alternative.me"]);
    const current = new URL("https://api.alternative.me/fng/");
    expect(proxyRedirectAllowed(current, allowed)).toBe(true);
    expect(proxyRedirectAllowed(new URL("http://api.alternative.me/fng/"), allowed)).toBe(false);
    expect(proxyRedirectAllowed(new URL("https://example.invalid/fng/"), allowed)).toBe(false);
    expect(proxyRedirectAllowed(new URL("https://user@api.alternative.me/fng/"), allowed)).toBe(false);
    expect(proxyRedirectTarget("https://example.invalid/fng/", current, allowed)).toBeNull();
    expect(proxyRedirectTarget("https://api.alternative.me:443/fng/", current, allowed)).toBeNull();
    expect(proxyRedirectTarget("/next", current, allowed)?.toString()).toBe("https://api.alternative.me/next");
  });

  test("accepte uniquement des MIME de données inertes", () => {
    for (const mime of [
      "application/json; charset=utf-8",
      "application/rss+xml",
      "application/vnd.sdmx.data+csv",
      "text/csv",
      "application/octet-stream",
      "application/zip",
      "application/gzip",
    ]) expect(proxyMimeAllowed(mime)).toBe(true);
    for (const mime of [
      "text/html",
      "application/xhtml+xml",
      "image/svg+xml",
      "application/javascript",
      "text/css",
      "application/pdf",
    ]) expect(proxyMimeAllowed(mime)).toBe(false);
  });

  test("refuse les adresses privées, réservées et loopback", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "203.0.113.10",
      "::1",
      "fc00::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
      "64:ff9b::7f00:1",
    ]) expect(publicIpAddress(address)).toBe(false);
    expect(publicIpAddress("8.8.8.8")).toBe(true);
    expect(publicIpAddress("2606:4700:4700::1111")).toBe(true);
  });
});
