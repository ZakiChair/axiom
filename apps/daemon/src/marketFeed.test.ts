import { describe, expect, test } from "bun:test";
import type { Candle } from "@axiom/types";
import {
  ajouterBougie,
  backfill,
  construireUrlFlux,
  FENETRE_BOUGIES,
  fusionnerBougies,
  PAGE_KLINES_MAX,
  parserHistoriqueFunding,
  parserPremiumIndex,
  zScoreFunding,
} from "./marketFeed";

/** Fabrique une bougie minimale à un temps donné. */
function bougie(time: number, close = 1): Candle {
  return { time, open: close, high: close, low: close, close, volume: 0 };
}

const MINUTE_MS = 60_000;

/** Kline REST Binance d'une minute ouverte à `time` (tuple brut, ordre figé par l'API). */
function kline(time: number): unknown[] {
  return [time, "1", "1", "1", "1", "2", time + MINUTE_MS - 1, "2", 1, "1", "1", "0"];
}

/**
 * Simule `/api/v3/klines` sur un historique 1 min régulier qui s'arrête à `fin` (dernière
 * ouverture, bougie en formation) et commence à `debut` : respecte `limit`, `endTime`
 * (ouvertures ≤ endTime), et journalise les requêtes.
 */
function serveurKlines(debut: number, fin: number) {
  const requetes: URLSearchParams[] = [];
  const lire = async (url: string): Promise<unknown> => {
    const params = new URL(url).searchParams;
    requetes.push(params);
    const limit = Number(params.get("limit"));
    const endTime = params.get("endTime");
    const dernier = endTime === null ? fin : Math.min(fin, Math.floor(Number(endTime) / MINUTE_MS) * MINUTE_MS);
    const out: unknown[] = [];
    for (let t = dernier; t >= debut && out.length < limit; t -= MINUTE_MS) out.unshift(kline(t));
    return out;
  };
  return { lire, requetes };
}

describe("construireUrlFlux", () => {
  test("null si aucun symbole", () => {
    expect(construireUrlFlux([])).toBeNull();
  });

  test("streams combinés miniTicker + kline_1m en minuscules", () => {
    expect(construireUrlFlux(["BTCUSDT", "ETHUSDT"])).toBe(
      "wss://stream.binance.com:9443/stream?streams=" +
        "btcusdt@miniTicker/btcusdt@kline_1m/ethusdt@miniTicker/ethusdt@kline_1m",
    );
  });
});

describe("ajouterBougie", () => {
  test("ajoute en fin quand le temps est strictement plus grand", () => {
    const f: Candle[] = [bougie(1000)];
    ajouterBougie(f, bougie(2000));
    expect(f.map((c) => c.time)).toEqual([1000, 2000]);
  });

  test("remplace la dernière bougie à temps égal (mise à jour de clôture)", () => {
    const f: Candle[] = [bougie(1000), bougie(2000, 5)];
    ajouterBougie(f, bougie(2000, 9));
    expect(f).toHaveLength(2);
    expect(f[1]?.close).toBe(9);
  });

  test("ignore une bougie hors ordre (antérieure)", () => {
    const f: Candle[] = [bougie(2000)];
    ajouterBougie(f, bougie(1000));
    expect(f.map((c) => c.time)).toEqual([2000]);
  });

  test("borne la fenêtre à FENETRE_BOUGIES (1 500 : amorce d'AXIS)", () => {
    expect(FENETRE_BOUGIES).toBe(1500);
    const f: Candle[] = [];
    for (let i = 0; i < FENETRE_BOUGIES + 50; i++) ajouterBougie(f, bougie(i * 60_000));
    expect(f).toHaveLength(FENETRE_BOUGIES);
    // Les plus anciennes sont évincées : la 1re restante = index 50.
    expect(f[0]?.time).toBe(50 * 60_000);
  });
});

describe("backfill paginé (Binance : 1 000 klines par requête au plus)", () => {
  // Bougie en formation = la minute courante (closeTime encore à venir) ; tout le reste est clos.
  const enFormation = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;

  test("1 500 bougies clôturées en deux pages, ordre croissant, sans doublon ni bougie en formation", async () => {
    const { lire, requetes } = serveurKlines(enFormation - 10_000 * MINUTE_MS, enFormation);
    const bougies = await backfill("btcusdt", lire);
    expect(bougies).toHaveLength(FENETRE_BOUGIES);
    expect(bougies.every((c) => c.closed === true)).toBe(true);
    expect(bougies[bougies.length - 1]?.time).toBe(enFormation - MINUTE_MS);
    expect(bougies[0]?.time).toBe(enFormation - FENETRE_BOUGIES * MINUTE_MS);
    for (let i = 1; i < bougies.length; i++) expect(bougies[i]!.time - bougies[i - 1]!.time).toBe(MINUTE_MS);
    expect(requetes).toHaveLength(2);
    expect(requetes[0]?.get("symbol")).toBe("BTCUSDT");
    expect(requetes[0]?.get("interval")).toBe("1m");
    expect(Number(requetes[0]?.get("limit"))).toBe(PAGE_KLINES_MAX);
    expect(requetes[0]?.has("endTime")).toBe(false);
    // Seconde page : juste avant la plus ancienne reçue (999 closes), le manque + 1.
    expect(Number(requetes[1]?.get("endTime"))).toBe(enFormation - 999 * MINUTE_MS - 1);
    expect(Number(requetes[1]?.get("limit"))).toBe(FENETRE_BOUGIES - 999 + 1);
  });

  test("historique plus court que la fenêtre : s'arrête à la page sans bougie plus ancienne", async () => {
    const { lire, requetes } = serveurKlines(enFormation - 1200 * MINUTE_MS, enFormation);
    const bougies = await backfill("ethusdt", lire);
    expect(bougies).toHaveLength(1200);
    expect(bougies[0]?.time).toBe(enFormation - 1200 * MINUTE_MS);
    // 999 + 201, puis une troisième requête vide qui clôt la boucle.
    expect(requetes).toHaveLength(3);
  });

  test("symbole sans aucune kline : tableau vide, une seule requête", async () => {
    const { lire, requetes } = serveurKlines(enFormation + MINUTE_MS, enFormation);
    expect(await backfill("x", lire)).toEqual([]);
    expect(requetes).toHaveLength(1);
  });
});

describe("fusionnerBougies", () => {
  test("union triée du backfill et des clôtures WS reçues pendant la requête", () => {
    const backfillRecu = [bougie(1000), bougie(2000), bougie(3000)];
    const ws = [bougie(4000), bougie(5000)];
    expect(fusionnerBougies(backfillRecu, ws).map((c) => c.time)).toEqual([1000, 2000, 3000, 4000, 5000]);
    expect(fusionnerBougies(backfillRecu, []).map((c) => c.time)).toEqual([1000, 2000, 3000]);
    expect(fusionnerBougies([], ws).map((c) => c.time)).toEqual([4000, 5000]);
  });

  test("à temps égal, la bougie du flux prime ; la fenêtre reste bornée", () => {
    const fusion = fusionnerBougies([bougie(1000, 1), bougie(2000, 1)], [bougie(2000, 9)]);
    expect(fusion.map((c) => [c.time, c.close])).toEqual([[1000, 1], [2000, 9]]);
    const longue = Array.from({ length: FENETRE_BOUGIES + 10 }, (_, i) => bougie(i * MINUTE_MS));
    expect(fusionnerBougies(longue, [bougie((FENETRE_BOUGIES + 10) * MINUTE_MS)])).toHaveLength(FENETRE_BOUGIES);
  });
});

describe("parserPremiumIndex", () => {
  test("tableau multi-symboles → Map fraction majuscules", () => {
    const map = parserPremiumIndex([
      { symbol: "btcusdt", lastFundingRate: "0.0001" },
      { symbol: "ETHUSDT", lastFundingRate: "-0.0005" },
      { symbol: "XRPUSDT", lastFundingRate: "oops" }, // ignoré
      { symbol: 42, lastFundingRate: "0.01" }, // symbole non string
    ]);
    expect(map.get("BTCUSDT")).toBe(0.0001);
    expect(map.get("ETHUSDT")).toBe(-0.0005);
    expect(map.has("XRPUSDT")).toBe(false);
    expect(map.size).toBe(2);
  });

  test("objet unique (query ?symbol=) aussi accepté", () => {
    const map = parserPremiumIndex({ symbol: "BTCUSDT", lastFundingRate: 0.001 });
    expect(map.get("BTCUSDT")).toBe(0.001);
  });

  test("payload invalide → Map vide", () => {
    expect(parserPremiumIndex(null).size).toBe(0);
    expect(parserPremiumIndex("x").size).toBe(0);
    expect(parserPremiumIndex([]).size).toBe(0);
  });
});

describe("parserHistoriqueFunding", () => {
  test("extrait les rates finis en ordre d'entrée", () => {
    expect(
      parserHistoriqueFunding([
        { fundingRate: "0.0001" },
        { fundingRate: -0.0002 },
        { fundingRate: "nan" },
        null,
      ]),
    ).toEqual([0.0001, -0.0002]);
  });

  test("non-tableau → []", () => {
    expect(parserHistoriqueFunding({})).toEqual([]);
  });
});

describe("zScoreFunding", () => {
  test("undefined si série trop courte", () => {
    expect(zScoreFunding([])).toBeUndefined();
    expect(zScoreFunding([1])).toBeUndefined();
  });

  test("z = 0 si tous les points égaux (sd nul)", () => {
    expect(zScoreFunding([0.001, 0.001, 0.001])).toBe(0);
  });

  test("dernier point extrême → |z| élevé", () => {
    // 29 points à 0 puis un spike à 1 → z clairement > 2
    const series = Array.from({ length: 29 }, () => 0).concat([1]);
    const z = zScoreFunding(series);
    expect(z).toBeDefined();
    expect(Math.abs(z as number)).toBeGreaterThan(2);
  });
});
