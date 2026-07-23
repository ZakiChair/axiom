/**
 * @axiom/indicators — statistical/betaRef.test.ts
 *
 * Bêta roulant des RENDEMENTS LOG du symbole courant vs ceux du symbole de référence
 * (ctx.aux.refClose). Sensibilité du marché courant aux mouvements de la référence :
 *
 *   r[i]    = ln(close[i] / close[i-1])      (défini si les deux bornes finies et > 0)
 *   rRef[i] = ln(ref[i]   / ref[i-1])        (idem)
 *   beta[i] = cov(r, rRef) / var(rRef)  sur la fenêtre { j ∈ [i-length+1 .. i] }
 *
 * Comme la corrélation (T3), un « rendement » est une PAIRE (r[j], rRef[j]) qui n'existe
 * que si ses deux jambes sont définies ; la fenêtre est POSITIONNELLE (les `length`
 * derniers slots de rendement) et un slot manquant ⇒ beta undefined pour ce point.
 * Dénominateur = variance de la jambe de RÉFÉRENCE : var(rRef)=0 ⇒ beta undefined.
 *
 * `length` clampé à [10, 500] (min 10) : fixtures à length = 10 (11 bougies → un point
 * plein à l'index 10). Prix dérivés des rendements par produit cumulé (comme T3).
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { betaRef } from "./betaRef";

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

/** Série de prix dérivée de rendements log : prix[0] = base, prix[i] = prix[i-1]·exp(r[i]). */
function pricesFromReturns(base: number, returns: number[]): number[] {
  const out = [base];
  for (const r of returns) out.push(out[out.length - 1]! * Math.exp(r));
  return out;
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

describe("betaRef", () => {
  // 10 rendements de référence variés (var ≠ 0) → 11 closes ; fenêtre pleine à l'index 10.
  const rRef = [0.02, -0.01, 0.03, -0.02, 0.01, -0.03, 0.02, -0.01, 0.03, -0.02];

  it("beta = 2 exactement quand r = 2·rRef (fixture exacte)", () => {
    // cov(2·rRef, rRef) = 2·var(rRef) ⇒ beta = 2, indépendamment de la fenêtre.
    const refClose = pricesFromReturns(100, rRef);
    const closes = pricesFromReturns(100, rRef.map((r) => 2 * r));
    const { series } = betaRef.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, refClose)
    );
    expect(series.beta?.[10]).toBeCloseTo(2, 12); // fenêtre pleine unique (slots 1..10)
    expect(series.beta?.[9]).toBeUndefined(); // fenêtre incomplète (slot 0 sans rendement)
  });

  it("beta = 1 quand r = rRef (référence identique)", () => {
    const refClose = pricesFromReturns(100, rRef);
    const closes = pricesFromReturns(100, rRef);
    const { series } = betaRef.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, refClose)
    );
    expect(series.beta?.[10]).toBeCloseTo(1, 12);
  });

  it("beta = -0.5 quand r = -0.5·rRef", () => {
    const refClose = pricesFromReturns(100, rRef);
    const closes = pricesFromReturns(100, rRef.map((r) => -0.5 * r));
    const { series } = betaRef.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, refClose)
    );
    expect(series.beta?.[10]).toBeCloseTo(-0.5, 12);
  });

  it("var(rRef) = 0 (référence plate) ⇒ beta undefined même fenêtre pleine", () => {
    // ref constant ⇒ rRef = 0 partout ⇒ variance de la jambe ref nulle ⇒ 0/0 évité.
    const refClose = new Array(11).fill(100);
    const closes = pricesFromReturns(100, rRef);
    const { series } = betaRef.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, refClose)
    );
    expect(series.beta?.[10]).toBeUndefined();
  });

  it("refClose absent ⇒ beta entièrement undefined (mais repère toujours tracé)", () => {
    const closes = pricesFromReturns(100, rRef);
    const { series } = betaRef.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes)
    );
    expect(series.beta).toEqual(new Array(closes.length).fill(undefined));
    for (const v of series.one ?? []) expect(v).toBe(1); // ligne de niveau β = 1
  });

  it("premier point sans rendement ⇒ beta[0] undefined", () => {
    const refClose = pricesFromReturns(100, rRef);
    const closes = pricesFromReturns(100, rRef);
    const { series } = betaRef.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, refClose)
    );
    expect(series.beta?.[0]).toBeUndefined();
  });

  it("trou de refClose invalide le rendement du trou ET du suivant (fenêtre positionnelle)", () => {
    // 25 bougies, length = 10 → fenêtres finissant aux indices 10..24 (slots [i-9..i]).
    const rxLong = Array.from({ length: 24 }, (_, k) => 0.01 * ((k % 3) - 1) + 0.001);
    const ryLong = Array.from({ length: 24 }, (_, k) => 0.01 * ((k % 4) - 1.5));
    const cLong = pricesFromReturns(100, rxLong);
    const refFull = pricesFromReturns(100, ryLong);

    const base = betaRef.calc(
      candlesFromCloses(cLong),
      { length: 10 },
      makeCtx(cLong, refFull)
    ).series;
    expect(base.beta?.[11]).toBeDefined();
    expect(base.beta?.[15]).toBeDefined();
    expect(base.beta?.[23]).toBeDefined();

    // Trou à ref[12] : invalide rRef[12] (borne haute) ET rRef[13] (borne basse = ref[12]).
    const refHole: Array<number | undefined> = [...refFull];
    refHole[12] = undefined;
    const holed = betaRef.calc(
      candlesFromCloses(cLong),
      { length: 10 },
      makeCtx(cLong, refHole)
    ).series;

    expect(holed.beta?.[11]).toBeDefined(); // fenêtre [2..11] intacte
    expect(holed.beta?.[15]).toBeUndefined(); // fenêtre [6..15] couvre 12 et 13
    expect(holed.beta?.[22]).toBeUndefined(); // fenêtre [13..22] couvre encore 13
    expect(holed.beta?.[23]).toBeDefined(); // fenêtre [14..23] dégagée
  });

  it("métadonnées conformes", () => {
    expect(betaRef.id).toBe("betaRef");
    expect(betaRef.category).toBe("statistical");
    expect(betaRef.pane).toBe("separate");
    expect(betaRef.aux).toEqual(["refClose"]);
    expect(betaRef.precision).toBe(2);
    expect(betaRef.inputs).toEqual([
      { key: "length", name: expect.any(String), type: "number", default: 50, min: 10, max: 500 },
      {
        key: "source",
        name: expect.any(String),
        type: "source",
        default: "close",
        options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
      },
    ]);
    expect(betaRef.outputs.map((o) => o.key)).toEqual(["beta", "one"]);
  });
});
