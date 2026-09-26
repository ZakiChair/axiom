/**
 * Tests du cache module de la chaîne d'options Deribit (data/chaineOptionsCache.ts) : TTL de
 * 10 min par devise, promesses en vol partagées, échec et chaîne vide jamais mis en cache,
 * spot de la chaîne (définition `spotChaine` d'OMON) et éligibilité d'un marché du chart
 * (BTC/ETH cotés en dollar, sources crypto non synthétiques).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { OptionPoint } from "./deribit";
import {
  TTL_CHAINE_MS,
  _viderCacheChaineOptions,
  actifDeribit,
  chargerChaineOptions,
  spotDeChaine,
} from "./chaineOptionsCache";

const NOW = Date.UTC(2026, 8, 14, 18);

function point(partiel: Partial<OptionPoint> = {}): OptionPoint {
  return {
    instrument: "BTC-25SEP26-80000-C",
    expiryMs: Date.UTC(2026, 8, 25, 8),
    strike: 80_000,
    type: "call",
    markIv: 40,
    openInterest: 10,
    underlying: 79_000,
    interestRate: 0,
    volume24h: 1,
    markPrice: 0.02,
    ...partiel,
  };
}

/** Fetcher instrumenté : compte les appels par devise, réponse contrôlable. */
function fetcherFactice(reponse: (devise: "BTC" | "ETH") => Promise<OptionPoint[]> = async () => [point()]) {
  const appels: ("BTC" | "ETH")[] = [];
  return {
    appels,
    fetcher: (devise: "BTC" | "ETH") => {
      appels.push(devise);
      return reponse(devise);
    },
  };
}

beforeEach(() => _viderCacheChaineOptions());

describe("chargerChaineOptions", () => {
  it("TTL de 10 min par devise : un seul appel dans la fenêtre, nouvel appel après", async () => {
    const f = fetcherFactice();
    const a = await chargerChaineOptions("BTC", NOW, f.fetcher);
    const b = await chargerChaineOptions("BTC", NOW + TTL_CHAINE_MS - 1, f.fetcher);
    expect(TTL_CHAINE_MS).toBe(600_000);
    expect(f.appels).toEqual(["BTC"]);
    expect(b).toBe(a);
    expect(a?.recupereLe).toBe(NOW);
    expect(a?.chaine).toHaveLength(1);

    await chargerChaineOptions("ETH", NOW, f.fetcher);
    expect(f.appels).toEqual(["BTC", "ETH"]);

    const c = await chargerChaineOptions("BTC", NOW + TTL_CHAINE_MS, f.fetcher);
    expect(f.appels).toEqual(["BTC", "ETH", "BTC"]);
    expect(c?.recupereLe).toBe(NOW + TTL_CHAINE_MS);
  });

  it("horloge qui recule : le cache n'est pas servi", async () => {
    const f = fetcherFactice();
    await chargerChaineOptions("BTC", NOW, f.fetcher);
    await chargerChaineOptions("BTC", NOW - 1, f.fetcher);
    expect(f.appels).toHaveLength(2);
  });

  it("coalescence : deux demandes simultanées partagent le même appel", async () => {
    let resoudre: (p: OptionPoint[]) => void = () => {};
    const f = fetcherFactice(() => new Promise((res) => (resoudre = res)));
    const p1 = chargerChaineOptions("BTC", NOW, f.fetcher);
    const p2 = chargerChaineOptions("BTC", NOW + 1, f.fetcher);
    resoudre([point()]);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(f.appels).toEqual(["BTC"]);
    expect(r2).toBe(r1);
  });

  it("échec réseau → null, jamais mis en cache (nouvel appel ensuite)", async () => {
    let echoue = true;
    const f = fetcherFactice(async () => {
      if (echoue) throw new Error("Deribit 503");
      return [point()];
    });
    expect(await chargerChaineOptions("BTC", NOW, f.fetcher)).toBeNull();
    echoue = false;
    expect(await chargerChaineOptions("BTC", NOW + 1, f.fetcher)).not.toBeNull();
    expect(f.appels).toHaveLength(2);
  });

  it("chaîne vide → null, jamais mise en cache (absence ≠ chaîne sans options)", async () => {
    let vide = true;
    const f = fetcherFactice(async () => (vide ? [] : [point()]));
    expect(await chargerChaineOptions("BTC", NOW, f.fetcher)).toBeNull();
    vide = false;
    expect((await chargerChaineOptions("BTC", NOW + 1, f.fetcher))?.chaine).toHaveLength(1);
    expect(f.appels).toHaveLength(2);
  });
});

describe("spotDeChaine — définition spotChaine d'OMON", () => {
  it("premier sous-jacent fini et > 0, NaN si aucun", () => {
    expect(spotDeChaine([{ underlying: NaN }, { underlying: 0 }, { underlying: -1 }, { underlying: 79_145.62 }, { underlying: 80_000 }])).toBe(79_145.62);
    expect(spotDeChaine([{ underlying: NaN }])).toBeNaN();
    expect(spotDeChaine([])).toBeNaN();
  });
});

describe("actifDeribit — marchés éligibles aux chaînes Deribit", () => {
  it.each([
    ["binance", "BTCUSDT", "BTC"],
    ["coinbase", "ETH-USD", "ETH"],
    ["kraken", "XBT/USD", "BTC"],
    ["bybit", "ETHUSDC", "ETH"],
    ["hyperliquid", "BTCUSDT", "BTC"],
    ["hyperliquid", "BTC-PERP", "BTC"],
    ["hyperliquid", "ETH-PERP", "ETH"],
    ["hyperliquid", "SOL-PERP", null],
    ["twelvedata", "BTC-PERP", null],
    ["synthetic", "BTC-PERP", null],
    ["binance", "BTCEUR", null],
    ["binance", "ETHBTC", null],
    ["binance", "SOLUSDT", null],
    ["synthetic", "BTCUSDT", null],
    ["twelvedata", "BTC/USD", null],
    ["twelvedata", "SPY", null],
    ["binance", "", null],
  ] as const)("%s %s → %s", (exchange, symbol, attendu) => {
    expect(actifDeribit(exchange, symbol)).toBe(attendu);
  });
});

describe("actifDeribit — libellé de la place (vérification du 26/09)", () => {
  it("BTCFDUSD de Binance est du BTC coté en dollar", () => {
    expect(actifDeribit("binance", "BTCFDUSD")).toBe("BTC");
  });
});
