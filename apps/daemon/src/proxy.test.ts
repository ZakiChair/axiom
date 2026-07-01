import { describe, expect, test } from "bun:test";
import { appendApiKeyIfAbsent, construireRoutesProxy, type RouteProxy } from "./proxy";
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
