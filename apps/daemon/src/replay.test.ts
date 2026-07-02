import { describe, expect, test } from "bun:test";
import {
  estJourValide,
  estSymboleValide,
  LIMITE_DEFAUT,
  LIMITE_MAX,
  normaliserHorodatage,
  parseAggTradesCsv,
  parseCheminReplay,
  parseLigneTrade,
  parseRequeteTrades,
} from "./replay";

describe("normaliserHorodatage", () => {
  test("millisecondes conservées", () => {
    expect(normaliserHorodatage(1_782_000_000_000)).toBe(1_782_000_000_000);
  });
  test("microsecondes converties en ms", () => {
    expect(normaliserHorodatage(1_782_000_000_000_000)).toBe(1_782_000_000_000);
  });
  test("non-fini → NaN", () => {
    expect(Number.isNaN(normaliserHorodatage(Number.POSITIVE_INFINITY))).toBe(true);
  });
});

describe("parseLigneTrade", () => {
  test("ligne valide (isBuyerMaker=true)", () => {
    // aggId, prix, qty, firstId, lastId, timestamp(ms), isBuyerMaker, isBestMatch
    expect(parseLigneTrade("123,42000.5,0.01,1,1,1782000000000,true,true")).toEqual({
      t: 1_782_000_000_000,
      prix: 42000.5,
      qty: 0.01,
      isBuyerMaker: 1,
    });
  });
  test("isBuyerMaker=false → 0 ; timestamp µs normalisé", () => {
    expect(parseLigneTrade("124,10,2,1,1,1782000000000000,false,true")).toEqual({
      t: 1_782_000_000_000,
      prix: 10,
      qty: 2,
      isBuyerMaker: 0,
    });
  });
  test("en-tête écarté (prix non numérique)", () => {
    expect(parseLigneTrade("agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker,is_best_match")).toBeNull();
  });
  test("ligne vide / champs manquants → null", () => {
    expect(parseLigneTrade("")).toBeNull();
    expect(parseLigneTrade("1,2,3")).toBeNull();
  });
  test("tolère les retours chariot \\r (CRLF)", () => {
    expect(parseLigneTrade("1,5,1,1,1,1000,1,true\r")).toEqual({ t: 1000, prix: 5, qty: 1, isBuyerMaker: 1 });
  });
});

describe("parseAggTradesCsv", () => {
  test("parse un CSV avec en-tête + lignes, écarte l'invalide", () => {
    const csv = [
      "agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker,is_best_match",
      "1,100,1,1,1,1000,false,true",
      "2,101,2,2,2,2000,true,true",
      "corrompue",
      "3,99,0.5,3,3,3000,false,true",
    ].join("\n");
    expect(parseAggTradesCsv(csv)).toEqual([
      { t: 1000, prix: 100, qty: 1, isBuyerMaker: 0 },
      { t: 2000, prix: 101, qty: 2, isBuyerMaker: 1 },
      { t: 3000, prix: 99, qty: 0.5, isBuyerMaker: 0 },
    ]);
  });
});

describe("estJourValide / estSymboleValide", () => {
  test("jour", () => {
    expect(estJourValide("2026-06-30")).toBe(true);
    expect(estJourValide("2026-6-30")).toBe(false);
    expect(estJourValide("30-06-2026")).toBe(false);
  });
  test("symbole", () => {
    expect(estSymboleValide("BTCUSDT")).toBe(true);
    expect(estSymboleValide("ETH-USD")).toBe(false);
    expect(estSymboleValide("../etc")).toBe(false);
    expect(estSymboleValide("A")).toBe(false);
  });
});

describe("parseCheminReplay", () => {
  test("/replay/status/:symbole/:jour", () => {
    expect(parseCheminReplay("/replay/status/BTCUSDT/2026-06-30")).toEqual({
      symbole: "BTCUSDT",
      jour: "2026-06-30",
    });
  });
  test("/replay/trades/:symbole/:jour (symbole remis en MAJ)", () => {
    expect(parseCheminReplay("/replay/trades/btcusdt/2026-06-30")).toEqual({
      symbole: "BTCUSDT",
      jour: "2026-06-30",
    });
  });
  test("formes invalides → null", () => {
    expect(parseCheminReplay("/replay/trades/BTCUSDT")).toBeNull(); // jour manquant
    expect(parseCheminReplay("/replay/trades/BTC/USDT/2026-06-30")).toBeNull(); // segment en trop
    expect(parseCheminReplay("/replay/trades/BAD!/2026-06-30")).toBeNull(); // symbole invalide
    expect(parseCheminReplay("/replay/trades/BTCUSDT/pas-une-date")).toBeNull();
  });
});

describe("parseRequeteTrades", () => {
  test("depuis + limite lus", () => {
    expect(parseRequeteTrades(new URLSearchParams("depuis=1000&limite=42"))).toEqual({
      depuis: 1000,
      limite: 42,
    });
  });
  test("limite absente → défaut ; depuis absent → null", () => {
    expect(parseRequeteTrades(new URLSearchParams(""))).toEqual({ depuis: null, limite: LIMITE_DEFAUT });
  });
  test("limite bornée à [1, LIMITE_MAX]", () => {
    expect(parseRequeteTrades(new URLSearchParams("limite=0")).limite).toBe(1);
    expect(parseRequeteTrades(new URLSearchParams("limite=99999999")).limite).toBe(LIMITE_MAX);
  });
});
