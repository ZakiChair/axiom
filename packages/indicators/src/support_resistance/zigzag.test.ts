/**
 * @axiom/indicators — support_resistance/zigzag.test.ts
 *
 * ZigZag est PATH-DEPENDENT : on teste des PROPRIÉTÉS, pas de fausse précision.
 *
 * Série de prix (high=low=close, pour des extrêmes non ambigus), reversal=10 % :
 *   p = [100, 110, 105, 130, 120, 100, 140]
 *
 * Déroulé déterministe attendu (extrêmes alternés, valeur = prix de l'extrême) :
 *   - pivot BAS  à l'index 0 (100)  — point de départ confirmé au 1er retournement
 *   - pivot HAUT à l'index 3 (130)
 *   - pivot BAS  à l'index 5 (100)
 *   - pivot HAUT à l'index 6 (140)  — dernière jambe provisoire
 *   indices 1, 2, 4 -> undefined.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { zigzag } from "./zigzag";

function flatCandles(prices: number[]): Candle[] {
  return prices.map((p, i) => ({
    time: i * 60_000,
    open: p,
    high: p,
    low: p,
    close: p,
    volume: 0,
  }));
}

describe("ZigZag", () => {
  it("relie des pivots alternés filtrés par seuil de retournement", () => {
    const prices = [100, 110, 105, 130, 120, 100, 140];
    const cs = flatCandles(prices);
    const { series } = computeIndicator(zigzag, cs, { reversal: 10 });
    const out = series.zigzag;
    if (out === undefined) throw new Error("série zigzag absente");

    // (a) longueur alignée.
    expect(out.length).toBe(cs.length);

    // Indices NON pivot -> undefined.
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeUndefined();
    expect(out[4]).toBeUndefined();

    // Pivots définis = prix de l'extrême à la bougie correspondante.
    expect(out[0]).toBe(100);
    expect(out[3]).toBe(130);
    expect(out[5]).toBe(100);
    expect(out[6]).toBe(140);

    // Propriété : chaque valeur de pivot coïncide avec un extrême réel de la bougie.
    for (let i = 0; i < out.length; i++) {
      const v = out[i];
      if (v === undefined) continue;
      const c = cs[i]!;
      expect(v >= c.low && v <= c.high).toBe(true);
    }

    // Propriété d'ALTERNANCE : les pivots successifs montent puis descendent, etc.
    const pivots: number[] = [];
    for (const v of out) if (v !== undefined) pivots.push(v);
    expect(pivots.length).toBeGreaterThanOrEqual(3);
    for (let k = 2; k < pivots.length; k++) {
      const a = pivots[k - 2]!;
      const b = pivots[k - 1]!;
      const c = pivots[k]!;
      // Un sommet est entouré de deux creux et inversement (changement de signe).
      const up1 = b > a;
      const up2 = c > b;
      expect(up1).not.toBe(up2);
    }
  });

  it("ne marque aucun pivot interne si aucun mouvement n'atteint le seuil", () => {
    // Hausse monotone faible (< 10 % entre extrêmes successifs cumulés ne suffit
    // pas à créer un retournement) : pas de pivot de retournement, seule la
    // dernière jambe provisoire est marquée.
    const cs = flatCandles([100, 101, 102, 103]);
    const { series } = computeIndicator(zigzag, cs, { reversal: 10 });
    const out = series.zigzag;
    if (out === undefined) throw new Error("série zigzag absente");

    expect(out.length).toBe(cs.length);
    const defined = out.filter((v) => v !== undefined);
    // Aucun retournement -> au plus le dernier extrême provisoire est marqué.
    expect(defined.length).toBeLessThanOrEqual(1);
  });
});
