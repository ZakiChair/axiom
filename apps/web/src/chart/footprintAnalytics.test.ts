/**
 * Tests — détection d'imbalances et de divergences delta dans un footprint.
 *
 * Convention footprint :
 *  - ask imbalance au niveau i = `buyVol[i] ≥ (ratio/100) × sellVol[i-1]`
 *    (diagonale : agression acheteuse au niveau i vs passif vendeur un tick en dessous)
 *    ET `buyVol[i] ≥ minVol`.
 *  - bid imbalance symétrique : `sellVol[i] ≥ (ratio/100) × buyVol[i+1]`.
 *  - stacked = membre d'une suite de ≥ 3 imbalances consécutives du même côté.
 *  - divergence delta bear = `high > high précédent && delta < 0`.
 *  - divergence delta bull = `low < low précédent && delta > 0`.
 */
import { describe, expect, it } from "vitest";
import {
  detectImbalances,
  detectDeltaDivergences,
  type ImbalanceFlags,
} from "./footprintAnalytics";
import type { FootprintRow } from "@axiom/types";
import type { Candle, FootprintBar } from "@axiom/types";

// ───────────────────────────── Helpers tests ─────────────────────────────

/** Bougie compacte OHLC (le delta vit sur FootprintBar, pas sur Candle). */
function ck(time: number, h: number, l: number, _d: number): Candle {
  return { time, open: 0, high: h, low: l, close: 0, volume: 100 };
}

/** Rows de footprint triées par prix croissant. */
function rows(
  buy: number[],
  sell: number[]
): FootprintRow[] {
  const out: FootprintRow[] = [];
  for (let i = 0; i < buy.length; i++) {
    const b = buy[i] ?? 0;
    const s = sell[i] ?? 0;
    out.push({ price: 100 + i, buyVol: b, sellVol: s });
  }
  return out;
}

// ───────────────────────────── Imbalances ─────────────────────────────

describe("detectImbalances", () => {
  it("détecte un ask imbalance au seuil exact (300%)", () => {
    // ratio=300 → il faut buyVol[i] ≥ 3×sellVol[i-1]
    // i=1 : buy=300, sellVol[i-1]=sell[0]=100 → 300 ≥ 300 ✓
    const flags = detectImbalances(rows([10, 300, 10], [100, 10, 10]), 300, 0);
    expect(flags.askImb).toEqual([false, true, false]);
  });

  it("ne détecte PAS en dessous du seuil (290 vs 300)", () => {
    // 290 < 3×100 = 300 → pas d'imbalance
    const flags = detectImbalances(rows([10, 290, 10], [100, 10, 10]), 300, 0);
    expect(flags.askImb).toEqual([false, false, false]);
  });

  it("filtre par minVol", () => {
    // buyVol[i]=50, ratio=300, minVol=100 → filtré
    const flags = detectImbalances(rows([10, 50, 10], [100, 10, 10]), 300, 100);
    expect(flags.askImb).toEqual([false, false, false]);
  });

  it("diviseur 0 : imbalance ssi buyVol≥minVol ET buyVol>0", () => {
    // sell=[100,0,10] → sellVol[i-1]=0 au niveau i=2 : buy=10>0 → imbalance.
    // Au niveau i=1 : sellVol[0]=100, buy=5 < 300 → pas d'imbalance.
    const flags = detectImbalances(rows([10, 5, 10], [100, 0, 10]), 300, 0);
    expect(flags.askImb).toEqual([false, false, true]);
  });

  it("bord de tableau : i=0 pas d'ask imb (pas de i-1)", () => {
    const flags = detectImbalances(rows([300, 10], [100, 10]), 300, 0);
    expect(flags.askImb).toEqual([false, false]);
  });

  it("bord de tableau : dernier niveau pas de bid imb (pas de i+1)", () => {
    const flags = detectImbalances(rows([10, 10, 300], [10, 100, 10]), 300, 0);
    expect(flags.bidImb).toEqual([false, false, false]);
  });

  it("bid imbalance symétrique", () => {
    // sellVol[i] ≥ 3×buyVol[i+1] → i=0 : 300 ≥ 3×10 ✓
    const flags = detectImbalances(rows([10, 10, 10], [300, 10, 10]), 300, 0);
    expect(flags.bidImb).toEqual([true, false, false]);
  });

  it("stacked : 3 consécutives du même côté marquées", () => {
    // ask : i=1,2,3 consécutifs → stacked=true pour chacun
    const flags = detectImbalances(
      rows([10, 300, 300, 300, 10], [100, 10, 10, 10, 10]),
      300, 0
    );
    expect(flags.askImb).toEqual([false, true, true, true, false]);
    expect(flags.stackedAsk).toEqual([false, true, true, true, false]);
  });

  it("stacked : 2 imbalances consécutives NE sont PAS marquées", () => {
    const flags = detectImbalances(
      rows([10, 300, 300, 10], [100, 10, 10, 10]),
      300, 0
    );
    expect(flags.askImb).toEqual([false, true, true, false]);
    expect(flags.stackedAsk).toEqual([false, false, false, false]);
  });

  it("stacked mixte : side opposé coupe la suite", () => {
    // ask, bid, ask → aucune stack
    const flags = detectImbalances(
      rows([10, 300, 10, 300], [100, 10, 300, 10]),
      300, 0
    );
    expect(flags.stackedAsk).toEqual([false, false, false, false]);
  });

  it("série vide → flags vides", () => {
    const flags = detectImbalances([], 300, 0);
    expect(flags.askImb).toEqual([]);
    expect(flags.bidImb).toEqual([]);
    expect(flags.stackedAsk).toEqual([]);
    expect(flags.stackedBid).toEqual([]);
  });
});

// ───────────────────────────── Divergences ─────────────────────────────

describe("detectDeltaDivergences", () => {
  it("première bougie → null", () => {
    const bars = [
      { time: 1000, rows: [], poc: 0, vah: 0, val: 0, delta: 10 } as FootprintBar,
    ];
    const flags = detectDeltaDivergences([ck(1000, 100, 90, 10)], bars);
    expect(flags).toEqual([null]);
  });

  it("bullish divergence : low↓ ET delta>0", () => {
    // bougie 0 : low=90, delta=5 ; bougie 1 : low=85, delta=10
    const bars = [
      { time: 1000, rows: [], poc: 0, vah: 0, val: 0, delta: 5 } as FootprintBar,
      { time: 2000, rows: [], poc: 0, vah: 0, val: 0, delta: 10 } as FootprintBar,
    ];
    const candles = [
      ck(1000, 100, 90, 5),
      ck(2000, 95, 85, 10),
    ];
    const flags = detectDeltaDivergences(candles, bars);
    expect(flags).toEqual([null, "bull"]);
  });

  it("bearish divergence : high↑ ET delta<0", () => {
    // bougie 0 : high=100, delta=-5 ; bougie 1 : high=110, delta=-10
    const bars = [
      { time: 1000, rows: [], poc: 0, vah: 0, val: 0, delta: -5 } as FootprintBar,
      { time: 2000, rows: [], poc: 0, vah: 0, val: 0, delta: -10 } as FootprintBar,
    ];
    const candles = [
      ck(1000, 100, 90, -5),
      ck(2000, 110, 95, -10),
    ];
    const flags = detectDeltaDivergences(candles, bars);
    expect(flags).toEqual([null, "bear"]);
  });

  it("pas de divergence si direction cohérente (high↑, delta>0)", () => {
    const bars = [
      { time: 1000, rows: [], poc: 0, vah: 0, val: 0, delta: 5 } as FootprintBar,
      { time: 2000, rows: [], poc: 0, vah: 0, val: 0, delta: 10 } as FootprintBar,
    ];
    const candles = [
      ck(1000, 100, 90, 5),
      ck(2000, 110, 95, 10),
    ];
    const flags = detectDeltaDivergences(candles, bars);
    expect(flags).toEqual([null, null]);
  });

  it("sélectionne la première divergence sur un streak", () => {
    // HH+delta<0 à chaque étape : seule la 1ère est retenue
    const bars = [
      { time: 1000, rows: [], poc: 0, vah: 0, val: 0, delta: -1 } as FootprintBar,
      { time: 2000, rows: [], poc: 0, vah: 0, val: 0, delta: -2 } as FootprintBar,
      { time: 3000, rows: [], poc: 0, vah: 0, val: 0, delta: -3 } as FootprintBar,
    ];
    const candles = [
      ck(1000, 100, 90, -1),
      ck(2000, 110, 95, -2),
      ck(3000, 120, 100, -3),
    ];
    const flags = detectDeltaDivergences(candles, bars);
    expect(flags).toEqual([null, "bear", null]); // 3e bougie : high continue ↑ mais delta déjà <0 depuis la 2e
  });

  it("array vide → array vide", () => {
    const flags = detectDeltaDivergences([], []);
    expect(flags).toEqual([]);
  });
});

// ───────────────────────────── ImbalanceFlags (export) ─────────────────────

describe("ImbalanceFlags", () => {
  it("retourne un objet avec les 4 champs attendus", () => {
    const flags: ImbalanceFlags = detectImbalances(rows([10, 10], [10, 10]), 300, 0);
    expect(flags).toHaveProperty("askImb");
    expect(flags).toHaveProperty("bidImb");
    expect(flags).toHaveProperty("stackedAsk");
    expect(flags).toHaveProperty("stackedBid");
  });
});
