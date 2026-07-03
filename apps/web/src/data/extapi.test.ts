import { describe, expect, it } from "vitest";
import { estHoteExtapiAutorise, EXTAPI_WHITELIST, extUrl } from "./extapi";

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
});

describe("estHoteExtapiAutorise", () => {
  it("vrai pour un hôte de la whitelist", () => {
    expect(estHoteExtapiAutorise("www.deribit.com")).toBe(true);
  });
  it("faux hors whitelist", () => {
    expect(estHoteExtapiAutorise("evil.com")).toBe(false);
  });
  it("whitelist = 22 hôtes", () => {
    expect(EXTAPI_WHITELIST.length).toBe(22);
  });
});
