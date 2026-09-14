import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";
import {
  cboeExpiries,
  cboeOptionsToLegs,
  cheminOptionsCboe,
  echeanceCboeRetenue,
  heureNewYorkVersUtcMs,
  niveauCrypto,
  normaliserChaineCboe,
  parseCboeOptionSymbol,
  prixCryptoAuDernierEchange,
  type CboeOption,
} from "./cboe";
import { binanceAdapter } from "./binance";

vi.mock("./binance", () => ({ binanceAdapter: { fetchKlines: vi.fn() } }));

describe("parseCboeOptionSymbol", () => {
  it("parse un call SPX réel (SPX260717C06530000 → strike 6530)", () => {
    const p = parseCboeOptionSymbol("SPX260717C06530000");
    expect(p).toEqual({
      root: "SPX",
      expiryMs: Date.UTC(2026, 6, 17),
      type: "call",
      strike: 6530,
    });
  });

  it("parse un put SPX profondément OTM (SPX260717P00800000 → strike 800)", () => {
    const p = parseCboeOptionSymbol("SPX260717P00800000");
    expect(p?.type).toBe("put");
    expect(p?.strike).toBe(800);
    expect(p?.root).toBe("SPX");
  });

  it("parse un ticker NDX (racine 3 lettres) et VIX", () => {
    const ndx = parseCboeOptionSymbol("NDX261218C25000000");
    expect(ndx?.root).toBe("NDX");
    expect(ndx?.strike).toBe(25000);
    expect(ndx?.expiryMs).toBe(Date.UTC(2026, 11, 18));
    const vix = parseCboeOptionSymbol("VIX260121C00020000");
    expect(vix?.root).toBe("VIX");
    expect(vix?.strike).toBe(20);
    expect(vix?.type).toBe("call");
  });

  it("gère un strike fractionnaire (×1000 → décimales)", () => {
    // 00012500 → 12,50.
    const p = parseCboeOptionSymbol("VIX260121P00012500");
    expect(p?.strike).toBe(12.5);
  });

  it("gère une racine avec chiffre (weekly SPXW / racine alphanumérique)", () => {
    const p = parseCboeOptionSymbol("SPXW260717C06000000");
    expect(p?.root).toBe("SPXW");
    expect(p?.strike).toBe(6000);
  });

  it("renvoie null sur format invalide", () => {
    expect(parseCboeOptionSymbol("")).toBeNull();
    expect(parseCboeOptionSymbol("SPX")).toBeNull();
    expect(parseCboeOptionSymbol("SPX260717X06530000")).toBeNull(); // ni C ni P
    expect(parseCboeOptionSymbol("SPX261317C06530000")).toBeNull(); // mois 13 invalide
    expect(parseCboeOptionSymbol("SPX260732C06530000")).toBeNull(); // jour 32 invalide
    expect(parseCboeOptionSymbol("260717C06530000")).toBeNull(); // racine manquante
  });
});

describe("cboeExpiries", () => {
  const now = Date.UTC(2026, 6, 1);
  const opts: CboeOption[] = [
    { option: "SPX260717C06000000", open_interest: 1, delta: 0.5, gamma: 0.01, iv: 0.3 },
    { option: "SPX260717P06000000", open_interest: 1, delta: -0.5, gamma: 0.01, iv: 0.3 },
    { option: "SPX260918C06000000", open_interest: 1, delta: 0.5, gamma: 0.01, iv: 0.3 },
    { option: "SPX250101C06000000", open_interest: 1, delta: 0.5, gamma: 0.01, iv: 0.3 }, // passé
    { option: "GARBAGE", open_interest: 1, delta: 0.5, gamma: 0.01, iv: 0.3 }, // ignoré
  ];

  it("liste les échéances futures distinctes, triées, avec comptage", () => {
    const exp = cboeExpiries(opts, now);
    expect(exp).toEqual([
      { expiryMs: Date.UTC(2026, 6, 17), count: 2, avecGamma: true },
      { expiryMs: Date.UTC(2026, 8, 18), count: 1, avecGamma: true },
    ]);
  });

  it("tolère une expiration du jour même (grâce d'un jour)", () => {
    // now à 20h UTC le 2026-07-17 ; l'expiry à 00:00 UTC du même jour reste visible.
    const memeJour = Date.UTC(2026, 6, 17, 20, 0, 0);
    const exp = cboeExpiries(
      [{ option: "SPX260717C06000000", open_interest: 1, delta: 0.5, gamma: 0.01, iv: 0.3 }],
      memeJour,
    );
    expect(exp).toHaveLength(1);
    expect(exp[0]?.expiryMs).toBe(Date.UTC(2026, 6, 17));
  });

  it("marque sans gamma une échéance dont aucun gamma n'est fini et > 0 (liste inchangée)", () => {
    const exp = cboeExpiries(
      [
        { option: "SPX260717C06000000", open_interest: 1, delta: 0, gamma: 0, iv: 0.3 },
        { option: "SPX260717P06000000", open_interest: 1, delta: 0, gamma: NaN, iv: 0.3 },
        { option: "SPX260918C06000000", open_interest: 1, delta: 0.5, gamma: 0, iv: 0.3 },
        { option: "SPX260918P06000000", open_interest: 1, delta: -0.5, gamma: 0.002, iv: 0.3 },
      ],
      now,
    );
    expect(exp).toEqual([
      { expiryMs: Date.UTC(2026, 6, 17), count: 2, avecGamma: false },
      { expiryMs: Date.UTC(2026, 8, 18), count: 2, avecGamma: true },
    ]);
  });
});

describe("echeanceCboeRetenue", () => {
  // Mardi 2026-09-15 21:00 UTC, après la clôture de New York : l'échéance du jour reste listée
  // (grâce d'un jour) mais ses gammas CBOE sont nuls.
  const apresCloture = Date.UTC(2026, 8, 15, 21, 0, 0);
  const jour = Date.UTC(2026, 8, 15);
  const suivante = Date.UTC(2026, 8, 16);
  const echeances = cboeExpiries(
    [
      { option: "IBIT260915C00045000", open_interest: 9000, delta: 1, gamma: 0, iv: 0 },
      { option: "IBIT260915P00045000", open_interest: 9000, delta: 0, gamma: 0, iv: 0 },
      { option: "IBIT260916C00045000", open_interest: 100, delta: 0.5, gamma: 0.2, iv: 0.4 },
      { option: "IBIT260918P00040000", open_interest: 100, delta: -0.3, gamma: 0.05, iv: 0.4 },
    ],
    apresCloture,
  );

  it("par défaut, saute l'échéance du jour à gammas nuls et retient la suivante", () => {
    expect(echeances.map((e) => e.expiryMs)[0]).toBe(jour);
    expect(echeanceCboeRetenue(echeances, null)).toBe(suivante);
  });

  it("aucune échéance avec gamma : retient la première, marquée sans gamma (mention)", () => {
    const sansGreeks = cboeExpiries(
      [
        { option: "SPX260915C06000000", open_interest: 1, delta: 0, gamma: 0, iv: 0 },
        { option: "SPX260918C06000000", open_interest: 1, delta: 0, gamma: 0, iv: 0 },
      ],
      apresCloture,
    );
    expect(echeanceCboeRetenue(sansGreeks, null)).toBe(jour);
    expect(sansGreeks[0]?.avecGamma).toBe(false);
  });

  it("garde un choix manuel encore listé, même sans gamma", () => {
    expect(echeanceCboeRetenue(echeances, jour)).toBe(jour);
    expect(echeanceCboeRetenue(echeances, Date.UTC(2026, 8, 18))).toBe(Date.UTC(2026, 8, 18));
  });

  it("choix manuel disparu de la liste : repli sur la première échéance avec gamma", () => {
    expect(echeanceCboeRetenue(echeances, Date.UTC(2026, 8, 11))).toBe(suivante);
  });

  it("aucune échéance : null", () => {
    expect(echeanceCboeRetenue([], null)).toBeNull();
    expect(echeanceCboeRetenue([], jour)).toBeNull();
  });
});

describe("cboeOptionsToLegs", () => {
  const opts: CboeOption[] = [
    { option: "SPX260717C06000000", open_interest: 10, delta: 0.6, gamma: 0.02, iv: 0.3 },
    { option: "SPX260717P06000000", open_interest: 5, delta: -0.4, gamma: 0.03, iv: 0.3 },
    { option: "SPX260918C06000000", open_interest: 7, delta: 0.5, gamma: 0.01, iv: 0.3 }, // autre échéance
    { option: "BADSYMBOL", open_interest: 1, delta: 0.5, gamma: 0.01, iv: 0.3 }, // ignoré
  ];

  it("ne retient que l'échéance demandée et mappe delta/gamma (signés côté CBOE)", () => {
    const legs = cboeOptionsToLegs(opts, Date.UTC(2026, 6, 17));
    expect(legs).toEqual([
      { strike: 6000, type: "call", openInterest: 10, delta: 0.6, gamma: 0.02 },
      { strike: 6000, type: "put", openInterest: 5, delta: -0.4, gamma: 0.03 },
    ]);
  });

  it("remplace les greeks non finis par 0 (dégradation gracieuse)", () => {
    const legs = cboeOptionsToLegs(
      [{ option: "SPX260717C06000000", open_interest: NaN, delta: NaN, gamma: NaN, iv: 0.3 }],
      Date.UTC(2026, 6, 17),
    );
    expect(legs[0]).toEqual({
      strike: 6000,
      type: "call",
      openInterest: 0,
      delta: 0,
      gamma: 0,
    });
  });
});

describe("cheminOptionsCboe", () => {
  it("garde le préfixe « _ » des indices et l'omet pour les ETF (_IBIT.json répond 403)", () => {
    expect(cheminOptionsCboe("SPX")).toBe("api/global/delayed_quotes/options/_SPX.json");
    expect(cheminOptionsCboe("VIX")).toBe("api/global/delayed_quotes/options/_VIX.json");
    expect(cheminOptionsCboe("IBIT")).toBe("api/global/delayed_quotes/options/IBIT.json");
    expect(cheminOptionsCboe("ETHA")).toBe("api/global/delayed_quotes/options/ETHA.json");
  });
});

describe("normaliserChaineCboe", () => {
  // Spot 44,825 : bande ±25 % = [33,62 ; 56,03] → 30 et 60 hors bande, 45 et 50 conservés.
  const option = (option: string, open_interest: number, volume: number) => ({
    option,
    open_interest,
    volume,
    delta: 0.5,
    gamma: 0.1,
    iv: 0.4,
  });
  const brut = (data: Record<string, unknown>) => ({
    timestamp: "2026-09-14 19:28:16",
    data: {
      current_price: 44.825,
      iv30: 38.795,
      last_trade_time: "2026-09-14T15:13:15",
      options: [
        option("IBIT260918C00030000", 100, 10),
        option("IBIT260918P00030000", 300, 5),
        option("IBIT260918C00045000", 1000, 40),
        option("IBIT260918P00045000", 500, 20),
        option("IBIT260918C00050000", 2000, 50),
        option("IBIT260918P00050000", 200, 25),
        option("IBIT260918C00060000", 900, 0),
        option("IBIT260918P00060000", 0, 0),
      ],
      ...data,
    },
  });

  it("ETF : ne garde que les strikes à ±25 % du prix de l'ETF, avec IV30 et dernier échange", () => {
    const chaine = normaliserChaineCboe(brut({}), "IBIT");
    expect(chaine?.spot).toBe(44.825);
    expect(chaine?.iv30).toBe(38.795);
    expect(chaine?.dernierEchangeNy).toBe("2026-09-14T15:13:15");
    expect(chaine?.options.map((o) => o.option)).toEqual([
      "IBIT260918C00045000",
      "IBIT260918P00045000",
      "IBIT260918C00050000",
      "IBIT260918P00050000",
    ]);
  });

  it("calcule les agrégats P/C sur la chaîne COMPLÈTE, avant le filtre", () => {
    expect(normaliserChaineCboe(brut({}), "IBIT")?.resume).toEqual({
      oiCalls: 100 + 1000 + 2000 + 900,
      oiPuts: 300 + 500 + 200 + 0,
      volCalls: 10 + 40 + 50 + 0,
      volPuts: 5 + 20 + 25 + 0,
    });
  });

  it("indices : aucun filtre de strikes (VIX, SPX inchangés)", () => {
    expect(normaliserChaineCboe(brut({}), "SPX")?.options).toHaveLength(8);
  });

  it("IV30 et dernier échange absents → NaN et null, jamais zéro", () => {
    const chaine = normaliserChaineCboe(brut({ iv30: undefined, last_trade_time: undefined }), "IBIT");
    expect(chaine?.iv30).toBeNaN();
    expect(chaine?.dernierEchangeNy).toBeNull();
  });

  it("spot invalide ou options vides → null", () => {
    expect(normaliserChaineCboe(brut({ current_price: 0 }), "IBIT")).toBeNull();
    expect(normaliserChaineCboe(brut({ options: [] }), "IBIT")).toBeNull();
    expect(normaliserChaineCboe(null, "IBIT")).toBeNull();
  });
});

describe("heureNewYorkVersUtcMs", () => {
  it("convertit l'heure de New York sans offset en UTC (EDT l'été, EST l'hiver)", () => {
    expect(heureNewYorkVersUtcMs("2026-09-14T15:13:15")).toBe(Date.UTC(2026, 8, 14, 19, 13, 15));
    expect(heureNewYorkVersUtcMs("2026-12-14T15:00:00")).toBe(Date.UTC(2026, 11, 14, 20, 0, 0));
  });

  it("gère les jours de changement d'heure (8 mars et 1er novembre 2026)", () => {
    expect(heureNewYorkVersUtcMs("2026-03-08T01:30:00")).toBe(Date.UTC(2026, 2, 8, 6, 30, 0));
    expect(heureNewYorkVersUtcMs("2026-03-08T12:00:00")).toBe(Date.UTC(2026, 2, 8, 16, 0, 0));
    expect(heureNewYorkVersUtcMs("2026-11-01T12:00:00")).toBe(Date.UTC(2026, 10, 1, 17, 0, 0));
  });

  it("format invalide → null", () => {
    expect(heureNewYorkVersUtcMs("garbage")).toBeNull();
    expect(heureNewYorkVersUtcMs("2026-13-40T15:00:00")).toBeNull();
    expect(heureNewYorkVersUtcMs("2026-09-14 15:13:15")).toBeNull();
  });
});

describe("niveauCrypto", () => {
  it("convertit un strike ETF en niveau crypto par ratio de prix (strike × crypto / ETF)", () => {
    expect(niveauCrypto(45, 44.825, 79152.01)).toBeCloseTo(79461.03, 1);
    expect(niveauCrypto(50, 44.825, 79152.01)).toBeCloseTo(88290.03, 1);
    expect(niveauCrypto(44.5, 44.825, 79152.01)).toBeCloseTo(78578.13, 1);
  });

  it("entrée absente ou invalide → null (conversion masquée, jamais le spot courant)", () => {
    expect(niveauCrypto(45, 44.825, null)).toBeNull();
    expect(niveauCrypto(null, 44.825, 79152.01)).toBeNull();
    expect(niveauCrypto(45, 0, 79152.01)).toBeNull();
    expect(niveauCrypto(45, 44.825, Number.NaN)).toBeNull();
  });
});

describe("prixCryptoAuDernierEchange", () => {
  const fetchKlines = vi.mocked(binanceAdapter.fetchKlines);
  const bougie = (time: number, close: number): Candle => ({
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  });

  beforeEach(() => fetchKlines.mockReset());

  it("lit la clôture de la bougie 1m BTCUSDT qui contient le dernier échange (heure NY → UTC)", async () => {
    const ts = Date.UTC(2026, 8, 11, 20, 0, 30);
    fetchKlines.mockResolvedValueOnce([bougie(Date.UTC(2026, 8, 11, 20, 0, 0), 80_000)]);
    await expect(prixCryptoAuDernierEchange("IBIT", "2026-09-11T16:00:30")).resolves.toBe(80_000);
    expect(fetchKlines).toHaveBeenCalledWith("BTCUSDT", "1m", { limit: 1, endTime: ts });
  });

  it("mémorise par dernier échange : aucun nouvel appel tant qu'il ne change pas", async () => {
    fetchKlines.mockResolvedValue([bougie(Date.UTC(2026, 8, 11, 20, 0, 0), 2_500)]);
    await expect(prixCryptoAuDernierEchange("ETHA", "2026-09-11T16:00:00")).resolves.toBe(2_500);
    await expect(prixCryptoAuDernierEchange("ETHA", "2026-09-11T16:00:00")).resolves.toBe(2_500);
    expect(fetchKlines).toHaveBeenCalledTimes(1);
    expect(fetchKlines).toHaveBeenCalledWith("ETHUSDT", "1m", expect.anything());
  });

  it("échec réseau → null sans exception, et l'échec n'est pas mémorisé", async () => {
    fetchKlines.mockRejectedValueOnce(new Error("Binance REST 503"));
    await expect(prixCryptoAuDernierEchange("IBIT", "2026-09-12T10:00:00")).resolves.toBeNull();
    fetchKlines.mockResolvedValueOnce([bougie(Date.UTC(2026, 8, 12, 14, 0, 0), 81_000)]);
    await expect(prixCryptoAuDernierEchange("IBIT", "2026-09-12T10:00:00")).resolves.toBe(81_000);
    expect(fetchKlines).toHaveBeenCalledTimes(2);
  });

  it("bougie absente ou qui ne contient pas l'instant (trou Binance) → null", async () => {
    fetchKlines.mockResolvedValueOnce([]);
    await expect(prixCryptoAuDernierEchange("IBIT", "2026-09-13T10:00:00")).resolves.toBeNull();
    fetchKlines.mockResolvedValueOnce([bougie(Date.UTC(2026, 8, 13, 13, 0, 0), 81_000)]);
    await expect(prixCryptoAuDernierEchange("IBIT", "2026-09-13T10:00:00")).resolves.toBeNull();
    await expect(prixCryptoAuDernierEchange("IBIT", "garbage")).resolves.toBeNull();
  });
});
