import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { buildCalcContext, computeIndicator } from "../engine";
import { specStrategie } from "../utils-fabrique-strategie";
import { stratSmartMoneyDivergence } from "./stratSmartMoneyDivergence";

function makeCandles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: 1000 + i * 3600_000,
    open: 100,
    high: 105,
    low: 95,
    close: 100,
    volume: 1000,
  }));
}

describe("stratSmartMoneyDivergence", () => {
  it("expose les deux séries auxiliaires de positionnement requises", () => {
    expect(stratSmartMoneyDivergence.aux).toEqual(["lsAccount", "lsTopTrader"]);
  });

  it("produit des états long et short selon les extrêmes Smart Money / Retail", () => {
    const candles = makeCandles(5);
    const spec = specStrategie("stratSmartMoneyDivergence");
    if (spec === undefined) throw new Error("Spec stratégie absente");
    const ctx = buildCalcContext(candles);
    ctx.aux = {
      lsAccount: [1, 1, 0.25, 4, 1],
      lsTopTrader: [1, 1, 4, 0.25, 1],
    };

    const etats = spec.position(candles, { seuilSpread: 25 }, ctx);

    expect(etats).toContain(1);
    expect(etats).toContain(-1);
  });

  it("reste sans entrée lorsque les séries auxiliaires sont absentes", () => {
    const candles = makeCandles(5);

    const res = computeIndicator(stratSmartMoneyDivergence, candles, { seuilSpread: 25 });

    expect(res.series.prixEntree).toEqual(new Array(candles.length).fill(undefined));
  });
});
