/**
 * Fenêtre LIQ — calculs PURS : filtre de fenêtre glissante, stats agrégées (totaux
 * long/short, dominance, max, répartition par venue), buckets temporels du
 * mini-histogramme et magnitude log du feed.
 */
import { describe, expect, it } from "vitest";
import type { LiqEvent } from "../chart/liquidationMarkers";
import type { LiqDaemon } from "../data/daemon";
import {
  bucketsTemporels,
  daemonVersEvenements,
  filtrerFenetre,
  magnitudeRelative,
  statsLiquidations,
  topLiquidations,
} from "./liquidationsWindow.util";

/** Fabrique un LiqEvent avec défauts raisonnables. */
function ev(partiel: Partial<LiqEvent>): LiqEvent {
  return { time: 1_000, side: "long", price: 100, qty: 1, usd: 100, venue: "bybit", ...partiel };
}

describe("filtrerFenetre", () => {
  it("ne garde que les événements à time ≥ depuisMs (borne incluse)", () => {
    const events = [ev({ time: 999 }), ev({ time: 1_000 }), ev({ time: 2_000 })];
    expect(filtrerFenetre(events, 1_000).map((e) => e.time)).toEqual([1_000, 2_000]);
  });
  it("liste vide → liste vide", () => {
    expect(filtrerFenetre([], 0)).toEqual([]);
  });
});

describe("statsLiquidations", () => {
  it("agrège totaux long/short, dominance, nb, max et répartition par venue", () => {
    const events = [
      ev({ side: "long", usd: 300, venue: "bybit" }),
      ev({ side: "long", usd: 100, venue: "okx" }),
      ev({ side: "short", usd: 600, venue: "bybit" }),
    ];
    const s = statsLiquidations(events);
    expect(s.longUsd).toBe(400);
    expect(s.shortUsd).toBe(600);
    expect(s.total).toBe(1_000);
    expect(s.partLong).toBeCloseTo(0.4);
    expect(s.nb).toBe(3);
    expect(s.maxUsd).toBe(600);
    expect(s.parVenue).toEqual({
      bybit: { usd: 900, nb: 2 },
      okx: { usd: 100, nb: 1 },
    });
  });
  it("liste vide → zéros et partLong null (pas de division par zéro)", () => {
    const s = statsLiquidations([]);
    expect(s).toMatchObject({ longUsd: 0, shortUsd: 0, total: 0, partLong: null, nb: 0, maxUsd: 0 });
    expect(s.parVenue).toEqual({});
  });
});

describe("bucketsTemporels", () => {
  it("répartit les événements dans nBuckets réguliers sur [depuisMs, nowMs]", () => {
    const events = [
      ev({ time: 0, side: "long", usd: 10 }), // bucket 0
      ev({ time: 40, side: "short", usd: 20 }), // bucket 1 (pas = 25)
      ev({ time: 99, side: "long", usd: 30 }), // dernier bucket
      ev({ time: 100, side: "short", usd: 40 }), // borne nowMs incluse → dernier bucket
    ];
    const buckets = bucketsTemporels(events, 0, 100, 4);
    expect(buckets).toHaveLength(4);
    expect(buckets.map((b) => b.t)).toEqual([0, 25, 50, 75]);
    expect(buckets[0]).toEqual({ t: 0, longUsd: 10, shortUsd: 0 });
    expect(buckets[1]).toEqual({ t: 25, longUsd: 0, shortUsd: 20 });
    expect(buckets[2]).toEqual({ t: 50, longUsd: 0, shortUsd: 0 });
    expect(buckets[3]).toEqual({ t: 75, longUsd: 30, shortUsd: 40 });
  });
  it("écarte les événements hors fenêtre", () => {
    const buckets = bucketsTemporels([ev({ time: -1, usd: 5 }), ev({ time: 101, usd: 5 })], 0, 100, 2);
    expect(buckets.every((b) => b.longUsd === 0 && b.shortUsd === 0)).toBe(true);
  });
  it("paramètres dégénérés (nBuckets < 1 ou fenêtre vide) → []", () => {
    expect(bucketsTemporels([ev({})], 0, 100, 0)).toEqual([]);
    expect(bucketsTemporels([ev({})], 100, 100, 4)).toEqual([]);
  });
});

describe("daemonVersEvenements", () => {
  it("traduit t → time et copie side/price/qty/usd/venue (jamais de flag approx)", () => {
    const rows: LiqDaemon[] = [
      { t: 1_000, venue: "okx", side: "short", price: 200, qty: 2, usd: 400 },
      { t: 2_000, venue: "bybit", side: "long", price: 100, qty: 3, usd: 300 },
    ];
    expect(daemonVersEvenements(rows)).toEqual([
      { time: 1_000, side: "short", price: 200, qty: 2, usd: 400, venue: "okx" },
      { time: 2_000, side: "long", price: 100, qty: 3, usd: 300, venue: "bybit" },
    ]);
  });
  it("liste vide → liste vide", () => {
    expect(daemonVersEvenements([])).toEqual([]);
  });
});

describe("topLiquidations", () => {
  it("renvoie les n plus grosses liquidations, triées par notionnel décroissant", () => {
    const events = [ev({ usd: 100 }), ev({ usd: 500 }), ev({ usd: 300 }), ev({ usd: 200 })];
    const copie = [...events];
    expect(topLiquidations(events, 2).map((e) => e.usd)).toEqual([500, 300]);
    // L'entrée n'est pas mutée (tri sur copie).
    expect(events).toEqual(copie);
  });
  it("n plus grand que la liste → toute la liste triée", () => {
    expect(topLiquidations([ev({ usd: 1 }), ev({ usd: 2 })], 10).map((e) => e.usd)).toEqual([2, 1]);
  });
  it("n ≤ 0 ou liste vide → []", () => {
    expect(topLiquidations([ev({})], 0)).toEqual([]);
    expect(topLiquidations([], 5)).toEqual([]);
  });
});

describe("magnitudeRelative", () => {
  it("échelle log ∈ [0,1] : 0 pour usd nul, 1 pour usd = maxUsd", () => {
    expect(magnitudeRelative(0, 1_000_000)).toBe(0);
    expect(magnitudeRelative(1_000_000, 1_000_000)).toBe(1);
    const mi = magnitudeRelative(1_000, 1_000_000);
    expect(mi).toBeGreaterThan(0);
    expect(mi).toBeLessThan(1);
  });
  it("maxUsd ≤ 0 → 0 (pas de NaN)", () => {
    expect(magnitudeRelative(100, 0)).toBe(0);
  });
});
