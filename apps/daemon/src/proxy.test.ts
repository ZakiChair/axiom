import { describe, expect, test } from "bun:test";
import {
  appendApiKeyIfAbsent,
  construireRoutesProxy,
  construireUrlAmontExtapi,
  EXTAPI_WHITELIST,
  parseExtapiChemin,
  traiterExtapi,
  ttlMsExtapi,
  type RouteProxy,
} from "./proxy";
import type { ProxyKeys } from "./env";

const CLES: ProxyKeys = {
  FRED_API_KEY: "fredkey",
  COINALYZE_API_KEY: "coinkey",
  TWELVE_DATA_KEY: "tdkey",
};

function routePar(prefix: string): RouteProxy {
  const route = construireRoutesProxy(CLES).find((r) => r.prefix === prefix);
  if (!route) throw new Error(`route introuvable : ${prefix}`);
  return route;
}

describe("appendApiKeyIfAbsent", () => {
  test("ajoute la clé quand absente (sans query préexistante)", () => {
    expect(appendApiKeyIfAbsent("/x", "api_key", "K")).toBe("/x?api_key=K");
  });
  test("ajoute la clé avec & si query préexistante", () => {
    expect(appendApiKeyIfAbsent("/x?a=1", "api_key", "K")).toBe("/x?a=1&api_key=K");
  });
  test("ne réécrit pas si le paramètre existe déjà (override front prioritaire)", () => {
    expect(appendApiKeyIfAbsent("/x?api_key=perso", "api_key", "K")).toBe("/x?api_key=perso");
  });
  test("clé vide → chemin inchangé (laisse l'amont répondre 401)", () => {
    expect(appendApiKeyIfAbsent("/x", "api_key", "")).toBe("/x");
  });
  test("encode la valeur de clé", () => {
    expect(appendApiKeyIfAbsent("/x", "api_key", "a b")).toBe("/x?api_key=a%20b");
  });
});

describe("construireRoutesProxy — cibles et réécritures", () => {
  test("cibles amont exactes", () => {
    expect(routePar("/fredapi").target).toBe("https://api.stlouisfed.org");
    expect(routePar("/coinalyzeapi").target).toBe("https://api.coinalyze.net");
    expect(routePar("/tdapi").target).toBe("https://api.twelvedata.com");
    expect(routePar("/mexcapi").target).toBe("https://api.mexc.com");
  });

  test("/fredapi : strip préfixe + api_key si absent", () => {
    expect(routePar("/fredapi").rewrite("/fredapi/series?a=1")).toBe(
      "/series?a=1&api_key=fredkey",
    );
  });

  test("/coinalyzeapi : strip préfixe + api_key si absent", () => {
    expect(routePar("/coinalyzeapi").rewrite("/coinalyzeapi/open-interest")).toBe(
      "/open-interest?api_key=coinkey",
    );
  });

  test("/coinalyzeapi : clé perso du front conservée (override)", () => {
    expect(routePar("/coinalyzeapi").rewrite("/coinalyzeapi/x?api_key=perso")).toBe(
      "/x?api_key=perso",
    );
  });

  test("/tdapi : apikey TOUJOURS ajoutée (réplique Vite), avec le bon séparateur", () => {
    expect(routePar("/tdapi").rewrite("/tdapi/time_series")).toBe("/time_series?apikey=tdkey");
    expect(routePar("/tdapi").rewrite("/tdapi/time_series?symbol=AAPL")).toBe(
      "/time_series?symbol=AAPL&apikey=tdkey",
    );
  });

  test("/mexcapi : simple strip de préfixe, keyless", () => {
    expect(routePar("/mexcapi").rewrite("/mexcapi/api/v3/ping")).toBe("/api/v3/ping");
    expect(routePar("/mexcapi").rewrite("/mexcapi/api/v3/klines?symbol=BTCUSDT")).toBe(
      "/api/v3/klines?symbol=BTCUSDT",
    );
  });
});

describe("extapi — whitelist", () => {
  test("contient les 22 hôtes attendus (dont Fear&Greed, Binance fapi/dapi, macro souverain/COT/GEX)", () => {
    expect(EXTAPI_WHITELIST.size).toBe(22);
    for (const hote of [
      "nfs.faireconomy.media",
      "www.coindesk.com",
      "cointelegraph.com",
      "www.theblock.co",
      "decrypt.co",
      "blockworks.co",
      "api.alternative.me",
      "community-api.coinmetrics.io",
      "bitcoin-data.com",
      "api.llama.fi",
      "mempool.space",
      "blockchain.info",
      "www.deribit.com",
      "dapi.binance.com",
      "fapi.binance.com",
      "api.coingecko.com",
      "api.fiscaldata.treasury.gov",
      "data-api.ecb.europa.eu",
      "stats.bis.org",
      "api.imf.org",
      "publicreporting.cftc.gov",
      "cdn.cboe.com",
    ]) {
      expect(EXTAPI_WHITELIST.has(hote)).toBe(true);
    }
  });

  test("un hôte hors liste n'est pas autorisé", () => {
    expect(EXTAPI_WHITELIST.has("evil.com")).toBe(false);
    expect(EXTAPI_WHITELIST.has("api.binance.com")).toBe(false); // non whitelisté (≠ fapi/dapi)
  });
});

describe("parseExtapiChemin", () => {
  test("extrait hôte + reste avec sous-chemin", () => {
    expect(parseExtapiChemin("/extapi/api.alternative.me/fng/")).toEqual({
      hote: "api.alternative.me",
      reste: "/fng/",
    });
  });
  test("hôte seul (sans sous-chemin) → reste vide", () => {
    expect(parseExtapiChemin("/extapi/mempool.space")).toEqual({
      hote: "mempool.space",
      reste: "",
    });
  });
  test("chemin sans hôte → null", () => {
    expect(parseExtapiChemin("/extapi")).toBeNull();
    expect(parseExtapiChemin("/extapi/")).toBeNull();
  });
  test("préfixe non-extapi → null", () => {
    expect(parseExtapiChemin("/extapifaux/x")).toBeNull();
  });
});

describe("construireUrlAmontExtapi — réécriture", () => {
  test("hôte whitelisté : https://<hote><reste><search>", () => {
    expect(construireUrlAmontExtapi("/extapi/api.alternative.me/fng/", "?limit=10")).toBe(
      "https://api.alternative.me/fng/?limit=10",
    );
    expect(
      construireUrlAmontExtapi("/extapi/fapi.binance.com/fapi/v1/premiumIndex", "?symbol=BTCUSDT"),
    ).toBe("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT");
  });
  test("sans query", () => {
    expect(construireUrlAmontExtapi("/extapi/api.llama.fi/overview/fees", "")).toBe(
      "https://api.llama.fi/overview/fees",
    );
  });
  test("hôte hors whitelist → null (→ 403 en amont)", () => {
    expect(construireUrlAmontExtapi("/extapi/evil.com/steal", "")).toBeNull();
  });
});

describe("ttlMsExtapi — TTL cache", () => {
  test("défaut 120 s (RSS, calendriers, on-chain lents)", () => {
    expect(ttlMsExtapi("api.alternative.me")).toBe(120_000);
    expect(ttlMsExtapi("www.coindesk.com")).toBe(120_000);
    expect(ttlMsExtapi("api.llama.fi")).toBe(120_000);
  });
  test("30 s pour les dérivés Binance fapi/dapi", () => {
    expect(ttlMsExtapi("fapi.binance.com")).toBe(30_000);
    expect(ttlMsExtapi("dapi.binance.com")).toBe(30_000);
  });
});

describe("traiterExtapi — gardes (hors réseau)", () => {
  test("hôte hors whitelist → 403 sans fetch", async () => {
    const url = new URL("http://127.0.0.1:8787/extapi/evil.com/x");
    const res = await traiterExtapi(new Request(url), url);
    expect(res.status).toBe(403);
  });
  test("méthode non-GET sur hôte autorisé → 405 sans fetch", async () => {
    const url = new URL("http://127.0.0.1:8787/extapi/api.alternative.me/fng/");
    const res = await traiterExtapi(new Request(url, { method: "POST" }), url);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });
});
