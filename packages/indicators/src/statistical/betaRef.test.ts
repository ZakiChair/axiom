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
      { key: "afficherAlpha", name: expect.any(String), type: "boolean", default: false },
    ]);
    expect(betaRef.outputs.map((o) => o.key)).toEqual(["beta", "one", "alpha"]);
  });
});

/**
 * Alpha résiduel cumulé (SUG-6 volet 1) : résidu[j] = r[j] − beta[j-1]·rRef[j], cumulé.
 * β EX ANTE (slot précédent) : premier résidu à j = length + 1 (beta défini dès i = length).
 */
describe("betaRef — alpha résiduel cumulé", () => {
  /** Rendements de référence variés (variance non nulle sur toute fenêtre de 10). */
  const ryLong = Array.from({ length: 29 }, (_, k) => 0.01 * ((k % 4) - 1.5) + 0.002 * (k % 3));

  it("actif = référence × c (r = rRef) : alpha nul partout où il est défini", () => {
    const refClose = pricesFromReturns(100, ryLong);
    const closes = refClose.map((p) => 3 * p); // X = 3·BTC : rendements identiques
    const { series } = betaRef.calc(
      candlesFromCloses(closes),
      { length: 10, afficherAlpha: true },
      makeCtx(closes, refClose)
    );
    expect(series.alpha?.[10]).toBeUndefined(); // beta[9] indéfini : pas de β ex ante
    for (let j = 11; j < closes.length; j++) expect(series.alpha?.[j]).toBeCloseTo(0, 12);
  });

  it("r = 2·rRef : β = 2, résidu nul, alpha nul (le levier n'est pas de l'alpha)", () => {
    const refClose = pricesFromReturns(100, ryLong);
    const closes = pricesFromReturns(100, ryLong.map((r) => 2 * r));
    const { series } = betaRef.calc(
      candlesFromCloses(closes),
      { length: 10, afficherAlpha: true },
      makeCtx(closes, refClose)
    );
    for (let j = 11; j < closes.length; j++) expect(series.alpha?.[j]).toBeCloseTo(0, 12);
  });

  it("r = rRef + a (dérive constante) : β = 1, alpha = a × nombre de résidus cumulés", () => {
    const a = 0.003;
    const refClose = pricesFromReturns(100, ryLong);
    const closes = pricesFromReturns(100, ryLong.map((r) => r + a));
    const { series } = betaRef.calc(
      candlesFromCloses(closes),
      { length: 10, afficherAlpha: true },
      makeCtx(closes, refClose)
    );
    expect(series.beta?.[10]).toBeCloseTo(1, 12);
    expect(series.alpha?.[11]).toBeCloseTo(a, 12);
    expect(series.alpha?.[12]).toBeCloseTo(2 * a, 12);
    expect(series.alpha?.[29]).toBeCloseTo(19 * a, 12);
  });

  it("causalité par préfixe : ajouter des bougies ne change aucun alpha passé", () => {
    const rx = Array.from({ length: 59 }, (_, k) => 0.02 * Math.sin(k * 1.3) + 0.004 * Math.cos(k * 0.7));
    const ry = Array.from({ length: 59 }, (_, k) => 0.015 * Math.sin(k * 0.9 + 1) + 0.003 * ((k % 5) - 2));
    const closes = pricesFromReturns(100, rx);
    const refClose = pricesFromReturns(50, ry);
    const complet = betaRef.calc(candlesFromCloses(closes), { length: 10, afficherAlpha: true }, makeCtx(closes, refClose)).series;
    const k = 37;
    const prefixe = betaRef.calc(
      candlesFromCloses(closes.slice(0, k)),
      { length: 10, afficherAlpha: true },
      makeCtx(closes.slice(0, k), refClose.slice(0, k))
    ).series;
    expect(prefixe.alpha?.some((v) => v !== undefined)).toBe(true);
    for (let j = 0; j < k; j++) expect(prefixe.alpha?.[j]).toBe(complet.alpha?.[j]);
  });

  it("trou de refClose : alpha indéfini sur le trou, puis segment NOUVEAU (pas de 0 inventé)", () => {
    const rx = Array.from({ length: 29 }, (_, k) => 0.01 * ((k % 3) - 1) + 0.001);
    const closes = pricesFromReturns(100, rx);
    const refFull = pricesFromReturns(100, ryLong);
    const refHole: Array<number | undefined> = [...refFull];
    refHole[12] = undefined; // invalide rRef[12] et rRef[13] ; beta indéfini sur [12..22]
    const { series } = betaRef.calc(
      candlesFromCloses(closes),
      { length: 10, afficherAlpha: true },
      makeCtx(closes, refHole)
    );
    expect(series.alpha?.[11]).toBeDefined(); // segment initial (résidu de 11)
    for (let j = 12; j <= 23; j++) expect(series.alpha?.[j]).toBeUndefined();
    // j = 24 : premier résidu du segment suivant = r[24] − beta[23]·rRef[24] SEUL.
    const r24 = Math.log(closes[24]! / closes[23]!);
    const y24 = Math.log(refFull[24]! / refFull[23]!);
    expect(series.alpha?.[24]).toBeCloseTo(r24 - series.beta![23]! * y24, 12);
  });

  it("refClose absent : alpha entièrement indéfini", () => {
    const closes = pricesFromReturns(100, ryLong);
    const { series } = betaRef.calc(candlesFromCloses(closes), { length: 10, afficherAlpha: true }, makeCtx(closes));
    expect(series.alpha).toEqual(new Array(closes.length).fill(undefined));
  });
});

describe("betaRef — affichage de l'alpha (revue du 2026-11-07)", () => {
  const ry = Array.from({ length: 29 }, (_, k) => 0.01 * ((k % 4) - 1.5) + 0.002 * (k % 3));
  const refClose = pricesFromReturns(100, ry);
  const closes = pricesFromReturns(100, ry.map((r) => r + 0.003));

  it("option coupée par défaut : alpha entièrement indéfini (l'échelle du pane reste celle du β)", () => {
    const { series } = betaRef.calc(candlesFromCloses(closes), { length: 10 }, makeCtx(closes, refClose));
    expect(series.alpha).toEqual(new Array(closes.length).fill(undefined));
    expect(series.beta?.[10]).toBeCloseTo(1, 12);
  });

  it("le β ne dépend pas de l'option", () => {
    const sans = betaRef.calc(candlesFromCloses(closes), { length: 10 }, makeCtx(closes, refClose)).series;
    const avec = betaRef.calc(
      candlesFromCloses(closes),
      { length: 10, afficherAlpha: true },
      makeCtx(closes, refClose)
    ).series;
    expect(avec.beta).toEqual(sans.beta);
    expect(avec.alpha?.[11]).toBeCloseTo(0.003, 12);
  });
});
