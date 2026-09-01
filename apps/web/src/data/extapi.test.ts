import { describe, expect, it } from "vitest";
import { estHoteExtapiAutorise, EXTAPI_WHITELIST, extUrl, extUrlPourDeployment } from "./extapi";

describe("extUrl", () => {
  it("construit une URL relative /extapi/<hote>/<chemin>", () => {
    expect(extUrl("api.alternative.me", "fng/")).toBe("/extapi/api.alternative.me/fng/");
  });
  it("absorbe un slash en tête de chemin (pas de double slash)", () => {
    expect(extUrl("api.llama.fi", "/overview/fees")).toBe("/extapi/api.llama.fi/overview/fees");
  });
  it("laisse passer un query string tel quel", () => {
    expect(extUrl("fapi.binance.com", "fapi/v1/premiumIndex?symbol=BTCUSDT")).toBe(
      "/extapi/fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT",
    );
  });
  it("appelle fapi directement sur Vercel pour éviter le 451 des IP serverless", () => {
    expect(extUrlPourDeployment("fapi.binance.com", "/fapi/v1/premiumIndex?symbol=BTCUSDT", true)).toBe(
      "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT",
    );
  });
  it("conserve le proxy Vercel pour les autres hôtes", () => {
    expect(extUrlPourDeployment("api.alternative.me", "fng/", true)).toBe(
      "/extapi/api.alternative.me/fng/",
    );
  });
});

describe("estHoteExtapiAutorise", () => {
  it("vrai pour un hôte de la whitelist", () => {
    expect(estHoteExtapiAutorise("www.deribit.com")).toBe(true);
  });
  it("faux hors whitelist", () => {
    expect(estHoteExtapiAutorise("evil.com")).toBe(false);
  });
  it("whitelist = 34 hôtes", () => {
    expect(EXTAPI_WHITELIST.length).toBe(34);
    expect(estHoteExtapiAutorise("api.coinmarketcap.com")).toBe(true);
  });
  it("inclut home.treasury.gov (courbe des taux US)", () => {
    expect(estHoteExtapiAutorise("home.treasury.gov")).toBe(true);
  });
  it("inclut opensky-network.org (trafic aérien — globe)", () => {
    expect(estHoteExtapiAutorise("opensky-network.org")).toBe(true);
  });
});
