import { describe, it, expect, vi } from "vitest";
import type { Liquidation } from "@axiom/types";
import {
  chunkCoinalyzeSymbols,
  normalizeInterval,
  prochainReglementFunding,
  groupLiquidationBuckets,
  toCoinalyzeSymbol,
  unPointSurDeux,
} from "./coinalyze";

describe("prochainReglementFunding", () => {
  const HUIT_H = 8 * 60 * 60 * 1000;

  it("renvoie la prochaine frontière de 8 h (00/08/16 UTC)", () => {
    // 03:00 UTC → prochain règlement à 08:00 UTC.
    const now = Date.UTC(2026, 6, 2, 3, 0, 0);
    expect(prochainReglementFunding(now)).toBe(Date.UTC(2026, 6, 2, 8, 0, 0));
    // 12:30 UTC → prochain règlement à 16:00 UTC.
    expect(prochainReglementFunding(Date.UTC(2026, 6, 2, 12, 30, 0))).toBe(Date.UTC(2026, 6, 2, 16, 0, 0));
  });

  it("sur une frontière exacte, renvoie la frontière SUIVANTE (le règlement vient d'avoir lieu)", () => {
    expect(prochainReglementFunding(0)).toBe(HUIT_H);
    expect(prochainReglementFunding(HUIT_H)).toBe(2 * HUIT_H);
  });
});

describe("groupLiquidationBuckets", () => {
  const base = { symbol: "BTCUSDT_PERP.A", price: NaN, qty: NaN };
  const liqs: Liquidation[] = [
    { ...base, time: 200, side: "short", qtyUsd: 3832.32 },
    { ...base, time: 100, side: "long", qtyUsd: 599.996 },
    { ...base, time: 200, side: "long", qtyUsd: 262094.76 },
  ];

  it("agrège long/short par bucket temporel, tri ascendant", () => {
    const buckets = groupLiquidationBuckets(liqs);
    expect(buckets).toEqual([
      { time: 100, longUsd: 599.996, shortUsd: 0 },
      { time: 200, longUsd: 262094.76, shortUsd: 3832.32 },
    ]);
  });

  it("traite un notionnel NaN comme 0 (pas de propagation NaN)", () => {
    const withNan: Liquidation[] = [{ ...base, time: 300, side: "long", qtyUsd: NaN }];
    expect(groupLiquidationBuckets(withNan)).toEqual([{ time: 300, longUsd: 0, shortUsd: 0 }]);
  });
});

describe("chunkCoinalyzeSymbols (batch B2)", () => {
  it("mappe Binance → Coinalyze et découpe en paquets", () => {
    expect(toCoinalyzeSymbol("btcusdt")).toBe("BTCUSDT_PERP.A");
    const chunks = chunkCoinalyzeSymbols(["BTCUSDT", "ETHUSDT", "SOLUSDT"], 2);
    expect(chunks).toEqual([
      ["BTCUSDT_PERP.A", "ETHUSDT_PERP.A"],
      ["SOLUSDT_PERP.A"],
    ]);
  });

  it("renvoie [] pour une liste vide", () => {
    expect(chunkCoinalyzeSymbols([])).toEqual([]);
  });
});

describe("normalizeInterval", () => {
  it("laisse passer un intervalle supporté sans avertir", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(normalizeInterval("4hour")).toBe("4hour");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("AVERTIT sur un intervalle inconnu au lieu de replier en silence (le piège « 8hour »)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(normalizeInterval("8hour")).toBe("5min"); // repli conservé, mais bruyant
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("unPointSurDeux", () => {
  it("garde un point sur deux EN PARTANT DE LA FIN (le dernier est toujours retenu)", () => {
    // 5 clôtures 4 h : on veut approx. la cadence 8 h en retenant les clôtures paires depuis la fin.
    expect(unPointSurDeux([1, 2, 3, 4, 5])).toEqual([1, 3, 5]);
    expect(unPointSurDeux([1, 2, 3, 4])).toEqual([2, 4]);
    expect(unPointSurDeux([])).toEqual([]);
    expect(unPointSurDeux([7])).toEqual([7]);
  });
});
