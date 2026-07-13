/**
 * Tests PURS du parse / export CSV portefeuille (lot D1).
 */
import { describe, expect, it } from "vitest";
import {
  parsePortfolioCsv,
  parseSideCsv,
  parseEntryTimeCsv,
  parseExchangeCsv,
  exporterPortfolioCsv,
  ligneCsvVersNouvelle,
  ENTETES_CSV_PORTFOLIO,
} from "./portfolioCsv";
import type { Position } from "./portfolio";

describe("parseSideCsv", () => {
  it("accepte long/short et alias buy/sell/l/s", () => {
    expect(parseSideCsv("long")).toBe("long");
    expect(parseSideCsv("SHORT")).toBe("short");
    expect(parseSideCsv("buy")).toBe("long");
    expect(parseSideCsv("sell")).toBe("short");
    expect(parseSideCsv("l")).toBe("long");
    expect(parseSideCsv("S")).toBe("short");
  });

  it("rejette les valeurs inconnues", () => {
    expect(parseSideCsv("")).toBeNull();
    expect(parseSideCsv("flat")).toBeNull();
  });
});

describe("parseEntryTimeCsv", () => {
  it("parse ISO-8601", () => {
    const ms = parseEntryTimeCsv("2026-03-15T12:00:00.000Z");
    expect(ms).toBe(Date.parse("2026-03-15T12:00:00.000Z"));
  });

  it("parse epoch ms et epoch s (10 chiffres)", () => {
    expect(parseEntryTimeCsv("1710504000000")).toBe(1710504000000);
    expect(parseEntryTimeCsv("1710504000")).toBe(1710504000 * 1000);
  });

  it("invalide → null", () => {
    expect(parseEntryTimeCsv("")).toBeNull();
    expect(parseEntryTimeCsv("pas-une-date")).toBeNull();
    expect(parseEntryTimeCsv("0")).toBeNull();
  });
});

describe("parseExchangeCsv", () => {
  it("valide / vide / inconnu", () => {
    expect(parseExchangeCsv("binance")).toBe("binance");
    expect(parseExchangeCsv("BINANCE")).toBe("binance");
    expect(parseExchangeCsv("")).toBeUndefined();
    expect(parseExchangeCsv(undefined)).toBeUndefined();
    expect(parseExchangeCsv("ftx")).toBeNull();
  });
});

describe("parsePortfolioCsv", () => {
  const HEADER = "symbol,side,qty,entryPrice,entryTime,exchange";

  it("parse 10 lignes valides (acceptation dry-run)", () => {
    const rows = Array.from({ length: 10 }, (_, i) => {
      const sym = i % 2 === 0 ? "BTCUSDT" : "ETHUSDT";
      const side = i % 3 === 0 ? "short" : "long";
      const qty = 0.1 + i * 0.01;
      const px = 50_000 + i * 100;
      const t = `2026-03-15T0${Math.min(i, 9)}:00:00.000Z`;
      const ex = i % 2 === 0 ? "binance" : "bybit";
      return `${sym},${side},${qty},${px},${t},${ex}`;
    });
    const r = parsePortfolioCsv([HEADER, ...rows].join("\n"));
    expect(r.erreurs).toHaveLength(0);
    expect(r.ok).toHaveLength(10);
    expect(r.ok[0]?.symbole).toBe("BTCUSDT");
    expect(r.ok[0]?.direction).toBe("short"); // i=0 → i%3===0
    expect(r.ok[0]?.source).toBe("binance");
    expect(r.ok[1]?.direction).toBe("long");
  });

  it("exchange optionnel ; symbole normalisé en majuscules", () => {
    const csv = `${HEADER}\nbtcusdt,buy,1,100,2026-01-01T00:00:00Z,\n`;
    const r = parsePortfolioCsv(csv);
    expect(r.erreurs).toHaveLength(0);
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]?.symbole).toBe("BTCUSDT");
    expect(r.ok[0]?.direction).toBe("long");
    expect(r.ok[0]?.source).toBeUndefined();
  });

  it("en-têtes case-insensitive et réordonnables", () => {
    const csv =
      "EntryTime,Exchange,Symbol,Side,Qty,EntryPrice\n" +
      "2026-06-01T00:00:00Z,okx,SOLUSDT,short,2,150\n";
    const r = parsePortfolioCsv(csv);
    expect(r.erreurs).toHaveLength(0);
    expect(r.ok[0]).toMatchObject({
      symbole: "SOLUSDT",
      direction: "short",
      taille: 2,
      prixEntree: 150,
      source: "okx",
    });
  });

  it("collecte les erreurs par ligne sans bloquer les valides", () => {
    const csv = [
      HEADER,
      "BTCUSDT,long,1,100,2026-01-01T00:00:00Z,binance", // ok
      "ETHUSDT,flat,1,100,2026-01-01T00:00:00Z,binance", // side
      ",long,1,100,2026-01-01T00:00:00Z,binance", // symbol
      "SOLUSDT,long,0,100,2026-01-01T00:00:00Z,binance", // qty
      "XRPUSDT,long,1,-5,2026-01-01T00:00:00Z,binance", // price
      "ADAUSDT,long,1,100,not-a-date,binance", // time
      "DOGEUSDT,long,1,0.1,2026-01-01T00:00:00Z,ftx", // exchange
      "LINKUSDT,sell,3,20,1710504000,coinbase", // ok (epoch s + sell)
    ].join("\n");
    const r = parsePortfolioCsv(csv);
    expect(r.ok).toHaveLength(2);
    expect(r.erreurs).toHaveLength(6);
    expect(r.erreurs.map((e) => e.ligne)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(r.ok[1]?.direction).toBe("short");
    expect(r.ok[1]?.dateEntree).toBe(1710504000 * 1000);
  });

  it("CSV vide / en-têtes manquants", () => {
    expect(parsePortfolioCsv("").erreurs[0]?.ligne).toBe(0);
    const r = parsePortfolioCsv("foo,bar\n1,2\n");
    expect(r.ok).toHaveLength(0);
    expect(r.erreurs[0]?.message).toMatch(/En-têtes manquants/);
  });
});

describe("ligneCsvVersNouvelle", () => {
  it("injecte la source défaut si absente", () => {
    const n = ligneCsvVersNouvelle(
      {
        symbole: "BTCUSDT",
        direction: "long",
        taille: 1,
        prixEntree: 100,
        dateEntree: 1_000,
      },
      "binance",
    );
    expect(n.source).toBe("binance");
    expect(n.dateEntree).toBe(1_000);
  });

  it("conserve la source de la ligne si présente", () => {
    const n = ligneCsvVersNouvelle(
      {
        symbole: "ETHUSDT",
        direction: "short",
        taille: 2,
        prixEntree: 50,
        dateEntree: 2_000,
        source: "bybit",
      },
      "binance",
    );
    expect(n.source).toBe("bybit");
  });
});

describe("exporterPortfolioCsv", () => {
  const pos = (over: Partial<Position>): Position => ({
    id: over.id ?? "p1",
    symbole: over.symbole ?? "BTCUSDT",
    source: over.source ?? "binance",
    direction: over.direction ?? "long",
    taille: over.taille ?? 1,
    prixEntree: over.prixEntree ?? 100,
    dateEntree: over.dateEntree ?? Date.parse("2026-03-15T12:00:00.000Z"),
    statut: over.statut ?? "ouvert",
  });

  it("miroir round-trip : export → parse conserve les champs d'entrée", () => {
    const positions = [
      pos({
        symbole: "BTCUSDT",
        direction: "long",
        taille: 0.5,
        prixEntree: 65_000,
        dateEntree: Date.parse("2026-03-15T12:00:00.000Z"),
        source: "binance",
      }),
      pos({
        id: "p2",
        symbole: "ETHUSDT",
        direction: "short",
        taille: 2,
        prixEntree: 3_200,
        dateEntree: Date.parse("2026-03-14T08:30:00.000Z"),
        source: "bybit",
      }),
    ];
    const csv = exporterPortfolioCsv(positions);
    expect(csv.startsWith(ENTETES_CSV_PORTFOLIO.join(","))).toBe(true);
    const r = parsePortfolioCsv(csv);
    expect(r.erreurs).toHaveLength(0);
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0]).toMatchObject({
      symbole: "BTCUSDT",
      direction: "long",
      taille: 0.5,
      prixEntree: 65_000,
      source: "binance",
    });
    expect(r.ok[0]?.dateEntree).toBe(Date.parse("2026-03-15T12:00:00.000Z"));
    expect(r.ok[1]).toMatchObject({
      symbole: "ETHUSDT",
      direction: "short",
      taille: 2,
      prixEntree: 3_200,
      source: "bybit",
    });
  });

  it("export vide = en-tête seul", () => {
    const csv = exporterPortfolioCsv([]);
    expect(csv.trim()).toBe(ENTETES_CSV_PORTFOLIO.join(","));
  });
});
