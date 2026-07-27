/**
 * mfiDivergence v2 — tests de CONTRAT + CÂBLAGE (même patron que
 * rsiDivergence.test.ts). La géométrie des annotations est dérivée à la main
 * dans utils-annotations.test.ts et le MFI dans mfi.test.ts : ici on vérifie
 * que le def assemble bien ces briques hand-testées (comparaison aux fonctions
 * pures composées), plus un garde-fou anti-tautologie : la fixture produit
 * RÉELLEMENT une divergence (vérifié empiriquement en exécutant le code réel
 * avec le défaut length=14).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { construireAnnotationsDivergence } from "../utils-annotations";
import { highOf, lowOf } from "../utils";
import { mfiOf } from "./mfi";
import { mfiDivergence } from "./mfiDivergence";

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

/** Bougies avec high/low écartés et volume variable (le MFI pondère le prix typique par le volume). */
function candlesAvecVolume(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close + 2,
    low: close - 2,
    close,
    volume: 100 + (i % 7) * 10,
  }));
}

describe("mfiDivergence v2", () => {
  it("contrat : pane séparé, sortie unique mfi, inputs osc + communs", () => {
    expect(mfiDivergence.pane).toBe("separate");
    expect(mfiDivergence.outputs).toEqual([{ key: "mfi", name: "MFI", style: "line" }]);
    expect(mfiDivergence.inputs.map((i) => i.key)).toEqual([
      "length", "gauche", "droite", "maxEcart", "cachees",
    ]);
  });

  it("câblage : série = mfiOf(candles, hlc3, length), annotations = moteur commun sur le MFI", () => {
    // Fixture éprouvée empiriquement (mêmes creux de prix idx24/idx48 que
    // rsiDivergence) : avec le défaut length=14 et pivots gauche/droite=5, le MFI
    // fait un plus-bas plus HAUT que le prix → divergence haussière régulière
    // détectée.
    const closes = rampe(60, [[0, 100], [10, 108], [24, 62], [36, 88], [48, 58], [59, 74]]);
    const candles = candlesAvecVolume(closes);
    const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
    const r = computeIndicator(mfiDivergence, candles, {});
    const mfiAttendu = mfiOf(candles, hlc3, 14);
    expect(r.series["mfi"]).toEqual(mfiAttendu);
    // `?? {}` : la fabrique omet la clé `annotations` quand le moteur renvoie {}
    // — l'égalité doit tenir dans les deux cas (divergence présente ou non).
    const attendu = construireAnnotationsDivergence(highOf(candles), lowOf(candles), mfiAttendu, {
      gauche: 5, droite: 5, maxEcart: 60, cachees: true, nomOsc: "MFI",
    });
    expect(r.annotations ?? {}).toEqual(attendu);
    // Garde-fou anti-tautologie : la fixture produit RÉELLEMENT une divergence
    // (sinon `attendu` serait {} et l'égalité ci-dessus passerait sans rien vérifier).
    expect(attendu.segments?.length ?? 0).toBeGreaterThan(0);
  });
});
