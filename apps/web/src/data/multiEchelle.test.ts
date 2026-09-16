import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import {
  concordanceEchelles,
  ECHELLES_MTF,
  FENETRE_VARIATION,
  mesurerEchelle,
  type MesureEchelle,
} from "./multiEchelle";

/** Bougies synthétiques : clôtures selon `prix(i)`, high/low à ±1 %. */
function bougies(n: number, prix: (i: number) => number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const close = prix(i);
    return {
      time: i * 60_000,
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1,
    };
  });
}

describe("mesurerEchelle", () => {
  it("série trop courte : null (pas de valeur douteuse)", () => {
    expect(mesurerEchelle("1h", bougies(59, (i) => 100 + i))).toBeNull();
  });

  it("tendance haussière : close > EMA 50, variation sur la fenêtre exacte", () => {
    // Prix linéaire 100 → 100 + i : la variation sur 20 barres vaut 20/180 × 100.
    const n = 200;
    const mesure = mesurerEchelle("1h", bougies(n, (i) => 100 + i));
    expect(mesure).not.toBeNull();
    expect(mesure!.tendance).toBe("hausse");
    expect(mesure!.bougies).toBe(n);
    const ref = 100 + (n - 1 - FENETRE_VARIATION);
    const attendu = ((100 + n - 1 - ref) / ref) * 100;
    expect(mesure!.variationPct!).toBeCloseTo(attendu, 6);
    expect(mesure!.rsi!).toBeGreaterThan(50);
    expect(mesure!.atrPct!).toBeGreaterThan(0);
  });

  it("tendance baissière : close < EMA 50 et RSI sous 50", () => {
    const mesure = mesurerEchelle("1h", bougies(200, (i) => 300 - i));
    expect(mesure!.tendance).toBe("baisse");
    expect(mesure!.rsi!).toBeLessThan(50);
  });
});

describe("concordanceEchelles", () => {
  const mesure = (
    timeframe: MesureEchelle["timeframe"],
    tendance: MesureEchelle["tendance"],
  ): MesureEchelle => ({
    timeframe,
    tendance,
    rsi: 50,
    atrPct: 1,
    variationPct: 0,
    bougies: 200,
  });

  it("référence = la plus large mesurable, alignement sur sa tendance", () => {
    const c = concordanceEchelles([
      mesure("15m", "baisse"),
      mesure("1h", "hausse"),
      mesure("4h", "hausse"),
      mesure("1d", "hausse"),
    ]);
    expect(c.reference).toBe("1d");
    expect(c.direction).toBe("hausse");
    expect(c.alignees).toBe(3);
    expect(c.total).toBe(4);
  });

  it("ignore les échelles sans tendance (elles ne comptent pas dans le total)", () => {
    const c = concordanceEchelles([mesure("15m", "hausse"), mesure("1h", null), mesure("4h", "hausse")]);
    expect(c.total).toBe(2);
    expect(c.alignees).toBe(2);
    expect(c.reference).toBe("4h");
  });

  it("aucune échelle définie : résultat vide, pas de division par zéro", () => {
    const c = concordanceEchelles([mesure("15m", null)]);
    expect(c).toEqual({ reference: null, direction: null, alignees: 0, total: 0 });
  });

  it("les quatre échelles par défaut sont lues de la plus fine à la plus large", () => {
    expect([...ECHELLES_MTF]).toEqual(["15m", "1h", "4h", "1d"]);
  });
});
