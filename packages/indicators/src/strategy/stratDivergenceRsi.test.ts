/**
 * @axiom/indicators — strategy/stratDivergenceRsi.test.ts
 *
 * Fixture reprise TELLE QUELLE de `momentum/rsiDivergence.test.ts` (double V,
 * PROUVÉE : creux prix idx24 → idx48, plus-bas plus bas côté prix, RSI en
 * plus-bas plus HAUT), mais recalculée avec `{length: 3, gauche: 2, droite: 2}`
 * (au lieu des défauts 14/5/5) — le RSI(3) et les pivots gauche/droite=2 changent
 * la géométrie, donc `idxTo` n'est PAS supposé : il est re-dérivé dans le test
 * en appelant `detecterDivergences` directement (même cœur que la def), ce qui
 * sert aussi de garde anti-tautologie (la fixture doit RÉELLEMENT produire une
 * divergence régulière haussière sous ces params).
 *
 * Anti-look-ahead PINNÉ : `detecterDivergences` date la divergence à son pivot
 * `idxTo`, mais ce pivot n'est confirmé que `droite` bougies plus tard — le
 * test vérifie donc un marqueur EXACTEMENT à `idxTo + droite` ET l'ABSENCE de
 * tout marqueur à `idxTo` (assertion négative : si l'entrée était posée au
 * pivot lui-même, ce test la détecterait comme du repaint).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { detecterDivergences } from "../utils-divergence";
import { lowOf } from "../utils";
import { rsiOf } from "../momentum/rsi";
import { stratDivergenceRsi } from "./stratDivergenceRsi";

/** Série linéaire par morceaux — même helper que utils-divergence.test.ts / rsiDivergence.test.ts. */
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

// Fixture v1/v2 éprouvée (rsiDivergence.test.ts) : creux idx24 (62) → idx48 (58), LL côté prix.
const closes = rampe(60, [[0, 100], [10, 108], [24, 62], [36, 88], [48, 58], [59, 74]]);
const candles = candlesFromCloses(closes);
const OPTS = { gauche: 2, droite: 2, maxEcart: 60 };
const PARAMS = { length: 3, gauche: 2, droite: 2, maxEcart: 60, seuilSortie: 70 };

describe("stratDivergenceRsi", () => {
  it("contrat : strategy/overlay, inputs propres + lignesTrades en dernier", () => {
    expect(stratDivergenceRsi.category).toBe("strategy");
    expect(stratDivergenceRsi.pane).toBe("overlay");
    expect(stratDivergenceRsi.inputs.map((i) => i.key)).toEqual([
      "length", "gauche", "droite", "maxEcart", "seuilSortie", "lignesTrades",
    ]);
  });

  it("entrée long à idxTo + droite (confirmation), JAMAIS à idxTo (anti-look-ahead pinné)", () => {
    // Re-dérivation indépendante : même cœur (`detecterDivergences`) que la def,
    // appelé ici sur le RSI(3) et les lows bruts pour retrouver idxTo SANS le
    // supposer à la main.
    const rsi = rsiOf(closes, PARAMS.length);
    const divs = detecterDivergences(lowOf(candles), rsi, OPTS);
    const div = divs.find((d) => d.type === "haussiere");
    // Garde anti-tautologie : la fixture doit RÉELLEMENT produire une divergence
    // régulière haussière sous ces params (sinon `div` serait undefined et la
    // suite du test ne prouverait rien).
    expect(div).toBeDefined();
    const idxTo = div!.idxTo;
    const idxConfirmation = idxTo + OPTS.droite;

    const r = computeIndicator(stratDivergenceRsi, candles, PARAMS);
    const marqueurs = r.annotations?.marqueurs ?? [];
    // Anti-tautologie sur le rendu lui-même : au moins un marqueur produit.
    expect(marqueurs.length).toBeGreaterThanOrEqual(1);

    const auPivot = marqueurs.filter((m) => m.idx === idxTo);
    const alaConfirmation = marqueurs.filter((m) => m.idx === idxConfirmation);
    // Assertion négative pinnée : aucun marqueur au pivot lui-même (repaint).
    expect(auPivot).toEqual([]);
    // L'entrée long apparaît exactement à idxTo + droite.
    expect(alaConfirmation).toEqual([
      {
        idx: idxConfirmation,
        valeur: candles[idxConfirmation]!.low,
        forme: "triangleHaut",
        couleur: "--up",
        cible: "prix",
        info: `Entrée long ${candles[idxConfirmation]!.close.toFixed(2)} — divergence RSI haussière confirmée (2/2)`,
      },
    ]);
  });

  it("seuilSortie bas (55) : sortie plus précoce qu'avec le défaut (70) — preuve de sortie", () => {
    const rDefaut = computeIndicator(stratDivergenceRsi, candles, PARAMS);
    const rBas = computeIndicator(stratDivergenceRsi, candles, { ...PARAMS, seuilSortie: 55 });
    const labelsDefaut = rDefaut.annotations?.labels ?? [];
    const labelsBas = rBas.annotations?.labels ?? [];
    expect(labelsDefaut.length).toBeGreaterThanOrEqual(1);
    expect(labelsBas.length).toBeGreaterThanOrEqual(1);
    // Le seuil de sortie plus bas ferme la position PLUS TÔT (RSI franchit 55 avant 70).
    expect(labelsBas[0]!.idx).toBeLessThan(labelsDefaut[0]!.idx);
  });
});
