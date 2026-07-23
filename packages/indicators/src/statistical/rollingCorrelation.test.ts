/**
 * @axiom/indicators — statistical/rollingCorrelation.test.ts
 *
 * Corrélation roulante de Pearson des RENDEMENTS LOG du symbole courant vs ceux du
 * symbole de référence (ctx.aux.refClose).
 *
 *   r[i]    = ln(close[i] / close[i-1])      (défini si les deux bornes finies et > 0)
 *   rRef[i] = ln(ref[i]   / ref[i-1])        (idem)
 *   corr[i] = Pearson({ (r[j], rRef[j]) : j ∈ [i-length+1 .. i] })
 *
 * Un « rendement » est ici une PAIRE (r[j], rRef[j]) : il n'existe que si les DEUX
 * jambes sont définies. La fenêtre est POSITIONNELLE (les `length` derniers slots de
 * rendement) — un slot manquant dans la fenêtre ⇒ corr undefined pour ce point (pas
 * de fenêtre à trous, pas de backfill d'un rendement plus ancien).
 *
 * `length` est clampé à [10, 500] (min 10) : toutes les fixtures utilisent donc
 * length = 10 (fenêtre de 10 rendements → 11 bougies pour un unique point plein).
 * Fixtures construites en choisissant les RENDEMENTS puis en dérivant les prix par
 * produit cumulé (close[i] = close[i-1] · exp(r[i])) — corrélation vérifiable à la main.
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { rollingCorrelation } from "./rollingCorrelation";

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

describe("rollingCorrelation", () => {
  // 10 rendements variés (stdev ≠ 0) → 11 closes ; unique fenêtre pleine à l'index 10.
  const rx = [0.02, -0.02, 0.02, -0.02, 0.02, -0.02, 0.02, -0.02, 0.02, -0.02];
  const closes = pricesFromReturns(100, rx);

  it("corr = +1 sur des rendements identiques (ref = k·close)", () => {
    // ref = 2·close ⇒ rRef[i] = ln(2·close[i] / 2·close[i-1]) = r[i] (bit-identique).
    const ref = closes.map((c) => 2 * c);
    const { series } = rollingCorrelation.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, ref)
    );
    expect(series.corr?.[10]).toBeCloseTo(1, 12); // fenêtre pleine unique (slots 1..10)
    expect(series.corr?.[9]).toBeUndefined(); // fenêtre incomplète (slot 0 sans rendement)
  });

  it("corr = -1 sur des rendements opposés (rRef = -r)", () => {
    // ref[i] = ref[i-1]·(close[i-1]/close[i]) ⇒ rRef[i] = -r[i].
    const ref: number[] = [100];
    for (let i = 1; i < closes.length; i++) {
      ref.push(ref[i - 1]! * (closes[i - 1]! / closes[i]!));
    }
    const { series } = rollingCorrelation.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, ref)
    );
    expect(series.corr?.[10]).toBeCloseTo(-1, 12);
  });

  it("corr ≈ 0 sur des rendements orthogonaux (covariance nulle)", () => {
    // rx alterné (moyenne 0) ; ry = 6 hausses puis 4 baisses.
    //   Σ rx·ry = 0 (produits ±.0004 qui s'annulent) et Σ rx = 0 ⇒ Pearson = 0.
    const ry = [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, -0.02, -0.02, -0.02, -0.02];
    const c = pricesFromReturns(100, rx);
    const ref = pricesFromReturns(100, ry);
    const { series } = rollingCorrelation.calc(
      candlesFromCloses(c),
      { length: 10 },
      makeCtx(c, ref)
    );
    expect(series.corr?.[10]).toBeCloseTo(0, 12);
  });

  it("refClose absent ⇒ corr entièrement undefined (mais repères toujours tracés)", () => {
    const { series } = rollingCorrelation.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes)
    );
    expect(series.corr).toEqual(new Array(closes.length).fill(undefined));
    // Les repères constants restent des lignes de niveau (cf. priceZScore hi/lo).
    for (const v of series.hi ?? []) expect(v).toBe(1);
    for (const v of series.mid ?? []) expect(v).toBe(0);
    for (const v of series.lo ?? []) expect(v).toBe(-1);
  });

  it("stdev nulle d'un côté (référence plate) ⇒ corr undefined même fenêtre pleine", () => {
    // ref constant ⇒ rRef = 0 partout ⇒ variance de la jambe ref nulle ⇒ 0/0 évité.
    const ref = new Array(closes.length).fill(100);
    const { series } = rollingCorrelation.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, ref)
    );
    expect(series.corr?.[10]).toBeUndefined();
  });

  it("premier point sans rendement ⇒ corr[0] undefined", () => {
    const ref = closes.map((c) => 2 * c);
    const { series } = rollingCorrelation.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, ref)
    );
    expect(series.corr?.[0]).toBeUndefined();
  });

  it("trou de refClose invalide le rendement du trou ET du suivant (fenêtre positionnelle, pas de backfill)", () => {
    // 25 bougies, length = 10 → fenêtres finissant aux indices 10..24 (slots [i-9..i]).
    const rxLong = Array.from({ length: 24 }, (_, k) => 0.01 * ((k % 3) - 1));
    const ryLong = Array.from({ length: 24 }, (_, k) => 0.01 * ((k % 4) - 1.5));
    const cLong = pricesFromReturns(100, rxLong);
    const refFull = pricesFromReturns(100, ryLong);

    // Baseline sans trou : les points en régime établi sont définis.
    const base = rollingCorrelation.calc(
      candlesFromCloses(cLong),
      { length: 10 },
      makeCtx(cLong, refFull)
    ).series;
    expect(base.corr?.[11]).toBeDefined();
    expect(base.corr?.[15]).toBeDefined();
    expect(base.corr?.[23]).toBeDefined();

    // Trou à ref[12] : invalide rRef[12] (borne haute) ET rRef[13] (borne basse = ref[12]).
    const refHole: Array<number | undefined> = [...refFull];
    refHole[12] = undefined;
    const holed = rollingCorrelation.calc(
      candlesFromCloses(cLong),
      { length: 10 },
      makeCtx(cLong, refHole)
    ).series;

    // Avant le trou : fenêtre [2..11], intacte → défini.
    expect(holed.corr?.[11]).toBeDefined();
    // Toute fenêtre couvrant le slot 12 ou 13 → undefined (pas de rendement fantôme).
    expect(holed.corr?.[15]).toBeUndefined(); // fenêtre [6..15] couvre 12 et 13
    expect(holed.corr?.[22]).toBeUndefined(); // fenêtre [13..22] couvre encore 13
    // Fenêtre dégagée des slots 12 et 13 → RECOUVREMENT (défini, pas de backfill).
    expect(holed.corr?.[23]).toBeDefined(); // fenêtre [14..23]
  });

  it("borne toute corr définie dans [-1, 1]", () => {
    const ref = closes.map((c) => 2 * c);
    const { series } = rollingCorrelation.calc(
      candlesFromCloses(closes),
      { length: 10 },
      makeCtx(closes, ref)
    );
    for (const v of series.corr ?? []) {
      if (v !== undefined) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("métadonnées conformes", () => {
    expect(rollingCorrelation.id).toBe("rollingCorrelation");
    expect(rollingCorrelation.category).toBe("statistical");
    expect(rollingCorrelation.pane).toBe("separate");
    expect(rollingCorrelation.aux).toEqual(["refClose"]);
    expect(rollingCorrelation.precision).toBe(2);
    expect(rollingCorrelation.inputs).toEqual([
      { key: "length", name: expect.any(String), type: "number", default: 50, min: 10, max: 500 },
      {
        key: "source",
        name: expect.any(String),
        type: "source",
        default: "close",
        options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
      },
    ]);
    expect(rollingCorrelation.outputs.map((o) => o.key)).toEqual(["corr", "hi", "mid", "lo"]);
  });
});
