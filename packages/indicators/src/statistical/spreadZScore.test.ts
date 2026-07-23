/**
 * @axiom/indicators — statistical/spreadZScore.test.ts
 *
 * Z-score roulant du SPREAD LOG (niveaux) entre le symbole courant et le symbole de
 * référence (ctx.aux.refClose) :
 *
 *   s[i] = ln(close[i]) − ln(ref[i])            (NIVEAUX, pas des rendements)
 *   z[i] = (s[i] − moyenne(fenêtre)) / stdev POPULATION(fenêtre)
 *
 * Contrairement à la corrélation/bêta (rendements ⇒ dépendance à la bougie précédente),
 * un point de spread existe DÈS QUE close[i] et ref[i] sont finis et > 0 — aucune
 * dépendance au point précédent. Un trou de refClose invalide donc UNIQUEMENT son propre
 * slot (pas le suivant). Fenêtre POSITIONNELLE de `length` slots : incomplète (moins de
 * `length`) ou avec un slot manquant ⇒ z undefined ; stdev 0 (spread plat) ⇒ z undefined.
 *
 * `length` clampé à [10, 500] : fixtures à length = 10. Prix construits directement à
 * partir des spreads voulus (ref constant, close[i] = ref·exp(s[i]) ⇒ spread = s[i]).
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { spreadZScore } from "./spreadZScore";

/** Bougies plates dérivées d'une série de closes (seul `close` porte l'info). */
function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));
}

/** Contexte de calcul : `source` = closes, `refClose` = série de référence alignée. */
function makeCtx(
  closes: number[],
  refClose?: Array<number | undefined>
): CalcContext {
  return {
    hl2: [],
    hlc3: [],
    ohlc4: [],
    source: closes,
    aux: refClose ? { refClose } : undefined,
  };
}

describe("spreadZScore", () => {
  it("z exact sur une fenêtre connue (5 bas puis 5 haut ⇒ z[9] = +1)", () => {
    // ref constant ⇒ spread s[i] = ln(close[i]/100). On impose s directement.
    const d = 0.01;
    const spreads = [-d, -d, -d, -d, -d, d, d, d, d, d]; // moyenne 0, stdev pop = d
    const ref = new Array(10).fill(100);
    const closes = spreads.map((s) => 100 * Math.exp(s));
    const { series } = spreadZScore.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, ref)
    );
    expect(series.z?.[9]).toBeCloseTo(1, 12); // (d − 0) / d
    expect(series.z?.[8]).toBeUndefined(); // fenêtre incomplète (9 slots < 10)
  });

  it("z = 0 quand le dernier spread égale la moyenne de la fenêtre", () => {
    const d = 0.01;
    // 4 bas + 4 haut (somme nulle) puis deux 0 : moyenne 0, dernier point 0.
    const spreads = [-d, -d, -d, -d, d, d, d, d, 0, 0];
    const ref = new Array(10).fill(100);
    const closes = spreads.map((s) => 100 * Math.exp(s));
    const { series } = spreadZScore.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, ref)
    );
    // moyenne = (−4d + 4d + 0 + 0)/10 = 0 ; s[9] = 0 ⇒ z = 0.
    expect(series.z?.[9]).toBeCloseTo(0, 12);
  });

  it("spread plat (stdev 0) ⇒ z undefined même fenêtre pleine", () => {
    // close = ref·k ⇒ spread = ln(k) constant ⇒ stdev nulle ⇒ 0/0 évité.
    const ref = new Array(10).fill(100);
    const closes = new Array(10).fill(250); // spread = ln(2.5) constant
    const { series } = spreadZScore.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, ref)
    );
    expect(series.z?.[9]).toBeUndefined();
  });

  it("z borné et fini sur une fixture oscillante longue", () => {
    const ref = new Array(40).fill(100);
    const closes = Array.from({ length: 40 }, (_, i) => 100 * Math.exp(0.02 * Math.sin(i)));
    const { series } = spreadZScore.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, ref)
    );
    let defined = 0;
    for (const v of series.z ?? []) {
      if (v !== undefined) {
        expect(Number.isFinite(v)).toBe(true);
        defined++;
      }
    }
    expect(defined).toBeGreaterThan(0); // au moins les fenêtres pleines produisent un z
  });

  it("refClose absent ⇒ z entièrement undefined (mais bandes toujours tracées)", () => {
    const closes = new Array(10).fill(100);
    const { series } = spreadZScore.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes)
    );
    expect(series.z).toEqual(new Array(closes.length).fill(undefined));
    for (const v of series.hi ?? []) expect(v).toBe(2);
    for (const v of series.lo ?? []) expect(v).toBe(-2);
  });

  it("trou de refClose invalide UNIQUEMENT son slot (niveaux, pas le suivant)", () => {
    // 25 bougies, length 10 → fenêtres finissant aux indices 9..24.
    const ref: Array<number | undefined> = new Array(25).fill(100);
    const closes = Array.from({ length: 25 }, (_, i) => 100 * Math.exp(0.02 * Math.sin(i)));

    const base = spreadZScore.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, [...ref])
    ).series;
    expect(base.z?.[11]).toBeDefined();
    expect(base.z?.[22]).toBeDefined();

    // Trou à ref[12] : seul le slot 12 est invalidé (le spread est un niveau).
    const refHole: Array<number | undefined> = [...ref];
    refHole[12] = undefined;
    const holed = spreadZScore.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, refHole)
    ).series;

    expect(holed.z?.[11]).toBeDefined(); // fenêtre [2..11] ne couvre pas 12
    expect(holed.z?.[12]).toBeUndefined(); // fenêtre [3..12] couvre le trou
    expect(holed.z?.[21]).toBeUndefined(); // fenêtre [12..21] couvre encore le trou
    expect(holed.z?.[22]).toBeDefined(); // fenêtre [13..22] dégagée — RECOUVREMENT immédiat
  });

  it("close ≤ 0 dans la fenêtre ⇒ spread manquant ⇒ z undefined", () => {
    const ref = new Array(10).fill(100);
    const closes = new Array(10).fill(100);
    closes[5] = 0; // ln(0) indéfini ⇒ slot 5 sans spread
    const { series } = spreadZScore.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, ref)
    );
    expect(series.z?.[9]).toBeUndefined();
  });

  it("métadonnées conformes (input `length` seul, spread épinglé sur close)", () => {
    expect(spreadZScore.id).toBe("spreadZScore");
    expect(spreadZScore.category).toBe("statistical");
    expect(spreadZScore.pane).toBe("separate");
    expect(spreadZScore.aux).toEqual(["refClose"]);
    expect(spreadZScore.precision).toBe(2);
    expect(spreadZScore.inputs).toEqual([
      { key: "length", name: expect.any(String), type: "number", default: 100, min: 10, max: 500 },
    ]);
    expect(spreadZScore.outputs.map((o) => o.key)).toEqual(["z", "hi", "lo"]);
  });
});
