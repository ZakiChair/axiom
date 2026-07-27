/**
 * obvDivergence v2 — tests de CONTRAT + CÂBLAGE (même patron que
 * rsiDivergence.test.ts). La géométrie des annotations est dérivée à la main
 * dans utils-annotations.test.ts et l'OBV dans obv.test.ts : ici on vérifie que
 * le def assemble bien ces briques hand-testées (comparaison aux fonctions
 * pures composées), plus un garde-fou anti-tautologie : la fixture produit
 * RÉELLEMENT une divergence (vérifié empiriquement en exécutant le code réel).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { construireAnnotationsDivergence } from "../utils-annotations";
import { highOf, lowOf } from "../utils";
import { obvOf } from "./obv";
import { obvDivergence } from "./obvDivergence";

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
 * Volume variable par segment : le signe de chaque delta OBV est fixé par le
 * sens du prix (rampe), mais l'AMPLEUR du volume par bougie est libre — elle
 * découple la profondeur des creux OBV de celle des creux prix. Ici le 2ᵉ repli
 * de prix (idx36→48) porte un volume bien plus faible que le 1er (idx10→24) :
 * même si le prix fait un plus bas plus BAS, l'OBV cumulé fait un plus bas plus
 * HAUT (moins de volume vendeur) → divergence haussière régulière.
 */
function volumePourIndex(i: number): number {
  if (i <= 10) return 200;
  if (i <= 24) return 100;
  if (i <= 36) return 150;
  if (i <= 48) return 30;
  return 150;
}

function candlesAvecVolume(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: volumePourIndex(i),
  }));
}

describe("obvDivergence v2", () => {
  it("contrat : pane séparé, sortie unique obv, inputs communs (pas d'input propre)", () => {
    expect(obvDivergence.pane).toBe("separate");
    expect(obvDivergence.outputs).toEqual([{ key: "obv", name: "OBV", style: "line" }]);
    expect(obvDivergence.inputs.map((i) => i.key)).toEqual([
      "gauche", "droite", "maxEcart", "cachees",
    ]);
  });

  it("câblage : série = obvOf(candles), annotations = moteur commun sur l'OBV", () => {
    // Fixture éprouvée empiriquement : creux prix idx24 (close 62) puis idx48
    // (close 58) → LL ; volume du 2ᵉ repli bien plus faible → creux OBV plus HAUT
    // → divergence haussière régulière détectée avec les pivots par défaut
    // (gauche/droite=5).
    const closes = rampe(60, [[0, 100], [10, 108], [24, 62], [36, 88], [48, 58], [59, 74]]);
    const candles = candlesAvecVolume(closes);
    const r = computeIndicator(obvDivergence, candles, {});
    const obvAttendu = obvOf(candles);
    expect(r.series["obv"]).toEqual(obvAttendu);
    // `?? {}` : la fabrique omet la clé `annotations` quand le moteur renvoie {}
    // — l'égalité doit tenir dans les deux cas (divergence présente ou non).
    const attendu = construireAnnotationsDivergence(highOf(candles), lowOf(candles), obvAttendu, {
      gauche: 5, droite: 5, maxEcart: 60, cachees: true, nomOsc: "OBV", formateur: (v) => v.toFixed(0),
    });
    expect(r.annotations ?? {}).toEqual(attendu);
    // Garde-fou anti-tautologie : la fixture produit RÉELLEMENT une divergence
    // (sinon `attendu` serait {} et l'égalité ci-dessus passerait sans rien vérifier).
    expect(attendu.segments?.length ?? 0).toBeGreaterThan(0);
  });
});
