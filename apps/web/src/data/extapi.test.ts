import { beforeEach, describe, expect, it, vi } from "vitest";

// Le routage vers le daemon est un test SYNCHRONE de l'état déjà sondé : on pilote
// `daemonSupporte` depuis le test (faux par défaut = comportement sans daemon).
const { supporteSpy } = vi.hoisted(() => ({ supporteSpy: vi.fn(() => false) }));
vi.mock("./daemon", () => ({
  daemonSupporte: supporteSpy,
  urlDaemon: (chemin: string) => `http://127.0.0.1:8787${chemin}`,
}));

import { estHoteExtapiAutorise, EXTAPI_WHITELIST, extUrl, extUrlPourDeployment } from "./extapi";

beforeEach(() => {
  supporteSpy.mockReturnValue(false);
});

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

describe("extUrl — routage vers le daemon (cache /extapi)", () => {
  it("route vers le daemon quand il annonce la capability proxy", () => {
    supporteSpy.mockReturnValue(true);
    expect(extUrl("api.alternative.me", "fng/")).toBe(
      "http://127.0.0.1:8787/extapi/api.alternative.me/fng/",
    );
    expect(supporteSpy).toHaveBeenCalledWith("proxy");
  });

  it("sans daemon, le chemin relatif reste STRICTEMENT inchangé", () => {
    expect(extUrl("api.alternative.me", "fng/")).toBe("/extapi/api.alternative.me/fng/");
  });

  it("l'exception fapi de Vercel prime sur le routage daemon (base ignorée)", () => {
    expect(
      extUrlPourDeployment("fapi.binance.com", "fapi/v1/klines", true, "http://127.0.0.1:8787"),
    ).toBe("https://fapi.binance.com/fapi/v1/klines");
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
