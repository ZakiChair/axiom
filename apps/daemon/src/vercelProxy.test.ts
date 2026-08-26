import { describe, expect, test } from "bun:test";
import { publicIpAddress } from "../../../api/proxy";
import {
  planProxyRequest,
  ProxyPolicyError,
  proxyMimeAllowed,
  proxyNavigationForbidden,
  proxyRedirectAllowed,
} from "../../../api/proxy-policy";

function url(route: string, path: string, query = ""): string {
  const params = new URLSearchParams({ __axiom_route: route, __axiom_path: path });
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
  test("réécrit extapi vers un hôte whitelisté et conserve la query", () => {
    const plan = planProxyRequest(
      url("extapi", "api.alternative.me/fng/", "limit=90&format=json"),
      "GET",
      new Headers(),
    );
    expect(plan.target.toString()).toBe("https://api.alternative.me/fng/?limit=90&format=json");
    expect(plan.privateResponse).toBe(false);
    expect(plan.upstreamHeaders.has("cookie")).toBe(false);
  });

  test("refuse un hôte extapi hors whitelist", () => {
    const error = policyError(() =>
      planProxyRequest(url("extapi", "example.invalid/data"), "GET", new Headers()),
    );
    expect(error.status).toBe(403);
  });

  test("réécrit les routes fixes sans autoriser un changement d'autorité", () => {
    const plan = planProxyRequest(
      url("fredapi", "fred/series/observations", "series_id=DFF&api_key=personnelle"),
      "GET",
      new Headers(),
    );
    expect(plan.target.hostname).toBe("api.stlouisfed.org");
    expect(plan.target.pathname).toBe("/fred/series/observations");
    expect(plan.target.searchParams.get("api_key")).toBe("personnelle");
    expect(plan.privateResponse).toBe(true);
  });

  test("refuse traversée et encodages imbriqués du chemin", () => {
    for (const path of ["api.alternative.me/../secret", "api.alternative.me/%252e%252e/secret", "api.alternative.me/%255csecret"])
      expect(policyError(() => planProxyRequest(url("extapi", path), "GET", new Headers())).status).toBe(400);
  });

  test("limite les méthodes par route", () => {
    const error = policyError(() =>
      planProxyRequest(url("extapi", "api.alternative.me/fng/"), "POST", new Headers()),
    );
    expect(error.status).toBe(405);
    expect(error.allow).toBe("GET, HEAD");
  });

  test("SoSoValue accepte POST JSON et ne relaie que sa clé dédiée", () => {
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
    expect(plan.upstreamHeaders.get("content-type")).toBe("application/json");
    expect(plan.upstreamHeaders.has("authorization")).toBe(false);
    expect(plan.upstreamHeaders.has("cookie")).toBe(false);
    expect(plan.upstreamHeaders.has("x-extra")).toBe(false);
    expect(plan.privateResponse).toBe(true);
  });

  test("bitcoin-data relaie uniquement un Bearer borné", () => {
    const accepted = planProxyRequest(
      url("bgapi", "v1/sopr"),
      "GET",
      new Headers({ authorization: "Bearer personnelle" }),
    );
    expect(accepted.upstreamHeaders.get("authorization")).toBe("Bearer personnelle");
    const rejected = planProxyRequest(
      url("bgapi", "v1/sopr"),
      "GET",
      new Headers({ authorization: "Basic secret" }),
    );
    expect(rejected.upstreamHeaders.has("authorization")).toBe(false);
  });

  test("refuse navigation, script et appel cross-site", () => {
    expect(proxyNavigationForbidden(new Headers({ "sec-fetch-mode": "navigate" }))).toBe(true);
    expect(proxyNavigationForbidden(new Headers({ "sec-fetch-dest": "script" }))).toBe(true);
    expect(proxyNavigationForbidden(new Headers({ "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(proxyNavigationForbidden(new Headers({ "sec-fetch-site": "same-origin" }))).toBe(false);
  });

  test("valide strictement les redirections", () => {
    const allowed = new Set(["api.alternative.me"]);
    expect(proxyRedirectAllowed(new URL("https://api.alternative.me/fng/"), allowed)).toBe(true);
    expect(proxyRedirectAllowed(new URL("http://api.alternative.me/fng/"), allowed)).toBe(false);
    expect(proxyRedirectAllowed(new URL("https://example.invalid/fng/"), allowed)).toBe(false);
    expect(proxyRedirectAllowed(new URL("https://user@api.alternative.me/fng/"), allowed)).toBe(false);
  });

  test("accepte uniquement des MIME de données inertes", () => {
    for (const mime of [
      "application/json; charset=utf-8",
      "application/rss+xml",
      "application/vnd.sdmx.data+csv",
      "text/csv",
      "application/octet-stream",
    ]) expect(proxyMimeAllowed(mime)).toBe(true);
    for (const mime of ["text/html", "image/svg+xml", "application/javascript", "text/css", "application/pdf"])
      expect(proxyMimeAllowed(mime)).toBe(false);
  });

  test("refuse les adresses privées, réservées et loopback", () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "203.0.113.10", "::1", "fc00::1", "2001:db8::1"])
      expect(publicIpAddress(address)).toBe(false);
    expect(publicIpAddress("8.8.8.8")).toBe(true);
    expect(publicIpAddress("2606:4700:4700::1111")).toBe(true);
  });

  test("refuse le mauvais content-type POST", () => {
    const error = policyError(() =>
      planProxyRequest(
        url("sosoapi", "openapi/v2/etf/currentEtfDataMetrics"),
        "POST",
        new Headers({ "content-type": "text/plain" }),
      ),
    );
    expect(error.status).toBe(415);
  });
});
