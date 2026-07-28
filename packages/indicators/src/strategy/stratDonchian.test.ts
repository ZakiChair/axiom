/**
 * @axiom/indicators — strategy/stratDonchian.test.ts
 *
 * Dérivation à la main (canal=3) — canal des 3 bougies PRÉCÉDENTES (la bougie
 * courante est EXCLUE de son propre canal, sinon le breakout est indétectable) :
 * highs = [10,11,12,11,10,11,12,15,16,15,14,13,10,11]  (n=14)
 * lows  = highs − 2 ; closes = highs − 1
 * hh3   = [ u, u,12,12,12,11,12,15,16,16,16,15,14,13]
 * ll3   = [ u, u, 8, 9, 8, 8, 8, 9,10,13,12,11, 8, 8]
 * position[i] compare close[i] à hh3[i−1] / ll3[i−1] (définis dès i=3) :
 *  i=3 : close 10 ∈ ]8,12[ → premier état = 0 (silencieux)
 *  i∈[4,6] : dans le canal → 0
 *  i=7 : close 14 > hh3[6]=12 → 1 → ENTRÉE LONG @ 14
 *  i∈[8,11] : maintien 1 (jamais < ll3 précédent)
 *  i=12 : close 9 < ll3[11]=11 → −1 → SORTIE LONG @ 9
 *         (PnL = (9−14)/14×100 = −35.7142… → « -35.71 % ») + ENTRÉE SHORT @ 9
 *  i=13 = n−1 : hors transitions. Trade short EN COURS.
 * prixEntree : [u×7, 14,14,14,14,14, 9, 9].
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { stratDonchian } from "./stratDonchian";

const highs = [10, 11, 12, 11, 10, 11, 12, 15, 16, 15, 14, 13, 10, 11];
const candles: Candle[] = highs.map((h, i) => ({
  time: 1_700_000_000_000 + i * 3_600_000,
  open: h - 1, high: h, low: h - 2, close: h - 1, volume: 1,
}));

describe("stratDonchian", () => {
  it("contrat", () => {
    expect(stratDonchian.category).toBe("strategy");
    expect(stratDonchian.pane).toBe("overlay");
    expect(stratDonchian.inputs.map((i) => i.key)).toEqual(["canal", "lignesTrades"]);
  });

  it("breakout haut → long, cassure basse → retournement short (dérivé à la main)", () => {
    const r = computeIndicator(stratDonchian, candles, { canal: 3 });
    expect(r.annotations?.marqueurs).toEqual([
      { idx: 7, valeur: 13, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 14.00 — cassure du plus-haut 3 bougies" },
      { idx: 12, valeur: 10, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: "Entrée short 9.00 — cassure du plus-bas 3 bougies" },
    ]);
    expect(r.annotations?.labels).toEqual([
      { idx: 12, valeur: 10, texte: "-35.71 %", couleur: "--down", cible: "prix", position: "dessus",
        info: "Sortie long 9.00 (-35.71 %) — cassure du canal opposé" },
    ]);
    expect(r.series["prixEntree"]).toEqual(
      [undefined, undefined, undefined, undefined, undefined, undefined, undefined, 14, 14, 14, 14, 14, 9, 9]
    );
  });
});
