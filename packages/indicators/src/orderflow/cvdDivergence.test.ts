/**
 * cvdDivergence v2 — tests de CONTRAT + CÂBLAGE (même patron que
 * rsiDivergence.test.ts). La géométrie des annotations est dérivée à la main
 * dans utils-annotations.test.ts et le CVD dans cvd.test.ts : ici on vérifie
 * que le def assemble bien ces briques hand-testées (comparaison aux fonctions
 * pures composées), plus la dégradation propre (source sans taker → CVD plat).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { construireAnnotationsDivergence } from "../utils-annotations";
import { highOf, lowOf } from "../utils";
import { cvdOf } from "./cvd";
import { cvdDivergence } from "./cvdDivergence";

const FORMATEUR = (v: number) => v.toFixed(0);

/** Série linéaire par morceaux : coins aux points de contrôle, monotone entre eux. */
function rampe(n: number, points: ReadonlyArray<readonly [number, number]>): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let seg = 0;
    while (seg < points.length - 1 && points[seg + 1]![0] <= i) seg++;
    const a = points[seg]!;
    const b = points[seg + 1] ?? a;
    const t = b[0] === a[0] ? 0 : (i - a[0]) / (b[0] - a[0]);
    out.push(a[1] + t * (b[1] - a[1]));
  }
  return out;
}

/**
 * Bougies dont le CVD reconstruit exactement `cvdCible` : delta[i] = cvdCible[i] −
 * cvdCible[i−1] (delta[0] = cvdCible[0]), réalisé par buy/sell. high/low = close ± 1.
 * Prix et CVD portent chacun de vrais pivots fractals (pas une rampe monotone), condition
 * nécessaire pour qu'une divergence soit détectée par le moteur commun.
 */
function candlesFromCvd(closes: number[], cvdCible: number[]): Candle[] {
  return closes.map((close, i) => {
    const delta = i === 0 ? cvdCible[0]! : cvdCible[i]! - cvdCible[i - 1]!;
    return {
      time: 1_700_000_000_000 + i * 60_000,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100,
      buyVolume: delta > 0 ? delta : 0,
      sellVolume: delta < 0 ? -delta : 0,
    };
  });
}

describe("cvdDivergence v2", () => {
  it("contrat : pane séparé, sortie unique cvd, inputs communs (pas d'input propre)", () => {
    expect(cvdDivergence.pane).toBe("separate");
    expect(cvdDivergence.outputs).toEqual([{ key: "cvd", name: "CVD", style: "line" }]);
    expect(cvdDivergence.inputs.map((i) => i.key)).toEqual([
      "gauche", "droite", "maxEcart", "cachees",
    ]);
  });

  it("câblage : série = cvdOf(candles), annotations = moteur commun sur le CVD", () => {
    // Prix : creux idx12 (close 48) puis idx30 (close 52) → HL (higher low).
    // CVD : creux idx12 (30) puis idx30 (24) → LL (lower low) → divergence haussière cachée.
    const N = 42;
    const closes = rampe(N, [[0, 60], [12, 48], [21, 58], [30, 52], [39, 60]]);
    const cvdCible = rampe(N, [[0, 40], [12, 30], [21, 42], [30, 24], [39, 40]]);
    const candles = candlesFromCvd(closes, cvdCible);
    const params = { gauche: 2, droite: 2 };
    const r = computeIndicator(cvdDivergence, candles, params);
    const cvdAttendu = cvdOf(candles);
    expect(r.series["cvd"]).toEqual(cvdAttendu);
    // `?? {}` : la fabrique omet la clé `annotations` quand le moteur renvoie {}
    // — l'égalité doit tenir dans les deux cas (divergence présente ou non).
    const attendu = construireAnnotationsDivergence(highOf(candles), lowOf(candles), cvdAttendu, {
      gauche: 2, droite: 2, maxEcart: 60, cachees: true, nomOsc: "CVD", formateur: FORMATEUR,
    });
    expect(r.annotations ?? {}).toEqual(attendu);
    // Garde-fou anti-tautologie : la fixture produit RÉELLEMENT une divergence
    // (sinon `attendu` serait {} et l'égalité ci-dessus passerait sans rien vérifier).
    expect(attendu.segments?.length ?? 0).toBeGreaterThan(0);
  });

  it("dégradation : bougies sans champs taker → CVD plat à 0, aucune annotation", () => {
    const N = 42;
    const closes = rampe(N, [[0, 60], [12, 48], [21, 58], [30, 52], [39, 60]]); // pivots de PRIX bien présents
    const candles: Candle[] = closes.map((close, i) => ({
      time: 1_700_000_000_000 + i * 60_000,
      open: close, high: close + 1, low: close - 1, close, volume: 100,
    }));
    const cvdAttendu = cvdOf(candles);
    expect(cvdAttendu.every((v) => v === 0)).toBe(true); // comportement réel de cvdOf : plat à 0

    const r = computeIndicator(cvdDivergence, candles, { gauche: 2, droite: 2 });
    expect(r.series["cvd"]).toEqual(cvdAttendu);
    expect(r.series["cvd"]?.every((v) => v === 0)).toBe(true);
    expect(r.annotations).toBeUndefined();
  });
});
