import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import proxyFunction, { publicIpAddress } from "../../../api/proxy";
import hlPoolFunction, {
  CACHE_HLPOOL,
  CACHE_HLPOOL_REPLI,
  config as configHlPool,
  creerGestionnaireHlPool,
  TIMEOUT_HLPOOL_AMONT_MS,
} from "../../../api/hlpool";
import { N_VALEUR_POOL, TAILLE_POOL, TTL_POOL_MS, URL_LEADERBOARD } from "../../../shared/hyperliquidScan";
import {
  planProxyRequest,
  proxyCacheControl,
  proxyExtapiHostAllowed,
  ProxyPolicyError,
  proxyMimeAllowed,
  proxyNavigationForbidden,
  proxyRedirectAllowed,
  proxyRedirectTarget,
  proxyUpstreamHeaders,
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
    // Exception ACTÉE (BUILD-CONTRACT, 2026-09-14) : la seule lecture d'environnement admise
    // est le repli BGeometrics, via le paramètre par défaut typé `ProxyEnv` (une variable).
    const sansRepliBg = `${policySource}\n${handlerSource}`.replace(/env: ProxyEnv = process\.env/g, "");
    expect(sansRepliBg).not.toMatch(/\b(?:process|Bun|Deno)\.env\b/);
    expect(policySource.match(/\benv\[/g)).toHaveLength(1);
    expect(policySource).toContain('env["BGEOMETRICS_API_KEY"]');
  });

  test("place les onze rewrites du proxy et celui de /hlpool avant le fallback SPA", async () => {
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
      "/ccdataapi/:path*",
      "/defillamapro/:path*",
      "/cqapi/:path*",
    ];
    const fallbackIndex = config.rewrites.findIndex((rewrite) => rewrite.destination === "/index.html");
    const avantFallback = config.rewrites.slice(0, fallbackIndex);
    // Exception UNIQUE à « tout rewrite passe par /api/proxy » : le pool LIQHL réduit
    // (fonction dédiée, sans paramètre ni secret — cf. describe « fonction Vercel /hlpool »).
    const hlPool = avantFallback.filter((rewrite) => rewrite.destination === "/api/hlpool");
    const proxyRewrites = avantFallback.filter((rewrite) => rewrite.destination !== "/api/hlpool");
    expect(fallbackIndex).toBeGreaterThan(0);
    expect(hlPool).toEqual([{ source: "/hlpool", destination: "/api/hlpool" }]);
    expect(required.every((source) => proxyRewrites.some((rewrite) => rewrite.source === source))).toBe(true);
    expect(required.every((source) => proxyRewrites.some((rewrite) => rewrite.source === `${source}/`))).toBe(true);
    expect(proxyRewrites.every((rewrite) => rewrite.destination.startsWith("/api/proxy?"))).toBe(true);
    expect(config.rewrites[fallbackIndex]).toEqual({ source: "/(.*)", destination: "/index.html" });
  });

  test("réécrit extapi vers la whitelist partagée et conserve path et query", () => {
    expect(proxyExtapiHostAllowed("api.alternative.me")).toBe(true);
    expect(proxyExtapiHostAllowed("api.coinmarketcap.com")).toBe(true);
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

  test("fixe l'autorité des neuf routes spécifiques", () => {
    const bearer = new Headers({ authorization: "Bearer personnelle" });
    for (const [route, host, path, query, headers] of [
      ["fredapi", "api.stlouisfed.org", "v1/data", "", new Headers()],
      ["coinalyzeapi", "api.coinalyze.net", "v1/data", "", new Headers()],
      ["tdapi", "api.twelvedata.com", "v1/data", "", new Headers()],
      ["mexcapi", "api.mexc.com", "v1/data", "", new Headers()],
      ["sosoapi", "openapi.sosovalue.com", "v1/data", "", new Headers()],
      ["bgapi", "bitcoin-data.com", "v1/data", "", new Headers()],
      ["ethscanapi", "api.etherscan.io", "v1/data", "", new Headers()],
      ["ccdataapi", "min-api.cryptocompare.com", "v1/data", "", new Headers()],
      // CryptoQuant : liste fermée et Bearer personnel obligatoires (sinon 404 ou 401).
      ["cqapi", "api.cryptoquant.com", "v2/market/cq/spot/trade", "symbol=btc_all&window=day&limit=30", bearer],
    ] as const) {
      expect(planProxyRequest(url(route, path, query), "GET", headers).target.hostname).toBe(host);
    }
  });

  test("DefiLlama Pro accepte uniquement les trois chemins, reste privé et ne relaie pas la clé en en-tête", () => {
    const headers = new Headers({ "x-defillama-pro-key": "CLESECRETE" });
    const plan = planProxyRequest(url("defillamapro", "bridgevolume/Ethereum", "id=2"), "GET", headers);
    expect(plan.target.toString()).toBe("https://pro-api.llama.fi/CLESECRETE/bridges/bridgevolume/Ethereum?id=2");
    expect(plan.upstreamHeaders.has("x-defillama-pro-key")).toBe(false);
    expect(plan.cacheControl).toBe("private, no-store");
    expect(plan.maxRedirects).toBe(0);
    expect(policyError(() => planProxyRequest(url("defillamapro", "api/entities"), "GET", headers)).status).toBe(404);
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
      ["ccdataapi", "data/overview/v1/history"],
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

  test("Authorization est relayé uniquement avec le schéma attendu par destination", () => {
    const bearer = new Headers({ authorization: "Bearer personnelle", cookie: "secret" });
    const apikey = new Headers({ authorization: "Apikey personnelle", cookie: "secret" });
    const bitcoin = planProxyRequest(url("bgapi", "v1/sopr"), "GET", bearer);
    const ccdata = planProxyRequest(url("ccdataapi", "data/overview/v1/history"), "GET", apikey);
    const fred = planProxyRequest(url("fredapi", "fred/series/observations"), "GET", bearer);
    const extapi = planProxyRequest(url("extapi", "bitcoin-data.com/v1/sopr"), "GET", bearer);
    expect(bitcoin.upstreamHeaders.get("authorization")).toBe("Bearer personnelle");
    expect(ccdata.upstreamHeaders.get("authorization")).toBe("Apikey personnelle");
    expect(extapi.upstreamHeaders.get("authorization")).toBe("Bearer personnelle");
    expect(fred.upstreamHeaders.has("authorization")).toBe(false);
    expect(
      planProxyRequest(url("bgapi", "v1/sopr"), "GET", new Headers({ authorization: "Basic secret" }))
        .upstreamHeaders.has("authorization"),
    ).toBe(false);
    expect(
      planProxyRequest(url("ccdataapi", "v1/data"), "GET", bearer).upstreamHeaders.has("authorization"),
    ).toBe(false);
    expect(
      planProxyRequest(
        url("ccdataapi", "v1/data"),
        "GET",
        new Headers({ authorization: `Apikey ${"x".repeat(600)}` }),
      ).upstreamHeaders.has("authorization"),
    ).toBe(false);
    expect(bitcoin.upstreamHeaders.has("cookie")).toBe(false);
    expect(ccdata.upstreamHeaders.has("cookie")).toBe(false);
    expect(ccdata.privateResponse).toBe(true);
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

describe("repli serveur BGeometrics (BGEOMETRICS_API_KEY)", () => {
  const env = { BGEOMETRICS_API_KEY: "repli-serveur" };

  test("sans clé client : le proxy porte la clé d'environnement vers bitcoin-data.com", () => {
    const plan = planProxyRequest(url("bgapi", "v1/sopr"), "GET", new Headers(), env);
    expect(plan.upstreamHeaders.get("authorization")).toBe("Bearer repli-serveur");
    // Aucune clé côté client : la réponse reste publiquement cachable (la clé n'y figure pas).
    expect(plan.privateResponse).toBe(false);
    expect(plan.cacheControl).toBe("public, max-age=60, s-maxage=60");
  });

  test("une clé personnelle du client reste prioritaire", () => {
    const plan = planProxyRequest(url("bgapi", "v1/sopr"), "GET", new Headers({ authorization: "Bearer personnelle" }), env);
    expect(plan.upstreamHeaders.get("authorization")).toBe("Bearer personnelle");
    expect(plan.privateResponse).toBe(true);
  });

  test("la clé d'environnement ne fuit vers aucun autre hôte, et rien sans variable", () => {
    const extapi = planProxyRequest(url("extapi", "api.alternative.me/fng/"), "GET", new Headers(), env);
    expect(extapi.upstreamHeaders.has("authorization")).toBe(false);
    const ccdata = planProxyRequest(url("ccdataapi", "data/price"), "GET", new Headers(), env);
    expect(ccdata.upstreamHeaders.has("authorization")).toBe(false);
    const sansEnv = planProxyRequest(url("bgapi", "v1/sopr"), "GET", new Headers(), {});
    expect(sansEnv.upstreamHeaders.has("authorization")).toBe(false);
  });
});

describe("route CryptoQuant /cqapi (licence personnelle, liste fermée)", () => {
  const CHEMIN = "v2/market/cq/spot/trade";
  const QUERY = "symbol=btc_all&window=day&limit=30";
  const CIBLE = "https://api.cryptoquant.com/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30";
  // Variables serveur posées par erreur : aucune ne doit servir de repli CryptoQuant.
  const envServeur = { BGEOMETRICS_API_KEY: "repli-serveur", CRYPTOQUANT_API_KEY: "repli-cq-interdit" };
  const bearer = (): Headers =>
    new Headers({ authorization: "Bearer CLE-TEST-SECRETE", cookie: "session=secret", "x-extra": "interdit" });

  test("GET sans Authorization : 401 local, y compris avec des variables serveur", () => {
    for (const env of [{}, envServeur]) {
      const error = policyError(() => planProxyRequest(url("cqapi", CHEMIN, QUERY), "GET", new Headers(), env));
      expect(error.status).toBe(401);
      expect(error.message).toBe("clé CryptoQuant personnelle requise");
    }
  });

  test("Bearer personnel : cible exacte, en-tête relayé, sans cookie, privé, zéro redirection", () => {
    const plan = planProxyRequest(url("cqapi", CHEMIN, QUERY), "GET", bearer(), envServeur);
    expect(plan.route).toBe("cqapi");
    expect(plan.method).toBe("GET");
    expect(plan.target.toString()).toBe(CIBLE);
    expect(plan.upstreamHeaders.get("authorization")).toBe("Bearer CLE-TEST-SECRETE");
    expect(plan.upstreamHeaders.has("cookie")).toBe(false);
    expect(plan.upstreamHeaders.has("x-extra")).toBe(false);
    expect(plan.cacheControl).toBe("private, no-store");
    expect(plan.privateResponse).toBe(true);
    expect(plan.maxRedirects).toBe(0);
    expect([...plan.allowedRedirectHosts]).toEqual(["api.cryptoquant.com"]);
  });

  test("route publique et forme réécrite : même cible ; query normalisée sur les trois chemins", () => {
    const publique = planProxyRequest(`https://axiom.test/cqapi/${CHEMIN}?${QUERY}`, "GET", bearer());
    expect(publique.target.toString()).toBe(CIBLE);
    expect(
      planProxyRequest(url("cqapi", "v2/market/cq/swap/trade", "window=day&symbol=eth_all"), "GET", bearer())
        .target.toString(),
    ).toBe("https://api.cryptoquant.com/v2/market/cq/swap/trade?symbol=eth_all&window=day");
    expect(
      planProxyRequest(url("cqapi", "v1/btc/miner-data/companies", "limit=30&window=day&miner=mara"), "GET", bearer())
        .target.toString(),
    ).toBe("https://api.cryptoquant.com/v1/btc/miner-data/companies?miner=mara&window=day&limit=30");
  });

  test("404 pour tout chemin ou paramètre hors liste fermée", () => {
    for (const [path, query] of [
      ["v1/btc/exchange-flows/reserve", "exchange=all_exchange&window=day"],
      [CHEMIN, "symbol=sol_all&window=day&limit=30"],
      ["v1/btc/miner-data/companies", "miner=inconnu&window=day&limit=30"],
      [CHEMIN, "symbol=btc_all&window=hour&limit=30"],
      [CHEMIN, "symbol=btc_all&window=day&limit=31"],
      [CHEMIN, "symbol=btc_all&window=day&from=20260901"],
      [CHEMIN, "symbol=btc_all&window=day&inconnu=1"],
      [CHEMIN, "symbol=btc_all&symbol=btc_all&window=day"],
      [`${CHEMIN}/`, QUERY],
      [`/${CHEMIN}`, QUERY],
      [`//${CHEMIN}`, QUERY],
      ["v2/market//cq/spot/trade", QUERY],
    ] as const) {
      const error = policyError(() => planProxyRequest(url("cqapi", path, query), "GET", bearer()));
      expect(error.status).toBe(404);
      expect(error.message).toBe("chemin CryptoQuant refusé");
    }
  });

  test("route publique /cqapi//… : 404 comme le daemon et Vite, après les contrôles 405 et 401", () => {
    const publique = `https://axiom.test/cqapi//${CHEMIN}?${QUERY}`;
    const refus = policyError(() => planProxyRequest(publique, "GET", bearer()));
    expect(refus.status).toBe(404);
    expect(refus.message).toBe("chemin CryptoQuant refusé");
    expect(policyError(() => planProxyRequest(`https://axiom.test/cqapi///${CHEMIN}?${QUERY}`, "GET", bearer())).status).toBe(404);
    expect(policyError(() => planProxyRequest(publique, "GET", new Headers())).status).toBe(401);
    expect(policyError(() => planProxyRequest(publique, "POST", bearer())).status).toBe(405);
  });

  test("POST et HEAD : 405 allow GET, avec ou sans clé", () => {
    for (const method of ["POST", "HEAD"]) {
      for (const headers of [new Headers(), bearer()]) {
        const error = policyError(() => planProxyRequest(url("cqapi", CHEMIN, QUERY), method, headers));
        expect(error.status).toBe(405);
        expect(error.allow).toBe("GET");
      }
    }
  });

  test("Apikey, Basic, jeton vide ou en-tête de plus de 512 caractères : 401", () => {
    for (const authorization of [
      "Apikey CLE-TEST-SECRETE",
      "Basic CLE-TEST-SECRETE",
      "Bearer",
      `Bearer ${"x".repeat(600)}`,
    ]) {
      const error = policyError(() =>
        planProxyRequest(url("cqapi", CHEMIN, QUERY), "GET", new Headers({ authorization }), envServeur),
      );
      expect(error.status).toBe(401);
    }
  });

  test("aucune variable serveur ne part vers api.cryptoquant.com, le Bearer ne part vers aucun autre hôte fixe", () => {
    const plan = planProxyRequest(
      url("cqapi", CHEMIN, QUERY),
      "GET",
      new Headers({ authorization: "Bearer personnelle" }),
      envServeur,
    );
    expect(plan.upstreamHeaders.get("authorization")).toBe("Bearer personnelle");
    expect(proxyUpstreamHeaders(new Headers(), "api.cryptoquant.com", "GET", envServeur).has("authorization")).toBe(false);
    expect(
      proxyUpstreamHeaders(new Headers({ authorization: "Apikey x" }), "api.cryptoquant.com", "GET", envServeur)
        .has("authorization"),
    ).toBe(false);
    expect(
      planProxyRequest(
        url("fredapi", "fred/series/observations"),
        "GET",
        new Headers({ authorization: "Bearer personnelle" }),
        envServeur,
      ).upstreamHeaders.has("authorization"),
    ).toBe(false);
  });
});

describe("fonction Vercel /hlpool (pool LIQHL réduit, extension du 25 septembre)", () => {
  const racineApi = new URL("../../../api/", import.meta.url);
  const adresse = (i: number): string => `0x${i.toString(16).padStart(40, "0")}`;
  const T0 = Date.UTC(2026, 8, 25, 12, 0, 0);
  /** Leaderboard minimal (n lignes, accountValue décroissant). */
  const leaderboard = (n: number): string =>
    JSON.stringify({
      leaderboardRows: Array.from({ length: n }, (_, i) => ({ ethAddress: adresse(i + 1), accountValue: String(1000 - i) })),
    });
  const get = (): Request => new Request("https://axiom.test/api/hlpool");

  test("aucune fonction de api/ ne lit l'environnement, hors l'exception BGeometrics de _policy.ts", async () => {
    const fichiers = readdirSync(racineApi).filter((f) => f.endsWith(".ts"));
    expect(fichiers).toContain("hlpool.ts");
    for (const fichier of fichiers) {
      const source = await Bun.file(new URL(fichier, racineApi)).text();
      const sansRepliBg = source.replace(/env: ProxyEnv = process\.env/g, "");
      expect(sansRepliBg).not.toMatch(/\b(?:process|Bun|Deno)\.env\b/);
      if (fichier !== "_policy.ts") expect(source).not.toMatch(/\benv\[/);
    }
  });

  test("fonction Web Standard sans secret : GET seul, import partagé tracé par le bundler", async () => {
    expect(typeof hlPoolFunction.fetch).toBe("function");
    const source = await Bun.file(new URL("hlpool.ts", racineApi)).text();
    expect(source).toContain("export default { fetch:");
    expect(source).toContain('from "../shared/hyperliquidScan.js"'); // convention de api/proxy.ts
    expect(source).not.toMatch(/authorization|api[_-]?key/i);
  });

  test("délai amont sous maxDuration, avec marge pour le parse et la réponse", () => {
    expect(configHlPool.maxDuration).toBe(60);
    expect(TIMEOUT_HLPOOL_AMONT_MS).toBeLessThanOrEqual(configHlPool.maxDuration * 1000 - 10_000);
    expect(CACHE_HLPOOL).toBe("public, s-maxage=21600, stale-while-revalidate=86400");
  });

  test("GET → 200 { ts, nValeur, tailleCible, adresses }, cache CDN 6 h ; relu en mémoire ensuite", async () => {
    const appels: Array<{ url: string; signal: AbortSignal | null | undefined }> = [];
    const fetchImpl = (async (entree: RequestInfo | URL, init?: RequestInit) => {
      appels.push({ url: String(entree), signal: init?.signal });
      return new Response(leaderboard(3));
    }) as typeof fetch;
    const traiter = creerGestionnaireHlPool(fetchImpl, () => T0);
    const res = await traiter(get());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe(CACHE_HLPOOL);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.json()).toEqual({
      ts: T0,
      nValeur: N_VALEUR_POOL,
      tailleCible: TAILLE_POOL,
      adresses: [adresse(1), adresse(2), adresse(3)],
    });
    expect(appels).toHaveLength(1);
    expect(appels[0]?.url).toBe(URL_LEADERBOARD);
    expect(appels[0]?.signal).toBeInstanceOf(AbortSignal);
    // Même instance (fluid compute) : une requête qui contourne le CDN (query string) ne
    // retélécharge PAS les ≈ 39 Mo tant que le pool en mémoire a moins de 6 h.
    const res2 = await traiter(new Request("https://axiom.test/api/hlpool?contournement=1"));
    expect(res2.status).toBe(200);
    expect(appels).toHaveLength(1);
  });

  test("requêtes simultanées : UN seul téléchargement amont en vol", async () => {
    let appels = 0;
    let liberer: () => void = () => {};
    const bloque = new Promise<void>((r) => (liberer = r));
    const fetchImpl = (async () => {
      appels += 1;
      await bloque;
      return new Response(leaderboard(2));
    }) as unknown as typeof fetch;
    const traiter = creerGestionnaireHlPool(fetchImpl, () => T0);
    const r1 = traiter(get());
    const r2 = traiter(get());
    liberer();
    expect((await r1).status).toBe(200);
    expect((await r2).status).toBe(200);
    expect(appels).toBe(1);
  });

  test("méthode ≠ GET → 405 Allow: GET, sans appel amont", async () => {
    let appels = 0;
    const fetchImpl = (async () => {
      appels += 1;
      return new Response(leaderboard(1));
    }) as unknown as typeof fetch;
    const traiter = creerGestionnaireHlPool(fetchImpl, () => T0);
    for (const method of ["POST", "HEAD", "PUT", "OPTIONS"]) {
      const res = await traiter(new Request("https://axiom.test/api/hlpool", { method }));
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(appels).toBe(0);
  });

  test("amont en échec (HTTP, réseau, pool vide) sans pool en mémoire → 502 JSON, jamais de cache long", async () => {
    for (const fetchImpl of [
      (async () => new Response("panne", { status: 500 })) as unknown as typeof fetch,
      (async () => {
        throw new Error("réseau");
      }) as unknown as typeof fetch,
      (async () => new Response(JSON.stringify({ leaderboardRows: [] }))) as unknown as typeof fetch,
    ]) {
      const res = await creerGestionnaireHlPool(fetchImpl, () => T0)(get());
      expect(res.status).toBe(502);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(((await res.json()) as { erreur?: unknown }).erreur).toBeString();
    }
  });

  test("amont en échec avec un pool en mémoire PÉRIMÉ → servi, cache court (repli comme le daemon)", async () => {
    let now = T0;
    let panne = false;
    const fetchImpl = (async () => {
      if (panne) throw new Error("réseau");
      return new Response(leaderboard(2));
    }) as unknown as typeof fetch;
    const traiter = creerGestionnaireHlPool(fetchImpl, () => now);
    expect((await traiter(get())).status).toBe(200);
    now = T0 + TTL_POOL_MS + 1;
    panne = true;
    const res = await traiter(get());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(CACHE_HLPOOL_REPLI);
    expect(((await res.json()) as { ts: number }).ts).toBe(T0);
  });

  test("CSP (Report-Only) : connect-src autorise l'API info ET le leaderboard (repli direct)", async () => {
    const config = (await Bun.file(new URL("../../../vercel.json", import.meta.url)).json()) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    };
    const csp = config.headers.flatMap((h) => h.headers).find((h) => h.key === "Content-Security-Policy-Report-Only");
    const connect = csp?.value.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src")) ?? "";
    expect(connect.split(/\s+/)).toContain("https://api.hyperliquid.xyz");
    expect(connect.split(/\s+/)).toContain("https://stats-data.hyperliquid.xyz");
  });
});
