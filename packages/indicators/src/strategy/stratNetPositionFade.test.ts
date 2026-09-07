import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { buildCalcContext, computeIndicator } from "../engine";
import { specStrategie } from "../utils-fabrique-strategie";
import { stratNetPositionFade } from "./stratNetPositionFade";

function makeCandles(prices: number[]): Candle[] {
  return prices.map((p, i) => ({
    time: 1000 + i * 3600_000,
    open: p,
    high: p + 2,
    low: p - 2,
    close: p,
    volume: 1000,
  }));
}

describe("stratNetPositionFade", () => {
  it("expose la série auxiliaire de positionnement requise", () => {
    expect(stratNetPositionFade.aux).toEqual(["lsAccount"]);
  });

  it("produit des états long et short avec un positionnement extrême injecté", () => {
    const prices = [100, 100, 110, 90, 90];
    const candles = makeCandles(prices);
    const spec = specStrategie("stratNetPositionFade");
    if (spec === undefined) throw new Error("Spec stratégie absente");
    const ctx = buildCalcContext(candles);
    ctx.aux = { lsAccount: [1, 1, 0.25, 4, 4] };

    const etats = spec.position(candles, { seuilNet: 30, emaLength: 2 }, ctx);

    expect(etats).toContain(1);
    expect(etats).toContain(-1);
  });

  it("reste sans entrée lorsque le positionnement auxiliaire est absent", () => {
    const candles = makeCandles([100, 100, 110, 90, 90]);

    const res = computeIndicator(stratNetPositionFade, candles, { seuilNet: 30, emaLength: 2 });

    expect(res.series.prixEntree).toEqual(new Array(candles.length).fill(undefined));
  });
});
