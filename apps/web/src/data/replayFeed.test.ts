/**
 * Tests de la reconstruction PURE des bougies de replay (trades → OHLCV) et des
 * conversions associées. C'est le cœur du rejeu : une régression ici corrompt les
 * bougies/CVD rejoués sans erreur de compilation.
 */
import { describe, expect, it } from "vitest";
import {
  debutJour,
  reconstruireBougies,
  tfEnMs,
  versTrade,
  type TradeReplay,
} from "./replayFeed";

/** Fabrique un trade de replay. */
function tr(t: number, prix: number, qty: number, isBuyerMaker: 0 | 1): TradeReplay {
  return { t, prix, qty, isBuyerMaker };
}

describe("reconstruireBougies", () => {
  it("agrège une seule bougie (dernière = non clôturée)", () => {
    const tf = 60_000;
    const trades = [
      tr(0, 100, 1, 0), // buy (isBuyerMaker=0 → taker buy)
      tr(10_000, 105, 2, 1), // sell (isBuyerMaker=1)
      tr(20_000, 95, 1, 0), // buy
      tr(30_000, 102, 3, 1), // sell
    ];
    const bougies = reconstruireBougies(trades, tf);
    expect(bougies).toHaveLength(1);
    const b = bougies[0]!;
    expect(b.time).toBe(0);
    expect(b.open).toBe(100);
    expect(b.high).toBe(105);
    expect(b.low).toBe(95);
    expect(b.close).toBe(102);
    expect(b.volume).toBe(7);
    expect(b.buyVolume).toBe(2); // 1 + 1 (isBuyerMaker=0)
    expect(b.sellVolume).toBe(5); // 2 + 3 (isBuyerMaker=1)
    expect(b.closed).toBe(false);
  });

  it("découpe en buckets ; clôt les précédentes, laisse la dernière ouverte", () => {
    const tf = 60_000;
    const trades = [
      tr(5_000, 10, 1, 0),
      tr(59_999, 12, 1, 1),
      tr(60_000, 13, 2, 0), // nouveau bucket
      tr(119_000, 11, 1, 1),
      tr(120_000, 14, 1, 0), // encore un nouveau bucket
    ];
    const bougies = reconstruireBougies(trades, tf);
    expect(bougies.map((b) => b.time)).toEqual([0, 60_000, 120_000]);
    expect(bougies[0]!.closed).toBe(true);
    expect(bougies[1]!.closed).toBe(true);
    expect(bougies[2]!.closed).toBe(false);
    expect(bougies[0]!.open).toBe(10);
    expect(bougies[0]!.close).toBe(12);
    expect(bougies[1]!.open).toBe(13);
    expect(bougies[1]!.close).toBe(11);
    expect(bougies[2]!.open).toBe(14);
  });

  it("liste vide → aucune bougie", () => {
    expect(reconstruireBougies([], 60_000)).toEqual([]);
  });

  it("écarte les trades à temps/prix non finis", () => {
    const trades = [
      tr(Number.NaN, 100, 1, 0),
      tr(0, Number.POSITIVE_INFINITY, 1, 0),
      tr(0, 50, 2, 0),
    ];
    const bougies = reconstruireBougies(trades, 60_000);
    expect(bougies).toHaveLength(1);
    expect(bougies[0]!.open).toBe(50);
    expect(bougies[0]!.volume).toBe(2);
  });
});

describe("versTrade", () => {
  it("isBuyerMaker=1 → agresseur vendeur ; =0 → acheteur", () => {
    expect(versTrade(tr(1000, 42, 0.5, 1))).toEqual({
      time: 1000,
      price: 42,
      qty: 0.5,
      side: "sell",
    });
    expect(versTrade(tr(1000, 42, 0.5, 0)).side).toBe("buy");
  });
});

describe("tfEnMs", () => {
  it("mappe les TF de replay", () => {
    expect(tfEnMs("1m")).toBe(60_000);
    expect(tfEnMs("5m")).toBe(300_000);
    expect(tfEnMs("15m")).toBe(900_000);
    expect(tfEnMs("1h")).toBe(3_600_000);
  });
});

describe("debutJour", () => {
  it("minuit UTC d'un jour ISO", () => {
    expect(debutJour("2026-06-30")).toBe(Date.UTC(2026, 5, 30));
  });
});
