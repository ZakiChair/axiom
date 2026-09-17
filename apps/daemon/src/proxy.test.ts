import { describe, expect, spyOn, test } from "bun:test";
import {
  adresseIpPublique,
  appendApiKeyIfAbsent,
  construireRoutesProxy,
  construireUrlAmontExtapi,
  enregistrerProxy,
  EXTAPI_WHITELIST,
  mimeExtapiAutorise,
  parseExtapiChemin,
  recupererExtapiSecurise,
  requeteNavigationExtapiInterdite,
  traiterCcData,
  traiterCryptoQuant,
  traiterDefillamaPro,
  traiterExtapi,
  traiterProxy,
  ttlMsExtapi,
  userAgentPourHote,
  type FetchExtapi,
  type RouteProxy,
} from "./proxy";
import type { ProxyKeys } from "./env";
import { Routeur } from "./router";

const CLES: ProxyKeys = {
  FRED_API_KEY: "fredkey",
  COINALYZE_API_KEY: "coinkey",
  TWELVE_DATA_KEY: "tdkey",
  SOSOVALUE_API_KEY: "sosokey",
  ETHERSCAN_API_KEY: "ethkey",
  BGEOMETRICS_API_KEY: "bgkey",
  CRYPTOQUANT_API_KEY: "cqkey",
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
    expect(routePar("/sosoapi").target).toBe("https://openapi.sosovalue.com");
    expect(routePar("/ethscanapi").target).toBe("https://api.etherscan.io");
    expect(routePar("/bgapi").target).toBe("https://bitcoin-data.com");
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

  test("/tdapi : strip préfixe + apikey .env en repli si absente", () => {
    expect(routePar("/tdapi").rewrite("/tdapi/time_series")).toBe("/time_series?apikey=tdkey");
    expect(routePar("/tdapi").rewrite("/tdapi/time_series?symbol=AAPL")).toBe(
      "/time_series?symbol=AAPL&apikey=tdkey",
    );
  });

  test("/tdapi : clé personnelle du front prioritaire pour time_series et quote", () => {
    expect(
      routePar("/tdapi").rewrite("/tdapi/time_series?symbol=AAPL&apikey=personnelle"),
    ).toBe("/time_series?symbol=AAPL&apikey=personnelle");
    expect(routePar("/tdapi").rewrite("/tdapi/quote?symbol=SPY&apikey=personnelle")).toBe(
      "/quote?symbol=SPY&apikey=personnelle",
    );
  });

  test("/tdapi : sans clé personnelle ni .env, aucun apikey vide n'est ajouté", () => {
    const route = construireRoutesProxy({ ...CLES, TWELVE_DATA_KEY: "" }).find(
      (candidate) => candidate.prefix === "/tdapi",
    );
    expect(route?.rewrite("/tdapi/quote?symbol=SPY")).toBe("/quote?symbol=SPY");
  });

  test("/mexcapi : simple strip de préfixe, keyless", () => {
    expect(routePar("/mexcapi").rewrite("/mexcapi/api/v3/ping")).toBe("/api/v3/ping");
    expect(routePar("/mexcapi").rewrite("/mexcapi/api/v3/klines?symbol=BTCUSDT")).toBe(
      "/api/v3/klines?symbol=BTCUSDT",
    );
  });

  test("/ethscanapi : strip préfixe + apikey si absent, clé perso conservée", () => {
    expect(routePar("/ethscanapi").rewrite("/ethscanapi/v2/api?chainid=1&module=stats")).toBe(
      "/v2/api?chainid=1&module=stats&apikey=ethkey",
    );
    expect(routePar("/ethscanapi").rewrite("/ethscanapi/v2/api?apikey=perso")).toBe(
      "/v2/api?apikey=perso",
    );
  });

  test("/sosoapi : strip préfixe (la clé passe par l'en-tête, pas la query)", () => {
    expect(routePar("/sosoapi").rewrite("/sosoapi/openapi/v2/etf/currentEtfDataMetrics")).toBe(
      "/openapi/v2/etf/currentEtfDataMetrics",
    );
  });

  test("/bgapi : strip préfixe (la clé passe par l'en-tête Authorization, pas la query)", () => {
    expect(routePar("/bgapi").rewrite("/bgapi/v1/sopr?startday=2026-01-01&endday=2026-01-02")).toBe(
      "/v1/sopr?startday=2026-01-01&endday=2026-01-02",
    );
  });

  test("aucune route générique /ccdataapi : le préfixe est servi par traiterCcData seul", () => {
    // enregistrerProxy court-circuite /ccdataapi vers traiterCcData, qui recalcule
    // cible/réécriture/validation lui-même : une entrée RouteProxy serait du code mort
    // (rewrite et entetesAmont jamais exécutés en production).
    expect(construireRoutesProxy(CLES).some((route) => route.prefix === "/ccdataapi")).toBe(false);
  });

  test("aucune route générique /cqapi : le préfixe est servi par traiterCryptoQuant seul", () => {
    // Une RouteProxy passerait par traiterProxy, donc par le cache SQLite dont la clé
    // ignore Authorization : une réponse obtenue avec une clé serait resservie à une autre.
    expect(construireRoutesProxy(CLES).some((route) => route.prefix === "/cqapi")).toBe(false);
  });
});

describe("/bgapi — injection d'en-tête Authorization: Bearer", () => {
  const entetesAmont = routePar("/bgapi").entetesAmont;
  if (!entetesAmont) throw new Error("entetesAmont manquant sur /bgapi");

  test("repli .env (Bearer) quand le front n'envoie pas d'Authorization", () => {
    expect(entetesAmont(new Headers())).toEqual({ authorization: "Bearer bgkey" });
  });

  test("clé personnelle du front prioritaire (relayée telle quelle, jamais écrasée)", () => {
    expect(entetesAmont(new Headers({ authorization: "Bearer perso" }))).toEqual({
      authorization: "Bearer perso",
    });
  });

  test("aucune clé nulle part → aucun en-tête (l'amont retombe sur le quota IP)", () => {
    const routes = construireRoutesProxy({ ...CLES, BGEOMETRICS_API_KEY: "" });
    const route = routes.find((r) => r.prefix === "/bgapi");
    expect(route?.entetesAmont?.(new Headers())).toEqual({});
  });
});

describe("traiterCcData — proxy authentifié durci", () => {
  test("borne la destination et relaie seulement Apikey sans cache partagé", async () => {
    let input = "";
    let init: RequestInit | undefined;
    const fetchImpl = async (url: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
      input = String(url);
      init = options;
      return new Response(JSON.stringify({ Data: [] }), {
        headers: { "content-type": "application/json" },
      });
    };
    const req = new Request(
      "http://localhost:8787/ccdataapi/data/overview/v1/historical/marketcap/all-assets/days?limit=2",
      { headers: { authorization: "Apikey personnelle", accept: "application/json" } },
    );

    const response = await traiterCcData(req, new URL(req.url), {
      fetchImpl,
      resoudreHote: async () => ["104.18.25.229"],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(input).toBe(
      "https://min-api.cryptocompare.com/data/overview/v1/historical/marketcap/all-assets/days?limit=2",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe("Apikey personnelle");
    expect(init?.redirect).toBe("manual");
  });

  test("refuse méthode, navigation et clé invalide avant tout fetch", async () => {
    let appels = 0;
    const options = {
      fetchImpl: async (): Promise<Response> => {
        appels += 1;
        return new Response("{}");
      },
      resoudreHote: async () => ["104.18.25.229"],
    };
    const post = new Request("http://localhost:8787/ccdataapi/data/x", {
      method: "POST",
      headers: { authorization: "Apikey personnelle" },
    });
    const navigation = new Request("http://localhost:8787/ccdataapi/data/x", {
      headers: { authorization: "Apikey personnelle", "sec-fetch-mode": "navigate" },
    });
    const invalide = new Request("http://localhost:8787/ccdataapi/data/x", {
      headers: { authorization: "Bearer interdite" },
    });

    expect((await traiterCcData(post, new URL(post.url), options)).status).toBe(405);
    expect((await traiterCcData(navigation, new URL(navigation.url), options)).status).toBe(403);
    expect((await traiterCcData(invalide, new URL(invalide.url), options)).status).toBe(401);
    expect(appels).toBe(0);
  });
});

describe("traiterDefillamaPro — credential isolé et allowlist exacte", () => {
  test("construit le chemin fournisseur seulement après validation et impose no-store", async () => {
    let cible = "";
    const req = new Request("http://localhost:8787/defillamapro/emission/hyperliquid", { headers: { "x-defillama-pro-key": "CLESECRETE" } });
    const response = await traiterDefillamaPro(req, new URL(req.url), {
      fetchImpl: (async (url: RequestInfo | URL) => { cible = String(url); return new Response("{}", { headers: { "content-type": "application/json" } }); }) as typeof fetch,
      resoudreHote: async () => ["104.18.7.88"],
    });
    expect(cible).toBe("https://pro-api.llama.fi/CLESECRETE/api/emission/hyperliquid");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test("refuse hors allowlist et expurge la clé de toute erreur", async () => {
    const bad = new Request("http://localhost:8787/defillamapro/api/entities", { headers: { "x-defillama-pro-key": "CLESECRETE" } });
    expect((await traiterDefillamaPro(bad, new URL(bad.url))).status).toBe(404);
    const req = new Request("http://localhost:8787/defillamapro/emissions", { headers: { "x-defillama-pro-key": "CLESECRETE" } });
    const response = await traiterDefillamaPro(req, new URL(req.url), {
      fetchImpl: (async () => { throw new Error("échec https://pro-api.llama.fi/CLESECRETE/api/emissions"); }) as unknown as typeof fetch,
      resoudreHote: async () => ["104.18.7.88"],
    });
    expect(await response.text()).not.toContain("CLESECRETE");
  });

  test("ne relaie pas le corps d'erreur amont susceptible de contenir la clé", async () => {
    const req = new Request("http://localhost:8787/defillamapro/emissions", { headers: { "x-defillama-pro-key": "CLESECRETE" } });
    const response = await traiterDefillamaPro(req, new URL(req.url), {
      fetchImpl: (async () => new Response('{"error":"https://pro-api.llama.fi/CLESECRETE/api/emissions"}', { status: 401 })) as unknown as typeof fetch,
      resoudreHote: async () => ["104.18.7.88"],
    });
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("CLESECRETE");
  });
});

describe("/sosoapi — injection d'en-tête x-soso-api-key", () => {
  const entetesAmont = routePar("/sosoapi").entetesAmont;
  if (!entetesAmont) throw new Error("entetesAmont manquant sur /sosoapi");

  test("repli .env quand le front n'envoie pas d'en-tête", () => {
    expect(entetesAmont(new Headers())).toEqual({ "x-soso-api-key": "sosokey" });
  });

  test("clé personnelle du front prioritaire (jamais écrasée)", () => {
    expect(entetesAmont(new Headers({ "x-soso-api-key": "perso" }))).toEqual({
      "x-soso-api-key": "perso",
    });
  });

  test("aucune clé nulle part → aucun en-tête (l'amont répond 401)", () => {
    const routes = construireRoutesProxy({ ...CLES, SOSOVALUE_API_KEY: "" });
    const route = routes.find((r) => r.prefix === "/sosoapi");
    expect(route?.entetesAmont?.(new Headers())).toEqual({});
  });
});

describe("extapi — User-Agent par hôte", () => {
  test("SEC EDGAR reçoit un UA conforme (identifiant, pas le UA navigateur générique)", () => {
    const ua = userAgentPourHote("data.sec.gov");
    expect(ua).toContain("AxiomTerminal");
    expect(ua).not.toContain("Mozilla");
    expect(userAgentPourHote("www.sec.gov")).toBe(ua);
  });

  test("hôte non-SEC reçoit le UA navigateur générique inchangé", () => {
    expect(userAgentPourHote("mempool.space")).toContain("Mozilla");
  });
});

describe("extapi — whitelist (mise à jour Lot E1)", () => {
  test("nouveaux hôtes présents", () => {
    expect(EXTAPI_WHITELIST.has("data.sec.gov")).toBe(true);
    expect(EXTAPI_WHITELIST.has("www.sec.gov")).toBe(true);
    expect(EXTAPI_WHITELIST.has("api.gdeltproject.org")).toBe(true);
    expect(EXTAPI_WHITELIST.has("api.coinmarketcap.com")).toBe(true);
  });
});

describe("extapi — whitelist (ajout courbes JGB/RBA + bandeau news macro)", () => {
  test("nouveaux hôtes présents", () => {
    expect(EXTAPI_WHITELIST.has("www.mof.go.jp")).toBe(true); // CSV JGB (MOF Japon)
    expect(EXTAPI_WHITELIST.has("www.rba.gov.au")).toBe(true); // CSV F2 (RBA Australie)
    expect(EXTAPI_WHITELIST.has("feeds.bloomberg.com")).toBe(true); // RSS Bloomberg economics
    expect(EXTAPI_WHITELIST.has("www.cnbc.com")).toBe(true); // RSS CNBC Economy
  });
  test("CNBC reçoit le UA navigateur par défaut (exigé par Akamai, aucun UA dédié)", () => {
    expect(userAgentPourHote("www.cnbc.com")).toContain("Mozilla");
  });
});

describe("extapi — whitelist (ajout globe : OpenSky)", () => {
  test("opensky-network.org présent (CORS restreint à sa propre origine → proxy obligatoire)", () => {
    expect(EXTAPI_WHITELIST.has("opensky-network.org")).toBe(true);
  });
  test("services9.arcgis.com ABSENT (PortWatch : CORS « * » vérifié → appel direct, pas de proxy)", () => {
    expect(EXTAPI_WHITELIST.has("services9.arcgis.com")).toBe(false);
  });
  test("TTL cache OpenSky = 90 s (< poll front 120 s — un TTL égal au poll resservait un instantané sur deux)", () => {
    expect(ttlMsExtapi("opensky-network.org")).toBe(90_000);
  });
});

describe("extapi — whitelist (présence des 23 hôtes existants)", () => {
  test("contient les 23 hôtes attendus (dont Fear&Greed, Binance fapi/dapi, macro souverain/COT/GEX)", () => {
    for (const hote of [
      "nfs.faireconomy.media",
      "www.coindesk.com",
      "cointelegraph.com",
      "www.theblock.co",
      "decrypt.co",
      "blockworks.com",
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
      "home.treasury.gov",
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

describe("extapi — politique réseau SSRF", () => {
  test("accepte des IPv4/IPv6 publiques", () => {
    expect(adresseIpPublique("8.8.8.8")).toBe(true);
    expect(adresseIpPublique("2606:4700:4700::1111")).toBe(true);
    expect(adresseIpPublique("::ffff:8.8.8.8")).toBe(true);
  });

  test("refuse loopback, privées, link-local, CGNAT, documentation et IPv4 mappée privée", () => {
    for (const adresse of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "192.0.2.1",
      "::1",
      "fe80::1",
      "fc00::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
      "64:ff9b::7f00:1",
    ]) {
      expect(adresseIpPublique(adresse)).toBe(false);
    }
  });
});

describe("extapi — politique MIME et contexte Fetch", () => {
  test("accepte les formats de données utilisés par AXIOM", () => {
    for (const mime of [
      "application/json; charset=utf-8",
      "application/problem+json",
      "application/rss+xml",
      "application/vnd.vendor+xml",
      "text/csv",
      "application/octet-stream",
    ]) {
      expect(mimeExtapiAutorise(mime)).toBe(true);
    }
  });

  test("refuse les types actifs ou documentaires", () => {
    for (const mime of ["text/html", "image/svg+xml", "text/javascript", "text/css", "application/pdf"]) {
      expect(mimeExtapiAutorise(mime)).toBe(false);
    }
  });

  test("refuse document, iframe, script et mode navigate, mais autorise fetch API", () => {
    for (const destination of ["document", "iframe", "script", "worker"]) {
      expect(
        requeteNavigationExtapiInterdite(
          new Request("http://localhost/extapi/data.sec.gov/x", {
            headers: { "sec-fetch-dest": destination },
          }),
        ),
      ).toBe(true);
    }
    expect(
      requeteNavigationExtapiInterdite(
        new Request("http://localhost/extapi/data.sec.gov/x", {
          headers: { "sec-fetch-mode": "navigate" },
        }),
      ),
    ).toBe(true);
    expect(
      requeteNavigationExtapiInterdite(
        new Request("http://localhost/extapi/data.sec.gov/x", {
          headers: { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" },
        }),
      ),
    ).toBe(false);
  });
});

describe("recupererExtapiSecurise", () => {
  const resoudrePublic = async (): Promise<readonly string[]> => ["93.184.216.34"];

  test("suit manuellement un redirect whitelisté après revalidation", async () => {
    const appels: Array<{ url: string; redirect?: RequestRedirect }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      appels.push({ url: String(input), redirect: init?.redirect });
      if (appels.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://data.sec.gov/submissions/CIK.json" },
        });
      }
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    });

    const res = await recupererExtapiSecurise("https://www.sec.gov/files/company_tickers.json", {
      fetchImpl,
      resoudreHote: resoudrePublic,
    });

    expect(appels).toEqual([
      { url: "https://www.sec.gov/files/company_tickers.json", redirect: "manual" },
      { url: "https://data.sec.gov/submissions/CIK.json", redirect: "manual" },
    ]);
    expect(new TextDecoder().decode(res.corps)).toBe('{"ok":true}');
  });

  test("bloque un redirect vers un hôte hors whitelist avant le second fetch", async () => {
    let appels = 0;
    const fetchImpl = (async () => {
      appels += 1;
      return new Response(null, { status: 302, headers: { location: "https://evil.example/secret" } });
    });

    await expect(
      recupererExtapiSecurise("https://www.sec.gov/start", {
        fetchImpl,
        resoudreHote: resoudrePublic,
      }),
    ).rejects.toThrow("hôte de redirection non autorisé");
    expect(appels).toBe(1);
  });

  test("bloque un hôte whitelisté si sa résolution devient privée sur un redirect", async () => {
    let appels = 0;
    const fetchImpl = (async () => {
      appels += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "https://data.sec.gov/private" },
      });
    });

    await expect(
      recupererExtapiSecurise("https://www.sec.gov/start", {
        fetchImpl,
        resoudreHote: async (hote) => (hote === "data.sec.gov" ? ["127.0.0.1"] : ["93.184.216.34"]),
      }),
    ).rejects.toThrow("destination DNS non publique refusée");
    expect(appels).toBe(1);
  });

  test("bloque une résolution initiale privée avant tout fetch", async () => {
    let appels = 0;
    const fetchImpl = (async () => {
      appels += 1;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    });

    await expect(
      recupererExtapiSecurise("https://data.sec.gov/x", {
        fetchImpl,
        resoudreHote: async () => ["169.254.169.254"],
      }),
    ).rejects.toThrow("destination DNS non publique refusée");
    expect(appels).toBe(0);
  });

  test("refuse HTML avant de matérialiser le corps", async () => {
    const fetchImpl = async () =>
      new Response("<h1>non</h1>", { headers: { "content-type": "text/html" } });
    await expect(
      recupererExtapiSecurise("https://data.sec.gov/x", {
        fetchImpl,
        resoudreHote: resoudrePublic,
      }),
    ).rejects.toThrow("type MIME amont refusé");
  });

  test("borne la taille réelle même sans Content-Length", async () => {
    const flux = new ReadableStream<Uint8Array>({
      start(controleur) {
        controleur.enqueue(new TextEncoder().encode("123"));
        controleur.enqueue(new TextEncoder().encode("456"));
        controleur.close();
      },
    });
    const fetchImpl = async () =>
      new Response(flux, { headers: { "content-type": "application/octet-stream" } });
    await expect(
      recupererExtapiSecurise("https://data.sec.gov/x", {
        fetchImpl,
        resoudreHote: resoudrePublic,
        tailleMaxCorps: 5,
      }),
    ).rejects.toThrow("corps amont trop volumineux");
  });

  test("applique un timeout global au fetch amont", async () => {
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return reject(new Error("signal absent"));
        const refuser = () => reject(signal.reason);
        if (signal.aborted) refuser();
        else signal.addEventListener("abort", refuser, { once: true });
      });

    await expect(
      recupererExtapiSecurise("https://data.sec.gov/x", {
        fetchImpl,
        resoudreHote: resoudrePublic,
        timeoutMs: 5,
      }),
    ).rejects.toBeDefined();
  });

  test("applique aussi le timeout global à la résolution DNS", async () => {
    let appelsFetch = 0;
    const fetchImpl = (async () => {
      appelsFetch += 1;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    });

    await expect(
      recupererExtapiSecurise("https://data.sec.gov/x", {
        fetchImpl,
        resoudreHote: () => new Promise<readonly string[]>(() => {}),
        timeoutMs: 5,
      }),
    ).rejects.toBeDefined();
    expect(appelsFetch).toBe(0);
  });

  test("le timeout global n'est PAS une erreur de politique (libellé « amont injoignable »)", async () => {
    // `traiterExtapi` choisit son libellé sur `err instanceof ErreurPolitiqueExtapi` :
    // un timeout doit rester un problème d'accès amont, pas un refus de politique.
    // Verrouille aussi le choix d'un Error nu comme raison d'abort (cf. proxy.ts).
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });

    const erreur = await recupererExtapiSecurise("https://data.sec.gov/x", {
      fetchImpl,
      resoudreHote: resoudrePublic,
      timeoutMs: 5,
    }).catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(Error);
    // `ErreurPolitiqueExtapi` n'est pas exportée (et n'a pas à l'être pour un test) :
    // on vérifie que la raison est un Error NU, ce qui exclut toute sous-classe.
    expect((erreur as Error).constructor.name).toBe("Error");
    expect((erreur as Error).message).toContain("timeout amont");
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
  test("navigation document → 403 avec nosniff, sans cache ni fetch", async () => {
    const url = new URL("http://127.0.0.1:8787/extapi/data.sec.gov/x");
    const res = await traiterExtapi(
      new Request(url, { headers: { "sec-fetch-dest": "document" } }),
      url,
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
  });
  test("un fetch API conserve le cache et reçoit les en-têtes de défense", async () => {
    const url = new URL("http://127.0.0.1:8787/extapi/data.sec.gov/x");
    const res = await traiterExtapi(
      new Request(url, { headers: { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" } }),
      url,
      {
        lireCacheImpl: () => ({
          corps: new TextEncoder().encode('{"ok":true}'),
          contentType: "application/json; charset=utf-8",
        }),
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-axiomd-cache")).toBe("hit");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("traiterProxy — cache SQLite en panne = optimisation, jamais une panne de route", () => {
  const route = routePar("/tdapi"); // helper déjà présent en tête de proxy.test.ts
  const resoudrePublic = async (): Promise<readonly string[]> => ["93.184.216.34"];
  const fetchImpl = async () =>
    new Response(JSON.stringify({ status: "ok" }), {
      headers: { "content-type": "application/json" },
    });

  test("lireCache qui lève → miss forcé, la réponse amont saine est servie (200)", async () => {
    const req = new Request("http://localhost:8787/tdapi/quote?symbol=AAPL");
    const rep = await traiterProxy(req, new URL(req.url), route, {
      fetchImpl,
      resoudreHote: resoudrePublic,
      lireCacheImpl: () => {
        throw new Error("SQLITE_CORRUPT");
      },
      ecrireCacheImpl: () => {},
    });
    expect(rep.status).toBe(200);
    expect(rep.headers.get("x-axiomd-cache")).toBe("miss");
    expect(await rep.json()).toEqual({ status: "ok" });
  });

  test("ecrireCache qui lève → la réponse amont est quand même servie (200)", async () => {
    const req = new Request("http://localhost:8787/tdapi/quote?symbol=AAPL");
    const rep = await traiterProxy(req, new URL(req.url), route, {
      fetchImpl,
      resoudreHote: resoudrePublic,
      lireCacheImpl: () => null,
      ecrireCacheImpl: () => {
        throw new Error("SQLITE_FULL");
      },
    });
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ status: "ok" });
  });

  test("amont qui blackhole (ne répond jamais) → 502 au timeout, pas d'attente infinie", async () => {
    const fetchQuiPend = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        // Ne se résout QUE sur abort : sans timeout explicite, la requête pendrait à jamais.
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const req = new Request("http://localhost:8787/tdapi/quote?symbol=AAPL");
    const rep = await traiterProxy(req, new URL(req.url), route, {
      fetchImpl: fetchQuiPend,
      resoudreHote: resoudrePublic,
      lireCacheImpl: () => null,
      ecrireCacheImpl: () => {},
      timeoutMs: 20,
    });
    expect(rep.status).toBe(502);
    const corps = (await rep.json()) as { erreur: string; detail: string };
    expect(corps.erreur).toBe("amont injoignable");
    expect(corps.detail).toContain("timeout amont proxy dépassé");
  });
});

describe("traiterProxy — politique des proxys fixes (réutilise /extapi)", () => {
  const resoudrePublic = async (): Promise<readonly string[]> => ["93.184.216.34"];

  test("injection HTML active via /fredapi ⇒ bloquée avant le corps", async () => {
    const fetchImpl = async () =>
      new Response("<html><script>alert(1)</script></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    const req = new Request("http://localhost:8787/fredapi/fred/series");
    const rep = await traiterProxy(req, new URL(req.url), routePar("/fredapi"), {
      fetchImpl,
      resoudreHote: resoudrePublic,
      lireCacheImpl: () => null,
      ecrireCacheImpl: () => {},
    });
    expect(rep.status).toBe(502);
    const texte = await rep.text();
    expect(texte).not.toContain("<html");
    expect(texte).toContain("type MIME");
    expect(rep.headers.get("x-content-type-options")).toBe("nosniff");
    expect(rep.headers.get("content-security-policy")).toContain("sandbox");
  });

  test("redirection hors hôte original ⇒ refusée, second fetch jamais lancé", async () => {
    let appels = 0;
    const fetchImpl = async () => {
      appels += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/secret" },
      });
    };
    const req = new Request("http://localhost:8787/tdapi/quote?symbol=AAPL");
    const rep = await traiterProxy(req, new URL(req.url), routePar("/tdapi"), {
      fetchImpl,
      resoudreHote: resoudrePublic,
      lireCacheImpl: () => null,
      ecrireCacheImpl: () => {},
    });
    expect(rep.status).toBe(502);
    const corps = (await rep.json()) as { detail: string };
    expect(corps.detail).toContain("hôte de redirection non autorisé");
    expect(appels).toBe(1);
  });

  test("POST vers un endpoint non-SoSoValue ⇒ 405, zéro fetch", async () => {
    let appels = 0;
    const fetchImpl = async () => {
      appels += 1;
      return new Response("{}");
    };
    const req = new Request("http://localhost:8787/tdapi/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x: 1 }),
    });
    const rep = await traiterProxy(req, new URL(req.url), routePar("/tdapi"), {
      fetchImpl,
      resoudreHote: resoudrePublic,
    });
    expect(rep.status).toBe(405);
    expect(appels).toBe(0);
  });

  test("POST SoSoValue hors currentEtfDataMetrics ⇒ 405", async () => {
    let appels = 0;
    const req = new Request("http://localhost:8787/sosoapi/openapi/v2/etf/autre", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "us-btc-spot" }),
    });
    const rep = await traiterProxy(req, new URL(req.url), routePar("/sosoapi"), {
      fetchImpl: async () => {
        appels += 1;
        return new Response("{}");
      },
      resoudreHote: resoudrePublic,
    });
    expect(rep.status).toBe(405);
    expect(appels).toBe(0);
  });

  test("POST JSON currentEtfDataMetrics est relayé", async () => {
    const appels: Array<{ method?: string; url: string }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      appels.push({ method: init?.method, url: String(input) });
      return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    };
    const req = new Request("http://localhost:8787/sosoapi/openapi/v2/etf/currentEtfDataMetrics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "us-btc-spot" }),
    });
    const rep = await traiterProxy(req, new URL(req.url), routePar("/sosoapi"), {
      fetchImpl,
      resoudreHote: resoudrePublic,
    });
    expect(rep.status).toBe(200);
    expect(appels).toEqual([
      {
        method: "POST",
        url: "https://openapi.sosovalue.com/openapi/v2/etf/currentEtfDataMetrics",
      },
    ]);
  });
});

describe("traiterCryptoQuant — licence personnelle, liste fermée, jamais en cache", () => {
  const LOCAL = "http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30";
  const CIBLE = "https://api.cryptoquant.com/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30";
  const resoudrePublic = async (): Promise<readonly string[]> => ["104.18.10.10"];

  interface AppelAmont {
    url: string;
    authorization: string | null;
    redirect: RequestRedirect | undefined;
  }

  /** Amont simulé : mémorise l'URL, l'Authorization et le mode de redirection de chaque appel. */
  function amontSimule(repondre: () => Response): { appels: AppelAmont[]; fetchImpl: FetchExtapi } {
    const appels: AppelAmont[] = [];
    const fetchImpl: FetchExtapi = async (input, init) => {
      appels.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        redirect: init?.redirect,
      });
      return repondre();
    };
    return { appels, fetchImpl };
  }

  const corps200 = { status: { code: 200, message: "success" }, result: { window: "DAY", data: [] } };
  const reponse200 = (): Response =>
    new Response(JSON.stringify(corps200), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=600",
        "x-ratelimit-limit": "10",
        "x-ratelimit-remaining": "9",
        "x-ratelimit-reset": "6",
        "x-autre": "non-relaye",
      },
    });

  test("URL amont exacte, Bearer personnel relayé, redirect manual, private no-store, quota exposé", async () => {
    const { appels, fetchImpl } = amontSimule(reponse200);
    const req = new Request(LOCAL, {
      headers: { authorization: "Bearer CLE-TEST-SECRETE", origin: "http://localhost:5173" },
    });
    const rep = await traiterCryptoQuant(req, new URL(req.url), "envkey", { fetchImpl, resoudreHote: resoudrePublic });

    expect(rep.status).toBe(200);
    expect(appels).toEqual([{ url: CIBLE, authorization: "Bearer CLE-TEST-SECRETE", redirect: "manual" }]);
    expect(rep.headers.get("cache-control")).toBe("private, no-store");
    expect(rep.headers.get("x-content-type-options")).toBe("nosniff");
    expect(rep.headers.get("x-ratelimit-limit")).toBe("10");
    expect(rep.headers.get("x-ratelimit-remaining")).toBe("9");
    expect(rep.headers.get("x-ratelimit-reset")).toBe("6");
    expect(rep.headers.has("x-autre")).toBe(false);
    expect(rep.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(rep.headers.get("access-control-expose-headers")).toBe(
      "x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset",
    );
    expect(await rep.json()).toEqual(corps200);
  });

  test("normalise la query amont (ordre miner, window, limit)", async () => {
    const { appels, fetchImpl } = amontSimule(reponse200);
    const req = new Request("http://127.0.0.1:8787/cqapi/v1/btc/miner-data/companies?limit=30&window=day&miner=mara", {
      headers: { authorization: "Bearer CLE-TEST-SECRETE" },
    });
    const rep = await traiterCryptoQuant(req, new URL(req.url), "", { fetchImpl, resoudreHote: resoudrePublic });
    expect(rep.status).toBe(200);
    expect(appels.map((appel) => appel.url)).toEqual([
      "https://api.cryptoquant.com/v1/btc/miner-data/companies?miner=mara&window=day&limit=30",
    ]);
  });

  test("relaie le statut et le corps d'un refus amont (403 d'offre)", async () => {
    const corps = { status: { code: 403, message: "This metric requires Professional plan and above." } };
    const { fetchImpl } = amontSimule(
      () => new Response(JSON.stringify(corps), { status: 403, headers: { "content-type": "application/json" } }),
    );
    const req = new Request(LOCAL, { headers: { authorization: "Bearer CLE-TEST-SECRETE" } });
    const rep = await traiterCryptoQuant(req, new URL(req.url), "", { fetchImpl, resoudreHote: resoudrePublic });
    expect(rep.status).toBe(403);
    expect(rep.headers.get("cache-control")).toBe("private, no-store");
    expect(await rep.json()).toEqual(corps);
  });

  test("refus 403, 405, 401 puis 404 AVANT tout fetch", async () => {
    const { appels, fetchImpl } = amontSimule(reponse200);
    const options = { fetchImpl, resoudreHote: resoudrePublic };
    const bearer = { authorization: "Bearer CLE-TEST-SECRETE" };
    const cas: Array<{ req: Request; cleEnv: string; statut: number }> = [
      { req: new Request(LOCAL, { headers: { ...bearer, "sec-fetch-mode": "navigate" } }), cleEnv: "envkey", statut: 403 },
      { req: new Request(LOCAL, { headers: { ...bearer, "sec-fetch-dest": "script" } }), cleEnv: "envkey", statut: 403 },
      { req: new Request(LOCAL, { method: "POST", headers: bearer }), cleEnv: "envkey", statut: 405 },
      { req: new Request(LOCAL, { method: "HEAD", headers: bearer }), cleEnv: "envkey", statut: 405 },
      // Méthode contrôlée avant la clé : un POST sans aucune clé reste un 405.
      { req: new Request(LOCAL, { method: "POST" }), cleEnv: "", statut: 405 },
      { req: new Request(LOCAL), cleEnv: "", statut: 401 },
      { req: new Request(LOCAL, { headers: { authorization: "Apikey CLE-TEST-SECRETE" } }), cleEnv: "", statut: 401 },
      { req: new Request(LOCAL, { headers: { authorization: `Bearer ${"x".repeat(600)}` } }), cleEnv: "", statut: 401 },
      // Clé avant chemin : un chemin hors liste sans aucune clé reste un 401.
      { req: new Request("http://127.0.0.1:8787/cqapi/v1/btc/market-indicator/mvrv?window=day"), cleEnv: "", statut: 401 },
      // Repli `.env` mal formé : traité comme absent (401 local, aucune exception d'en-tête).
      { req: new Request(LOCAL), cleEnv: "\nenvkey", statut: 401 },
      { req: new Request(LOCAL), cleEnv: "env\nkey", statut: 401 },
      { req: new Request(LOCAL), cleEnv: "env key", statut: 401 },
      {
        req: new Request("http://127.0.0.1:8787/cqapi/v1/btc/exchange-flows/reserve?exchange=all_exchange&window=day", { headers: bearer }),
        cleEnv: "envkey",
        statut: 404,
      },
      { req: new Request(`${LOCAL}&from=20260901`, { headers: bearer }), cleEnv: "envkey", statut: 404 },
      { req: new Request("http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=sol_all&window=day"), cleEnv: "envkey", statut: 404 },
      {
        req: new Request("http://127.0.0.1:8787/cqapi//v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30", { headers: bearer }),
        cleEnv: "envkey",
        statut: 404,
      },
      {
        req: new Request("http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=btc_all&miner=mara&window=day", { headers: bearer }),
        cleEnv: "envkey",
        statut: 404,
      },
    ];
    for (const { req, cleEnv, statut } of cas) {
      const rep = await traiterCryptoQuant(req, new URL(req.url), cleEnv, options);
      expect(rep.status).toBe(statut);
      expect(rep.headers.get("cache-control")).toBe("private, no-store");
      expect(rep.headers.get("allow")).toBe(statut === 405 ? "GET" : null);
      expect(await rep.text()).not.toContain("CLE-TEST-SECRETE");
    }
    expect(appels).toHaveLength(0);
  });

  test("zéro redirection : un 302 amont donne un 502 après un seul appel, sans jeton ni Location", async () => {
    const { appels, fetchImpl } = amontSimule(
      () =>
        new Response("<p>déplacé</p>", {
          status: 302,
          headers: {
            location: "https://api.cryptoquant.com/v1/btc/market-indicator/mvrv?window=day",
            "content-type": "text/html",
            "set-cookie": "amont=1",
          },
        }),
    );
    const req = new Request(LOCAL, { headers: { authorization: "Bearer CLE-TEST-SECRETE" } });
    const rep = await traiterCryptoQuant(req, new URL(req.url), "", { fetchImpl, resoudreHote: resoudrePublic });
    expect(rep.status).toBe(502);
    expect(appels).toEqual([{ url: CIBLE, authorization: "Bearer CLE-TEST-SECRETE", redirect: "manual" }]);
    expect(rep.headers.get("location")).toBeNull();
    expect(rep.headers.get("set-cookie")).toBeNull();
    expect(rep.headers.get("cache-control")).toBe("private, no-store");
    const corps = await rep.text();
    expect(corps).not.toContain("CLE-TEST-SECRETE");
    expect(corps).not.toContain("déplacé");
    expect(JSON.parse(corps)).toMatchObject({ erreur: "amont CryptoQuant refusé" });
  });

  test("429 JSON amont : statut, corps et trois en-têtes x-ratelimit-* relayés", async () => {
    const corps = { status: { code: 429, message: "Too Many Requests" } };
    const { appels, fetchImpl } = amontSimule(
      () =>
        new Response(JSON.stringify(corps), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "x-ratelimit-limit": "10",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "42",
            "retry-after": "42",
          },
        }),
    );
    const req = new Request(LOCAL, { headers: { authorization: "Bearer CLE-TEST-SECRETE", origin: "http://localhost:5173" } });
    const rep = await traiterCryptoQuant(req, new URL(req.url), "", { fetchImpl, resoudreHote: resoudrePublic });
    expect(appels).toHaveLength(1);
    expect(rep.status).toBe(429);
    expect(rep.headers.get("x-ratelimit-limit")).toBe("10");
    expect(rep.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(rep.headers.get("x-ratelimit-reset")).toBe("42");
    expect(rep.headers.get("access-control-expose-headers")).toBe(
      "x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset",
    );
    expect(rep.headers.get("cache-control")).toBe("private, no-store");
    expect(await rep.json()).toEqual(corps);
  });

  test("repli .env sans en-tête, en-tête invalide remplacé, en-tête personnel prioritaire", async () => {
    const { appels, fetchImpl } = amontSimule(reponse200);
    const options = { fetchImpl, resoudreHote: resoudrePublic };
    const sansEntete = new Request(LOCAL);
    const invalide = new Request(LOCAL, { headers: { authorization: "Basic xyz" } });
    const perso = new Request(LOCAL, { headers: { authorization: "Bearer perso" } });
    expect((await traiterCryptoQuant(sansEntete, new URL(sansEntete.url), "envkey", options)).status).toBe(200);
    expect((await traiterCryptoQuant(invalide, new URL(invalide.url), "envkey", options)).status).toBe(200);
    expect((await traiterCryptoQuant(perso, new URL(perso.url), "envkey", options)).status).toBe(200);
    expect(appels.map((appel) => appel.authorization)).toEqual(["Bearer envkey", "Bearer envkey", "Bearer perso"]);
  });

  test("aucune sortie console ni réponse ne contient l'Authorization", async () => {
    const sorties: string[] = [];
    const capturer = (...args: unknown[]): void => {
      sorties.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack ?? ""}` : String(arg))).join(" "));
    };
    const espions = [
      spyOn(console, "log").mockImplementation(capturer),
      spyOn(console, "info").mockImplementation(capturer),
      spyOn(console, "warn").mockImplementation(capturer),
      spyOn(console, "error").mockImplementation(capturer),
      spyOn(console, "debug").mockImplementation(capturer),
    ];
    try {
      const perso = new Request(LOCAL, { headers: { authorization: "Bearer CLE-TEST-SECRETE" } });
      const panne = await traiterCryptoQuant(perso, new URL(perso.url), "", {
        fetchImpl: async () => {
          throw new Error("échec amont avec Bearer CLE-TEST-SECRETE");
        },
        resoudreHote: resoudrePublic,
      });
      expect(panne.status).toBe(502);
      expect(await panne.text()).not.toContain("CLE-TEST-SECRETE");

      const repli = new Request(LOCAL);
      const panneRepli = await traiterCryptoQuant(repli, new URL(repli.url), "CLE-ENV-SECRETE", {
        fetchImpl: async () => {
          throw new Error("échec amont avec Bearer CLE-ENV-SECRETE");
        },
        resoudreHote: resoudrePublic,
      });
      expect(panneRepli.status).toBe(502);
      expect(await panneRepli.text()).not.toContain("CLE-ENV-SECRETE");

      const encore = new Request(LOCAL, { headers: { authorization: "Bearer CLE-TEST-SECRETE" } });
      const succes = await traiterCryptoQuant(encore, new URL(encore.url), "", {
        fetchImpl: amontSimule(reponse200).fetchImpl,
        resoudreHote: resoudrePublic,
      });
      expect(succes.status).toBe(200);
    } finally {
      for (const espion of espions) espion.mockRestore();
    }
    expect(sorties.join("\n")).not.toContain("CLE-TEST-SECRETE");
    expect(sorties.join("\n")).not.toContain("CLE-ENV-SECRETE");
  });

  test("le corps de traiterCryptoQuant ne référence ni lireCache ni ecrireCache (lecture de la source)", async () => {
    // Des espions de cache injectés par les options ne prouveraient rien : un appel direct
    // aux fonctions importées de ./cache les contournerait. On lit donc la source, de la
    // déclaration jusqu'à la fonction de premier niveau suivante.
    const source = await Bun.file(new URL("./proxy.ts", import.meta.url)).text();
    const declaration = "export async function traiterCryptoQuant(";
    const debut = source.indexOf(declaration);
    expect(debut).toBeGreaterThan(-1);
    const reste = source.slice(debut + declaration.length);
    const fin = reste.search(/\n(?:export )?(?:async )?function \w+[(<]/);
    expect(fin).toBeGreaterThan(0);
    const corps = reste.slice(0, fin);
    // Garde-fou du découpage : une tranche vide ou mal placée passerait sinon.
    expect(corps).toContain("cheminCryptoQuantAmont(");
    expect(corps).toContain("recupererExtapiSecurise(");
    expect(corps).not.toContain("lireCache");
    expect(corps).not.toContain("ecrireCache");
  });

  test("enregistrerProxy branche /cqapi sur traiterCryptoQuant (refus locaux, sans réseau)", async () => {
    const routeur = new Routeur();
    enregistrerProxy(routeur, CLES);
    const adresse = new URL(LOCAL);
    const post = await routeur.gerer(new Request(adresse, { method: "POST" }), adresse);
    expect(post?.status).toBe(405);
    expect(post?.headers.get("allow")).toBe("GET");
    // Repli « cqkey » présent dans CLES : le refus vient de la liste fermée, pas de la clé.
    const horsListe = new URL("http://127.0.0.1:8787/cqapi/v1/btc/market-indicator/mvrv?window=day");
    const refus = await routeur.gerer(new Request(horsListe), horsListe);
    expect(refus?.status).toBe(404);
  });
});
