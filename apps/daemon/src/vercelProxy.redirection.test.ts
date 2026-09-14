/**
 * Preuve de bout en bout sur le HANDLER `api/proxy.ts` : la clé de repli BGeometrics
 * (BGEOMETRICS_API_KEY) est émise vers bitcoin-data.com et NE SUIT PAS une redirection
 * vers un autre hôte de la whitelist (route `extapi`, deux sauts). Sur la route fixe
 * `bgapi`, toute redirection hors bitcoin-data.com est refusée.
 *
 * `fetch` global et la résolution DNS sont simulés : aucun appel réseau réel.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("node:dns/promises", () => ({
  default: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
}));

function url(route: string, path: string): string {
  const params = new URLSearchParams({ __axiom_route: route, __axiom_path: path });
  params.append("path", path);
  return `https://axiom.test/api/proxy?${params}`;
}

const fetchOriginal = globalThis.fetch;
const envOriginal = process.env["BGEOMETRICS_API_KEY"];

describe("repli BGeometrics et redirections (handler)", () => {
  beforeEach(() => {
    process.env["BGEOMETRICS_API_KEY"] = "repli-test";
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    if (envOriginal === undefined) delete process.env["BGEOMETRICS_API_KEY"];
    else process.env["BGEOMETRICS_API_KEY"] = envOriginal;
  });

  test("extapi : la clé part vers bitcoin-data.com puis DISPARAÎT au saut vers api.llama.fi", async () => {
    const { default: proxyFunction } = await import("../../../api/proxy");
    const appels: Array<{ host: string; authorization: string | null }> = [];
    globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
      const cible = new URL(entree instanceof Request ? entree.url : String(entree));
      appels.push({ host: cible.hostname, authorization: new Headers(init?.headers).get("authorization") });
      if (cible.hostname === "bitcoin-data.com") {
        return new Response(null, { status: 302, headers: { location: "https://api.llama.fi/v2/chains" } });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;

    const reponse = await proxyFunction.fetch(new Request(url("extapi", "bitcoin-data.com/v1/sopr")));
    expect(reponse.status).toBe(200);
    expect(appels).toEqual([
      { host: "bitcoin-data.com", authorization: "Bearer repli-test" },
      { host: "api.llama.fi", authorization: null },
    ]);
  });

  test("bgapi : une redirection hors bitcoin-data.com est refusée (502), la clé n'est émise qu'une fois", async () => {
    const { default: proxyFunction } = await import("../../../api/proxy");
    const appels: string[] = [];
    globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
      const cible = new URL(entree instanceof Request ? entree.url : String(entree));
      appels.push(`${cible.hostname} ${new Headers(init?.headers).get("authorization") ?? "-"}`);
      return new Response(null, { status: 302, headers: { location: "https://api.llama.fi/v2/chains" } });
    }) as typeof fetch;

    const reponse = await proxyFunction.fetch(new Request(url("bgapi", "v1/sopr")));
    expect(reponse.status).toBe(502);
    expect(appels).toEqual(["bitcoin-data.com Bearer repli-test"]);
  });

  test("une clé personnelle du client reste prioritaire et suit la même règle de saut", async () => {
    const { default: proxyFunction } = await import("../../../api/proxy");
    const appels: Array<string | null> = [];
    globalThis.fetch = (async (_entree: string | URL | Request, init?: RequestInit) => {
      appels.push(new Headers(init?.headers).get("authorization"));
      return Response.json({ ok: true });
    }) as typeof fetch;

    const reponse = await proxyFunction.fetch(
      new Request(url("bgapi", "v1/sopr"), { headers: { authorization: "Bearer personnelle" } }),
    );
    expect(reponse.status).toBe(200);
    expect(appels).toEqual(["Bearer personnelle"]);
  });
});
