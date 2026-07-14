/** Tests de la couche données stablecoins (DefiLlama) — fetch mocké, fixtures minimales. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chargerEmetteurs,
  chargerHistoriqueAgrege,
  chargerHistoriqueChaine,
  chargerDetailEmetteur,
  _viderCacheStablecoins,
} from "./stablecoinsDetail";

/** Fixture /stablecoins?includePrices=true (champs réels DefiLlama, tronqués). */
const FIXTURE_LISTE = {
  peggedAssets: [
    {
      id: "1",
      name: "Tether",
      symbol: "USDT",
      pegType: "peggedUSD",
      pegMechanism: "fiat-backed",
      price: 1.0004,
      circulating: { peggedUSD: 120_000_000_000 },
      circulatingPrevDay: { peggedUSD: 119_500_000_000 },
      circulatingPrevWeek: { peggedUSD: 118_000_000_000 },
      circulatingPrevMonth: { peggedUSD: 115_000_000_000 },
      chainCirculating: {
        Tron: { current: { peggedUSD: 60_000_000_000 } },
        Ethereum: { current: { peggedUSD: 50_000_000_000 } },
      },
    },
    {
      id: "2",
      name: "USD Coin",
      symbol: "USDC",
      pegType: "peggedUSD",
      pegMechanism: "fiat-backed",
      price: 0.9998,
      circulating: { peggedUSD: 34_000_000_000 },
      // Champs prev absents → null attendu (robustesse).
      chainCirculating: { Ethereum: { current: { peggedUSD: 30_000_000_000 } } },
    },
    // Malformé : sans id ni circulating → ignoré.
    { name: "Broken", symbol: "BRK" },
    // Supply nulle → ignoré (aucun intérêt analytique, éviterait /0 en dominance).
    {
      id: "99",
      name: "Dead",
      symbol: "DEAD",
      pegType: "peggedUSD",
      pegMechanism: "algorithmic",
      circulating: { peggedUSD: 0 },
    },
  ],
};

const FIXTURE_CHARTS = [
  { date: "1719792000", totalCirculatingUSD: { peggedUSD: 150e9, peggedEUR: 0.3e9 } },
  { date: "1719878400", totalCirculatingUSD: { peggedUSD: 151e9, peggedEUR: "junk" } },
  { date: "not-a-date", totalCirculatingUSD: { peggedUSD: 1e9 } }, // ignoré
];

const FIXTURE_DETAIL = {
  id: "1",
  name: "Tether",
  symbol: "USDT",
  pegType: "peggedUSD",
  pegMechanism: "fiat-backed",
  price: 1.0004,
  chainBalances: {
    Tron: {
      tokens: [
        { date: 1719792000, circulating: { peggedUSD: 59e9 } },
        { date: 1719878400, circulating: { peggedUSD: 60e9 } },
      ],
    },
    Ethereum: { tokens: [{ date: 1719792000, circulating: { peggedUSD: 50e9 } }] },
  },
};

function mockFetchJson(payload: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => payload })),
  );
}

beforeEach(() => _viderCacheStablecoins());
afterEach(() => vi.unstubAllGlobals());

describe("chargerEmetteurs", () => {
  it("parse la liste, convertit les champs prev et ignore les entrées malformées ou vides", async () => {
    mockFetchJson(FIXTURE_LISTE);
    const emetteurs = await chargerEmetteurs();
    expect(emetteurs.map((e) => e.symbole)).toEqual(["USDT", "USDC"]);
    const usdt = emetteurs[0]!;
    expect(usdt.mcapUsd).toBe(120_000_000_000);
    expect(usdt.mcapVeilleUsd).toBe(119_500_000_000);
    expect(usdt.mcap7jUsd).toBe(118_000_000_000);
    expect(usdt.mcap30jUsd).toBe(115_000_000_000);
    expect(usdt.prix).toBe(1.0004);
    expect(usdt.parChaineUsd).toEqual({ Tron: 60_000_000_000, Ethereum: 50_000_000_000 });
    const usdc = emetteurs[1]!;
    expect(usdc.mcapVeilleUsd).toBeNull();
    expect(usdc.mcap7jUsd).toBeNull();
  });

  it("met en cache la réponse (un seul fetch pour deux appels)", async () => {
    mockFetchJson(FIXTURE_LISTE);
    await chargerEmetteurs();
    await chargerEmetteurs();
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });

  it("propage une erreur HTTP explicite", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, statusText: "Server Error", json: async () => ({}) })),
    );
    await expect(chargerEmetteurs()).rejects.toThrow(/500/);
  });
});

describe("chargerHistoriqueAgrege", () => {
  it("somme les pegs convertis USD par point et ignore dates/valeurs non finies", async () => {
    mockFetchJson(FIXTURE_CHARTS);
    const serie = await chargerHistoriqueAgrege();
    expect(serie).toEqual([
      { time: 1719792000_000, totalUsd: 150.3e9 },
      { time: 1719878400_000, totalUsd: 151e9 }, // "junk" ignoré
    ]);
  });
});

describe("chargerHistoriqueChaine", () => {
  it("interroge l'endpoint de la chaîne demandée (URL encodée)", async () => {
    mockFetchJson(FIXTURE_CHARTS);
    await chargerHistoriqueChaine("Ethereum");
    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toBe("https://stablecoins.llama.fi/stablecoincharts/Ethereum");
  });
});

describe("chargerDetailEmetteur", () => {
  it("parse l'historique par chaîne (dates secondes → ms, valeurs sommées par peg)", async () => {
    mockFetchJson(FIXTURE_DETAIL);
    const detail = await chargerDetailEmetteur("1");
    expect(detail.symbole).toBe("USDT");
    expect(detail.historiqueParChaine["Tron"]).toEqual([
      { time: 1719792000_000, totalUsd: 59e9 },
      { time: 1719878400_000, totalUsd: 60e9 },
    ]);
    expect(Object.keys(detail.historiqueParChaine)).toEqual(["Tron", "Ethereum"]);
  });
});
