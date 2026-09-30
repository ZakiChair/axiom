import { describe, expect, test } from "bun:test";
import { planProxyRequest, ProxyPolicyError } from "../../../api/_policy";
import proxy from "../../../api/proxy";
import dns from "node:dns/promises";
import { afterEach, spyOn } from "bun:test";
import { handleConfig } from "../../../api/config";

const env = {
  FRED_API_KEY: "secret-fred", COINALYZE_API_KEY: "secret-coinalyze",
  TWELVE_DATA_KEY: "secret-twelvedata", SOSOVALUE_API_KEY: "secret-sosovalue",
  ETHERSCAN_API_KEY: "secret-etherscan", BGEOMETRICS_API_KEY: "secret-bgeometrics",
  CRYPTOQUANT_API_KEY: "secret-cryptoquant", CCDATA_API_KEY: "secret-ccdata",
  DEFILLAMA_API_KEY: "secret-defillama", FINNHUB_API_KEY: "secret-finnhub",
  COINGECKO_API_KEY: "secret-coingecko",
};
const cases = [
  ["fredapi/fred/series/observations?series_id=DFF", "api_key", "secret-fred"],
  ["coinalyzeapi/v1/open-interest?symbols=BTCUSDT_PERP.A", "api_key", "secret-coinalyze"],
  ["tdapi/time_series?symbol=AAPL", "apikey", "secret-twelvedata"],
  ["ethscanapi/v2/api?chainid=1&module=stats&action=ethsupply", "apikey", "secret-etherscan"],
  ["finnhubapi/stock/profile2?symbol=AAPL", "token", "secret-finnhub"],
] as const;

describe("clés serveur Vercel", () => {
  test.each(cases)("repli query privé, sans redirection : %s", (path, queryKey, secret) => {
    const p = planProxyRequest(`https://axiom.test/${path}`, "GET", new Headers(), env);
    expect(p.target.searchParams.get(queryKey)).toBe(secret);
    expect(p.privateResponse).toBe(true);
    expect(p.cacheControl).toBe("private, no-store");
    expect(p.maxRedirects).toBe(0);
    const perso = planProxyRequest(`https://axiom.test/${path}&${queryKey}=prioritaire`, "GET", new Headers(), env);
    expect(perso.target.searchParams.get(queryKey)).toBe("prioritaire");
  });

  test.each([
    ["bgapi/v1/sopr", "authorization", "Bearer secret-bgeometrics", "Bearer personnelle"],
    ["ccdataapi/data/overview/v1/historical/marketcap/all-assets/days", "authorization", "Apikey secret-ccdata", "Apikey personnelle"],
    ["sosoapi/openapi/v1/etfs/summary-history", "x-soso-api-key", "secret-sosovalue", "personnelle"],
    ["cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day", "authorization", "Bearer secret-cryptoquant", "Bearer personnelle"],
    ["coingeckoapi/global", "x-cg-demo-api-key", "secret-coingecko", "personnelle"],
  ])("repli en-tête privé, override prioritaire : %s", (path, header, expected, personal) => {
    const p = planProxyRequest(`https://axiom.test/${path}`, "GET", new Headers(), env);
    expect(p.upstreamHeaders.get(header)).toBe(expected);
    expect(p.cacheControl).toBe("private, no-store");
    expect(p.maxRedirects).toBe(0);
    expect(planProxyRequest(`https://axiom.test/${path}`, "GET", new Headers({ [header]: personal }), env).upstreamHeaders.get(header)).toBe(personal);
  });

  test("DefiLlama injecte uniquement dans son chemin prévu et utilise la clé personnelle en priorité", () => {
    const p = planProxyRequest("https://axiom.test/defillamapro/emissions", "GET", new Headers(), env);
    expect(p.target.href).toBe("https://pro-api.llama.fi/secret-defillama/api/emissions");
    expect(p.cacheControl).toBe("private, no-store");
    expect(planProxyRequest("https://axiom.test/defillamapro/emissions", "GET", new Headers({ "x-defillama-pro-key": "personnelle" }), env).target.pathname).toBe("/personnelle/api/emissions");
  });

  test("aucun repli serveur dans le proxy générique, même pour un hôte connu", () => {
    for (const path of ["bitcoin-data.com/v1/sopr", "api.coingecko.com/api/v3/global", "api.alternative.me/fng/"]) {
      const p = planProxyRequest(`https://axiom.test/extapi/${path}`, "GET", new Headers(), env);
      expect(p.upstreamHeaders.has("authorization")).toBe(false);
      expect(p.upstreamHeaders.has("x-cg-demo-api-key")).toBe(false);
      expect(p.target.search).toBe("");
    }
  });

  test("clé CoinGecko query personnelle prioritaire sur le serveur", () => {
    const p = planProxyRequest("https://axiom.test/coingeckoapi/global?x_cg_demo_api_key=personnelle", "GET", new Headers(), env);
    expect(p.target.searchParams.get("x_cg_demo_api_key")).toBe("personnelle");
    expect(p.upstreamHeaders.has("x-cg-demo-api-key")).toBe(false);
    expect(p.cacheControl).toBe("private, no-store");
  });

  test("refuse les chemins hors lecture des nouveaux fournisseurs", () => {
    for (const path of ["finnhubapi/stock/insider-transactions", "finnhubapi//news", "coingeckoapi/key", "coingeckoapi/coins/bitcoin/tickers"]) {
      expect(() => planProxyRequest(`https://axiom.test/${path}`, "GET", new Headers(), env)).toThrow(ProxyPolicyError);
    }
  });

  test("accepte les lectures CoinGecko utilisées, y compris les trésoreries et l'historique", () => {
    for (const path of ["global", "coins/markets", "coins/categories", "companies/public_treasury/bitcoin", "coins/bitcoin/market_chart", "coins/bitcoin/market_chart/range"]) {
      expect(planProxyRequest(`https://axiom.test/coingeckoapi/${path}`, "GET", new Headers(), env).target.pathname).toBe(`/api/v3/${path}`);
    }
  });

  test("les clés serveur refusent les chemins arbitraires des fournisseurs existants", () => {
    for (const path of ["fredapi/autre", "coinalyzeapi/v1/autre", "tdapi/api_usage", "sosoapi/autre", "bgapi/v1/autre", "ccdataapi/autre", "ethscanapi/v2/api?chainid=1&module=proxy&action=eth_sendRawTransaction"]) {
      expect(() => planProxyRequest(`https://axiom.test/${path}`, "GET", new Headers(), env)).toThrow(ProxyPolicyError);
    }
  });
});

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => { for (const s of spies.splice(0)) s.mockRestore(); });
function mockUpstream(responder: (url: URL, headers: Headers) => Response) {
  spies.push(spyOn(dns, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never));
  spies.push(spyOn(globalThis, "fetch").mockImplementation((async (input, init) => responder(new URL(String(input)), new Headers(init?.headers))) as typeof fetch));
}

describe("transport et absence de fuite", () => {
  test("assainit le diagnostic avec clé réimprimée dans une réponse 200", async () => {
    mockUpstream((url) => Response.json({ code: 401, message: `clé refusée : ${url.searchParams.get("apikey")}` }));
    const r = await proxy.fetch(new Request("https://axiom.test/tdapi/time_series?apikey=secret-test-reflete"));
    const text = await r.text();
    expect(text).not.toContain("secret-test-reflete");
    expect(JSON.parse(text)).toEqual({ code: 401, message: "clé refusée : ***" });
  });

  test("expurge aussi une clé échappée dans une chaîne JSON sans arrondir les nombres", async () => {
    mockUpstream(() => new Response('{"message":"\\u0073ecret-test-reflete","valeur":9007199254740993}', { headers: { "content-type": "application/json" } }));
    const r = await proxy.fetch(new Request("https://axiom.test/tdapi/time_series?apikey=secret-test-reflete"));
    expect(await r.text()).toBe('{"message":"***","valeur":9007199254740993}');
  });

  test("une erreur MIME ne réimprime aucun credential", async () => {
    mockUpstream(() => new Response("erreur", { headers: { "content-type": "text/secret-test-reflete" } }));
    const r = await proxy.fetch(new Request("https://axiom.test/tdapi/time_series?apikey=secret-test-reflete"));
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain("secret-test-reflete");
  });

  test("429 et 503 conservent un Retry-After numérique borné", async () => {
    mockUpstream(() => Response.json({ erreur: "quota" }, { status: 429, headers: { "retry-after": "999999" } }));
    const r = await proxy.fetch(new Request("https://axiom.test/fredapi/fred/series/observations?api_key=personnelle"));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("86400");
  });

  test.each([429, 503])("%i conserve une heure de Retry-After sans raccourcir le quota", async (status) => {
    mockUpstream(() => Response.json({ erreur: "quota" }, { status, headers: { "retry-after": "3600" } }));
    const r = await proxy.fetch(new Request("https://axiom.test/fredapi/fred/series/observations?api_key=personnelle"));
    expect(r.status).toBe(status);
    expect(r.headers.get("retry-after")).toBe("3600");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });

  test("config ne renvoie que les onze booléens et jamais les valeurs", async () => {
    const r = handleConfig(new Request("https://axiom.test/api/config"), { ...env, FINNHUB_API_KEY: "   " });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const text = await r.text();
    expect(text).not.toContain("secret-");
    const data = JSON.parse(text);
    expect(Object.keys(data)).toEqual(["providers"]);
    expect(Object.keys(data.providers)).toHaveLength(11);
    expect(data.providers.finnhub).toBe(false);
    expect(data.providers.fred).toBe(true);
    expect(Object.values(data.providers).every((v) => typeof v === "boolean")).toBe(true);
    expect(handleConfig(new Request("https://axiom.test/api/config", { method: "POST" }), env).status).toBe(405);
  });
});
