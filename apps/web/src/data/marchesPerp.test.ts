/**
 * Découverte des perpétuels par actif (demande du 5 octobre 2026).
 * Les lignes de catalogue ci-dessous reproduisent des entrées RÉELLES du snapshot
 * `GET /v1/future-markets` relevé le jour même (PUMP, BTC, PEPE), plus quelques
 * lignes hors périmètre (Kraken `.K`, Coinbase `.C`, …) et deux lignes de rebut.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _reinitialiserCatalogueMarchesPerp,
  actifPerpDe,
  marcheComplement,
  marchePerpRetenu,
  marchesPerpPourActif,
  ordonnerMarchesPerp,
  resoudreMarchesPerp,
  type MarchePerp,
} from "./marchesPerp";
import { coinalyzeKeyStore } from "../store/coinalyze";

/** Ligne de catalogue `future-markets` — seuls les champs consommés sont posés. */
function ligne(
  symbol: string,
  exchange: string,
  symbolOnExchange: string,
  base: string,
  quote: string,
  opts: { margined?: string; ls?: boolean; perp?: boolean } = {},
): unknown {
  return {
    symbol,
    exchange,
    symbol_on_exchange: symbolOnExchange,
    base_asset: base,
    quote_asset: quote,
    margined: opts.margined ?? "STABLE",
    is_perpetual: opts.perp ?? true,
    has_long_short_ratio_data: opts.ls ?? false,
  };
}

/** Sous-ensemble du catalogue réel (snapshot /tmp/cz_fm.json du 5/10/2026). */
const CATALOGUE: unknown[] = [
  // PUMP — quatre places couvertes + lignes à exclure.
  ligne("PUMPUSDT_PERP.A", "A", "PUMPUSDT", "PUMP", "USDT", { ls: true }),
  ligne("PUMPFUNUSDT.6", "6", "PUMPFUNUSDT", "PUMP", "USDT", { ls: true }),
  ligne("PUMPFUNPERP.6", "6", "PUMPFUNPERP", "PUMP", "USDC"),
  ligne("PUMPUSDT_PERP.3", "3", "PUMP-USDT-SWAP", "PUMP", "USDT"),
  ligne("PUMP.H", "H", "PUMP", "PUMP", "USD"),
  ligne("PUMPBTCUSDT_PERP.A", "A", "PUMPBTCUSDT", "PUMPBTC", "USDT", { ls: true }),
  ligne("pf_pumpusd.K", "K", "pf_pumpusd", "PUMP", "USD"), // Kraken : hors périmètre
  ligne("PUMP-PERP.C", "C", "PUMP-PERP", "PUMP", "USDC"), // Coinbase : hors périmètre
  ligne("PUMP_USDT.Y", "Y", "PUMP_USDT", "PUMP", "USDT"), // Gate : hors périmètre
  ligne("PUMPSPOT.6", "6", "PUMPSPOT", "PUMP", "USDT", { perp: false }), // pas un perp
  // BTC — lignes à départager par place.
  ligne("BTCUSDT_PERP.A", "A", "BTCUSDT", "BTC", "USDT", { ls: true }),
  ligne("BTCUSDC_PERP.A", "A", "BTCUSDC", "BTC", "USDC", { ls: true }),
  ligne("BTCU_PERP.A", "A", "BTCU", "BTC", "U"),
  ligne("BTCUSD1_PERP.A", "A", "BTCUSD1", "BTC", "USD1"),
  ligne("BTCUSD_PERP.A", "A", "BTCUSD_PERP", "BTC", "USD", { margined: "COIN" }),
  ligne("BTCUSDT.6", "6", "BTCUSDT", "BTC", "USDT", { ls: true }),
  ligne("BTCUSD.6", "6", "BTCUSD", "BTC", "USD", { margined: "COIN", ls: true }),
  ligne("BTCPERP.6", "6", "BTCPERP", "BTC", "USDC"),
  ligne("BTCUSDT_PERP.3", "3", "BTC-USDT-SWAP", "BTC", "USDT"),
  ligne("BTCUSD_PERP.3", "3", "BTC-USD-SWAP", "BTC", "USD", { margined: "COIN" }),
  ligne("BTC.H", "H", "BTC", "BTC", "USD"),
  // PEPE — contrats fractionnés : 1000PEPE (CEX), kPEPE (Hyperliquid, casse « k »).
  ligne("1000PEPEUSDT_PERP.A", "A", "1000PEPEUSDT", "1000PEPE", "USDT", { ls: true }),
  ligne("1000PEPEUSDC_PERP.A", "A", "1000PEPEUSDC", "1000PEPE", "USDC"),
  ligne("1000PEPEUSDT.6", "6", "1000PEPEUSDT", "1000PEPE", "USDT", { ls: true }),
  ligne("1000PEPEPERP.6", "6", "1000PEPEPERP", "1000PEPE", "USDC"),
  ligne("PEPEUSDT_PERP.3", "3", "PEPE-USDT-SWAP", "PEPE", "USDT"),
  ligne("kPEPE.H", "H", "kPEPE", "kPEPE", "USD"),
  // Rebut : une ligne Hyperliquid « KAITO » ne doit JAMAIS matcher l'actif AITO
  // (le préfixe HL « k » est bas de casse et la casse est discriminante).
  ligne("KAITO.H", "H", "KAITO", "KAITO", "USD"),
];

describe("marchesPerpPourActif", () => {
  it("PUMP → quatre marchés dans l'ordre Binance, Bybit, OKX, Hyperliquid", () => {
    const marches = marchesPerpPourActif(CATALOGUE, "PUMP");
    expect(marches.map((m) => m.place)).toEqual(["binance", "bybit", "okx", "hyperliquid"]);
    expect(marches.map((m) => m.symbole)).toEqual([
      "PUMPUSDT_PERP.A",
      "PUMPFUNUSDT.6", // la ligne USDT, pas le PERP USDC
      "PUMPUSDT_PERP.3",
      "PUMP.H",
    ]);
    expect(marches.map((m) => m.symboleSurPlace)).toEqual([
      "PUMPUSDT",
      "PUMPFUNUSDT",
      "PUMP-USDT-SWAP",
      "PUMP",
    ]);
    expect(marches.map((m) => m.aLongShort)).toEqual([true, true, false, false]);
    // Liquidations : Coinalyze ne publie JAMAIS de série Hyperliquid.
    expect(marches.map((m) => m.aLiquidations)).toEqual([true, true, true, false]);
    // PUMPBTC, Kraken, Coinbase, Gate et le spot non perp sont exclus.
    expect(marches.some((m) => m.symbole.includes("PUMPBTC"))).toBe(false);
  });

  it("BTC → départage STABLE puis cotation USDT sur chaque place", () => {
    const marches = marchesPerpPourActif(CATALOGUE, "BTC");
    expect(marches.map((m) => m.symbole)).toEqual([
      "BTCUSDT_PERP.A",
      "BTCUSDT.6",
      "BTCUSDT_PERP.3",
      "BTC.H",
    ]);
  });

  it("PEPE → multiplicateurs ×1000 (CEX « 1000 », HL « k » casse conservée)", () => {
    const marches = marchesPerpPourActif(CATALOGUE, "PEPE");
    expect(marches.map((m) => [m.symbole, m.multiplicateur])).toEqual([
      ["1000PEPEUSDT_PERP.A", 1000],
      ["1000PEPEUSDT.6", 1000],
      ["PEPEUSDT_PERP.3", 1],
      ["kPEPE.H", 1000],
    ]);
  });

  it("une ligne Hyperliquid « KAITO » ne matche pas l'actif AITO", () => {
    const marches = marchesPerpPourActif(CATALOGUE, "AITO");
    expect(marches).toEqual([]);
  });

  it("actif inconnu → liste vide", () => {
    expect(marchesPerpPourActif(CATALOGUE, "INCONNU")).toEqual([]);
  });
});

describe("ordonnerMarchesPerp / marchePerpRetenu", () => {
  const marches = marchesPerpPourActif(CATALOGUE, "PUMP");

  it("sans prioritaire : ordre PLACES_PERP ; avec : la place passe en tête", () => {
    expect(ordonnerMarchesPerp(marches, null).map((m) => m.place)).toEqual([
      "binance", "bybit", "okx", "hyperliquid",
    ]);
    expect(ordonnerMarchesPerp(marches, "hyperliquid").map((m) => m.place)).toEqual([
      "hyperliquid", "binance", "bybit", "okx",
    ]);
    // prioritaire absent de la liste : ordre inchangé.
    const sansHL = marches.filter((m) => m.place !== "hyperliquid");
    expect(ordonnerMarchesPerp(sansHL, "hyperliquid").map((m) => m.place)).toEqual([
      "binance", "bybit", "okx",
    ]);
  });

  it("marchePerpRetenu : choix présent > tête ordonnée > null", () => {
    const sansHL = marches.filter((m) => m.place !== "hyperliquid");
    expect(marchePerpRetenu(marches, "okx", null)?.symbole).toBe("PUMPUSDT_PERP.3");
    // Choix absent de la liste → premier de l'ordre (prioritaire compris).
    expect(marchePerpRetenu(sansHL, "hyperliquid", null)?.symbole).toBe("PUMPUSDT_PERP.A");
    expect(marchePerpRetenu(marches, undefined, "hyperliquid")?.symbole).toBe("PUMP.H");
    expect(marchePerpRetenu([], "binance", null)).toBeNull();
  });
});

describe("marcheComplement — métrique empruntée à une autre place", () => {
  const marches = marchesPerpPourActif(CATALOGUE, "PUMP");
  const parPlace = (p: string) => marches.find((m) => m.place === p) as MarchePerp;

  it("la place affichée publie la métrique → elle-même", () => {
    expect(marcheComplement(marches, parPlace("binance"), "aLongShort")?.symbole).toBe("PUMPUSDT_PERP.A");
    expect(marcheComplement(marches, parPlace("bybit"), "aLiquidations")?.symbole).toBe("PUMPFUNUSDT.6");
  });

  it("OKX affiché → L/S de Binance (premier de l'ordre PLACES_PERP)", () => {
    expect(marcheComplement(marches, parPlace("okx"), "aLongShort")?.symbole).toBe("PUMPUSDT_PERP.A");
    // OKX a des liquidations → pas de complément.
    expect(marcheComplement(marches, parPlace("okx"), "aLiquidations")?.symbole).toBe("PUMPUSDT_PERP.3");
  });

  it("Hyperliquid affiché → L/S ET liquidations de Binance", () => {
    expect(marcheComplement(marches, parPlace("hyperliquid"), "aLongShort")?.symbole).toBe("PUMPUSDT_PERP.A");
    expect(marcheComplement(marches, parPlace("hyperliquid"), "aLiquidations")?.symbole).toBe("PUMPUSDT_PERP.A");
  });

  it("Binance absent → L/S de Bybit ; aucune place couvrante → null", () => {
    const sansBinance = marches.filter((m) => m.place !== "binance");
    expect(marcheComplement(sansBinance, parPlace("okx"), "aLongShort")?.symbole).toBe("PUMPFUNUSDT.6");
    const hlSeul = marches.filter((m) => m.place === "hyperliquid");
    expect(marcheComplement(hlSeul, parPlace("hyperliquid"), "aLiquidations")).toBeNull();
    expect(marcheComplement([], parPlace("hyperliquid"), "aLongShort")).toBeNull();
  });
});

describe("actifPerpDe", () => {
  it("extrait la base perp des formats courants", () => {
    expect(actifPerpDe("PUMPUSDT")).toBe("PUMP");
    expect(actifPerpDe("PUMPUSD")).toBe("PUMP");
    expect(actifPerpDe("BTC-PERP")).toBe("BTC");
    expect(actifPerpDe("XBT/USD")).toBe("BTC");
    expect(actifPerpDe("BTC-USD")).toBe("BTC");
  });

  it("renvoie null pour synthétique et TradFi", () => {
    expect(actifPerpDe("binance:BTCUSDT|/|binance:ETHUSDT")).toBeNull();
    expect(actifPerpDe("SPY")).toBeNull();
    expect(actifPerpDe("EUR/USD")).toBeNull();
  });
});

describe("resoudreMarchesPerp", () => {
  const hasKeyInitial = coinalyzeKeyStore.getState().hasKey;

  beforeEach(() => {
    _reinitialiserCatalogueMarchesPerp();
    coinalyzeKeyStore.setState({ hasKey: true });
  });
  afterEach(() => {
    coinalyzeKeyStore.setState({ hasKey: hasKeyInitial });
    vi.unstubAllGlobals();
    vi.useRealTimers();
    _reinitialiserCatalogueMarchesPerp();
  });

  it("sans clé → repli « sans-cle » sur le perp Binance supposé, ZÉRO requête", async () => {
    coinalyzeKeyStore.setState({ hasKey: false });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await resoudreMarchesPerp("PUMPUSDT");
    expect(r).toEqual({
      etat: "repli",
      actif: "PUMP",
      cause: "sans-cle",
      marches: [
        {
          place: "binance",
          symbole: "PUMPUSDT_PERP.A",
          symboleSurPlace: "PUMPUSDT",
          multiplicateur: 1,
          aLongShort: true,
          aLiquidations: true,
        },
      ],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("trois appels concurrents → une seule requête future-markets (single-flight)", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(CATALOGUE)));
    vi.stubGlobal("fetch", fetchSpy);
    const [a, b, c] = await Promise.all([
      resoudreMarchesPerp("PUMPUSDT"),
      resoudreMarchesPerp("BTCUSDT"),
      resoudreMarchesPerp("PEPEUSDT"),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(a.etat).toBe("catalogue");
    expect(b.etat).toBe("catalogue");
    expect(c.etat).toBe("catalogue");
  });

  it("le succès est mis en cache (12 h) : pas de second appel", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(CATALOGUE)));
    vi.stubGlobal("fetch", fetchSpy);
    await resoudreMarchesPerp("PUMPUSDT");
    const r = await resoudreMarchesPerp("BTCUSDT");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ etat: "catalogue", actif: "BTC" });
    if (r.etat === "catalogue") {
      expect(r.marches.map((m) => m.symbole)).toContain("BTCUSDT_PERP.A");
    }
  });

  it("échec catalogue → repli « catalogue-indisponible », mémo 60 s puis nouvelle tentative", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 5, 12, 0, 0));
    const fetchSpy = vi.fn(async () => new Response("boom", { status: 503 }));
    vi.stubGlobal("fetch", fetchSpy);

    const r1 = await resoudreMarchesPerp("PUMPUSDT");
    expect(r1).toMatchObject({ etat: "repli", cause: "catalogue-indisponible" });
    if (r1.etat === "repli") {
      expect(r1.marches[0]!.symbole).toBe("PUMPUSDT_PERP.A");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Mémo d'échec : aucune nouvelle tentative avant 60 s.
    const r2 = await resoudreMarchesPerp("PUMPUSDT");
    expect(r2).toMatchObject({ etat: "repli", cause: "catalogue-indisponible" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Après 60 s : nouvelle tentative, qui réussit cette fois.
    vi.setSystemTime(Date.UTC(2026, 9, 5, 12, 1, 1));
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify(CATALOGUE)));
    const r3 = await resoudreMarchesPerp("PUMPUSDT");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(r3).toMatchObject({ etat: "catalogue" });
  });

  it("SPY (TradFi) → inexploitable, ZÉRO requête", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await resoudreMarchesPerp("SPY");
    expect(r).toEqual({ etat: "inexploitable" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("corps non-tableau → repli « catalogue-indisponible »", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ erreur: "x" }))));
    const r = await resoudreMarchesPerp("PUMPUSDT");
    expect(r).toMatchObject({ etat: "repli", cause: "catalogue-indisponible" });
  });
});
