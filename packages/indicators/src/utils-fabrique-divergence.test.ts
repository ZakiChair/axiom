/**
 * @axiom/indicators — utils-fabrique-divergence.test.ts
 *
 * La fabrique est du CÂBLAGE : oscillateur injecté → série de sortie + annotations
 * via construireAnnotationsDivergence (elle-même dérivée à la main dans
 * utils-annotations.test.ts). On teste ici le contrat du def généré et le câblage,
 * en réutilisant la fixture « haussière régulière » de utils-annotations.test.ts
 * (mêmes highs/lows/osc, mêmes attendus avec gauche=2/droite=2).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "./engine";
import { construireAnnotationsDivergence } from "./utils-annotations";
import { defDivergenceOscillateur } from "./utils-fabrique-divergence";

const lows = [10, 9, 8, 9, 10, 9, 7, 8, 9, 10];
const highs = [12, 11, 10, 11, 12, 11, 9, 10, 11, 12];
const osc = [5, 4, 3, 4, 5, 4, 3.5, 4.5, 5, 5.5];

const candles: Candle[] = lows.map((low, i) => ({
  time: 1_700_000_000_000 + i * 60_000,
  open: low,
  high: highs[i] ?? low,
  low,
  close: (low + (highs[i] ?? low)) / 2,
  volume: 1,
}));

const def = defDivergenceOscillateur({
  id: "testDivergence",
  name: "Test Divergence",
  category: "momentum",
  inputsOsc: [{ key: "longueur", name: "Longueur", type: "number", default: 14, min: 1 }],
  serieOsc: { key: "osc", name: "OSC" },
  oscillateur: () => osc,
});

describe("defDivergenceOscillateur", () => {
  it("contrat du def : pane séparé, inputs propres + communs, une sortie ligne", () => {
    expect(def.id).toBe("testDivergence");
    expect(def.pane).toBe("separate");
    expect(def.inputs.map((i) => i.key)).toEqual(["longueur", "gauche", "droite", "maxEcart", "cachees"]);
    expect(def.outputs).toEqual([{ key: "osc", name: "OSC", style: "line" }]);
  });

  it("câblage : série = oscillateur injecté, annotations = moteur commun", () => {
    const r = computeIndicator(def, candles, { gauche: 2, droite: 2 });
    expect(r.series["osc"]).toEqual(osc);
    expect(r.annotations).toEqual(
      construireAnnotationsDivergence(highs, lows, osc, {
        gauche: 2, droite: 2, maxEcart: 60, cachees: true, nomOsc: "OSC",
      })
    );
    expect(r.annotations?.segments?.length).toBe(2); // garde-fou anti-tautologie : il Y A une divergence
  });

  it("défauts (gauche=5/droite=5 sur 10 bougies) : aucun pivot → pas d'annotations", () => {
    const r = computeIndicator(def, candles);
    expect(r.series["osc"]).toEqual(osc);
    expect(r.annotations).toBeUndefined();
  });
});
