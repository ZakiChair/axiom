/**
 * rsiDivergence v2 — tests de CONTRAT + CÂBLAGE. La géométrie des annotations est
 * dérivée à la main dans utils-annotations.test.ts et le RSI dans rsi.test.ts :
 * ici on vérifie que le def assemble bien ces briques hand-testées (comparaison
 * aux fonctions pures composées), plus un garde-fou anti-tautologie : la fixture
 * (reprise de la v1, éprouvée) produit RÉELLEMENT une divergence haussière
 * régulière (prix 61 → 57 aux idx 24 → 48, RSI 11.16 → 23.68 en hausse) — sans
 * quoi `attendu` serait `{}` et l'égalité passerait sans rien vérifier.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { construireAnnotationsDivergence } from "../utils-annotations";
import { highOf, lowOf } from "../utils";
import { rsiOf } from "./rsi";
import { rsiDivergence } from "./rsiDivergence";

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

/** Bougies minimales : high = close + 1, low = close − 1 (pivots de prix alignés sur les closes). */
function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  }));
}

describe("rsiDivergence v2", () => {
  it("contrat : pane séparé, sortie unique rsi, inputs osc + communs", () => {
    expect(rsiDivergence.pane).toBe("separate");
    expect(rsiDivergence.outputs).toEqual([{ key: "rsi", name: "RSI", style: "line" }]);
    expect(rsiDivergence.inputs.map((i) => i.key)).toEqual([
      "length", "source", "gauche", "droite", "maxEcart", "cachees",
    ]);
    // `precision` est OPTIONNEL dans la fabrique (`if (spec.precision !== undefined)`) :
    // sans cette assertion, un oubli de report du champ passerait inaperçu.
    expect(rsiDivergence.precision).toBe(2);
  });

  it("câblage : série = rsiOf(source, length), annotations = moteur commun sur le RSI", () => {
    // Fixture v1 éprouvée : creux prix idx24 (close 62) puis idx48 (close 58) → LL ;
    // approche du 2ᵉ plus douce → RSI en plus-bas plus HAUT → divergence haussière
    // régulière détectée avec les défauts (length 14, gauche/droite 5, maxEcart 60).
    const closes = rampe(60, [[0, 100], [10, 108], [24, 62], [36, 88], [48, 58], [59, 74]]);
    const candles = candlesFromCloses(closes);
    const r = computeIndicator(rsiDivergence, candles, {});
    const rsiAttendu = rsiOf(closes, 14);
    expect(r.series["rsi"]).toEqual(rsiAttendu);
    // `?? {}` : la fabrique omet la clé `annotations` quand le moteur renvoie {}
    // — l'égalité doit tenir dans les deux cas (divergence présente ou non).
    const attendu = construireAnnotationsDivergence(highOf(candles), lowOf(candles), rsiAttendu, {
      gauche: 5, droite: 5, maxEcart: 60, cachees: true, nomOsc: "RSI",
    });
    expect(r.annotations ?? {}).toEqual(attendu);
    // Garde-fou anti-tautologie : la fixture produit RÉELLEMENT une divergence
    // (sinon `attendu` serait {} et l'égalité ci-dessus passerait sans rien vérifier).
    expect(attendu.segments?.length ?? 0).toBeGreaterThan(0);
  });
});
