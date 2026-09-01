import { describe, it, expect, vi } from "vitest";
import type { Liquidation } from "@axiom/types";
import {
  chunkCoinalyzeSymbols,
  filtrerFrontieres8h,
  normalizeInterval,
  prochainReglementFunding,
  groupLiquidationBuckets,
  toCoinalyzeSymbol,
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

describe("filtrerFrontieres8h", () => {
  const h = (heure: number) => Date.UTC(2026, 6, 2, heure, 0, 0);

  it("ne garde que les points sur une frontière de règlement 8 h UTC (00/08/16), rejette 04/12/20", () => {
    // 6 clôtures 4 h : la moitié hors-cycle (04/12/20) doit disparaître, l'ordre est préservé.
    const points = [
      { time: h(0), v: "00h" },
      { time: h(4), v: "04h" },
      { time: h(8), v: "08h" },
      { time: h(12), v: "12h" },
      { time: h(16), v: "16h" },
      { time: h(20), v: "20h" },
    ];
    expect(filtrerFrontieres8h(points)).toEqual([
      { time: h(0), v: "00h" },
      { time: h(8), v: "08h" },
      { time: h(16), v: "16h" },
    ]);
  });

  it("renvoie [] si aucun point ne tombe sur une frontière 8 h", () => {
    expect(filtrerFrontieres8h([{ time: h(4) }, { time: h(12) }, { time: h(20) }])).toEqual([]);
  });

  it("renvoie [] pour une entrée vide", () => {
    expect(filtrerFrontieres8h([])).toEqual([]);
  });
});
