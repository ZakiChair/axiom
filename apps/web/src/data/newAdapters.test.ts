/**
 * Adaptateurs Bybit / OKX / Hyperliquid — verrouille le CHEMIN REST (fetchKlines) sur
 * les invariants vérifiés en réel contre les API : ordre des bougies renvoyé
 * (DÉCROISSANT côté Bybit/OKX → doit ressortir ASCENDANT) et sémantique du flag
 * `closed`. Une inversion ratée = bougies à l'envers silencieusement à l'écran, que
 * les tests sur données mockées ne rattrapent que si l'ordre du mock est fidèle à
 * l'API (d'où la vérification préalable des vraies réponses).
 *
 * fetch mocké : déterministe, sans réseau.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Candle } from "@axiom/types";
import { bybitAdapter } from "./bybit";
import { okxAdapter } from "./okx";
import { hyperliquidAdapter } from "./hyperliquid";

function at(c: Candle[], i: number): Candle {
  const v = c[i];
  if (v === undefined) throw new Error(`bougie ${i} absente`);
  return v;
}

function mockFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bybitAdapter.fetchKlines", () => {
  it("inverse la liste DÉCROISSANTE de Bybit en ordre ascendant", async () => {
    // Bybit renvoie le plus RÉCENT d'abord : [ts, o, h, l, c, vol, turnover].
    mockFetch({
      retCode: 0,
      retMsg: "OK",
      result: {
        list: [
          ["2000", "11", "12", "10", "11.5", "100", "1150"], // récent
          ["1000", "10", "11", "9", "10.5", "90", "945"], // ancien
        ],
      },
    });
    const c = await bybitAdapter.fetchKlines("BTCUSDT", "1m", { limit: 2 });
    expect(c.map((k) => k.time)).toEqual([1000, 2000]); // ascendant
    expect(at(c, 0).open).toBe(10);
    expect(at(c, 1).close).toBe(11.5);
  });

  it("propage l'erreur retCode ≠ 0", async () => {
    mockFetch({ retCode: 10001, retMsg: "params error", result: { list: [] } });
    await expect(bybitAdapter.fetchKlines("BTCUSDT", "1m")).rejects.toThrow(/params error/);
  });

  it("lève sur timeframe non supporté (3m)", async () => {
    await expect(bybitAdapter.fetchKlines("BTCUSDT", "3m")).rejects.toThrow(/non supporté/);
  });
});

describe("okxAdapter.fetchKlines", () => {
  it("inverse l'ordre DÉCROISSANT et lit le flag confirm (9e champ)", async () => {
    // OKX : [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm], plus récent d'abord.
    mockFetch({
      code: "0",
      msg: "",
      data: [
        ["2000", "11", "12", "10", "11.5", "1", "1", "1", "0"], // récent, en cours
        ["1000", "10", "11", "9", "10.5", "1", "1", "1", "1"], // ancien, clôturé
      ],
    });
    const c = await okxAdapter.fetchKlines("BTCUSDT", "1h", { limit: 2 });
    expect(c.map((k) => k.time)).toEqual([1000, 2000]); // ascendant
    expect(at(c, 0).closed).toBe(true); // confirm "1"
    expect(at(c, 1).closed).toBe(false); // confirm "0"
  });

  it("propage l'erreur code ≠ 0", async () => {
    mockFetch({ code: "51001", msg: "instrument doesn't exist", data: [] });
    await expect(okxAdapter.fetchKlines("BTCUSDT", "1h")).rejects.toThrow(/instrument doesn't exist/);
  });

  it("demande les bars alignés UTC pour 6h/12h/1d/1w/1M (suffixe utc), pas l'alignement Hong Kong", async () => {
    // OKX v5 : les granularités ≥ 6H SANS suffixe ouvrent à 00:00 UTC+8 (16:00 UTC) —
    // jours décalés de 16 h vs toutes les autres sources du terminal. Variantes "…utc" requises.
    const f = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ code: "0", msg: "", data: [] }) }));
    vi.stubGlobal("fetch", f);
    await okxAdapter.fetchKlines("BTCUSDT", "1d");
    await okxAdapter.fetchKlines("BTCUSDT", "6h");
    await okxAdapter.fetchKlines("BTCUSDT", "1h");
    const urls = (f.mock.calls as unknown as Array<[string]>).map((c) => String(c[0]));
    expect(urls[0]).toContain("bar=1Dutc");
    expect(urls[1]).toContain("bar=6Hutc");
    expect(urls[2]).toContain("bar=1H"); // < 6h : pas de variante utc côté OKX
    expect(urls[2]).not.toContain("utc");
  });
});

describe("hyperliquidAdapter.fetchKlines", () => {
  it("mappe candleSnapshot (ordre ascendant) et déduit closed via T vs now", async () => {
    const now = Date.now();
    mockFetch([
      { t: 1000, T: 2000, s: "BTC", i: "1h", o: "10", c: "10.5", h: "11", l: "9", v: "5", n: 3 }, // clôturée (T<now)
      { t: now, T: now + 3_600_000, s: "BTC", i: "1h", o: "10.5", c: "11", h: "12", l: "10", v: "2", n: 1 }, // en cours
    ]);
    const c = await hyperliquidAdapter.fetchKlines("BTCUSDT", "1h", { limit: 2 });
    expect(c.map((k) => k.time)).toEqual([1000, now]);
    expect(at(c, 0).closed).toBe(true);
    expect(at(c, 1).closed).toBe(false);
    expect(at(c, 0).trades).toBe(3); // n → trades
  });

  it("lève sur timeframe non supporté (6h absent côté HL)", async () => {
    await expect(hyperliquidAdapter.fetchKlines("BTCUSDT", "6h")).rejects.toThrow(/non supporté/);
  });
});
