/**
 * @axiom/indicators — strategy/stratRsiReversion.test.ts
 *
 * Dérivation à la main (length=3, survente=30, surachat=70) — RSI(3) de Wilder,
 * même patron que momentum/rsi.test.ts (fractions exactes, RMA amorcée par la
 * SMA des 3 premiers deltas) :
 *
 * closes = [50, 45, 40, 35, 30, 28, 32, 38, 45, 52, 58, 65, 72]  (n=13)
 *
 * deltas (bougie i, i=1..12) :
 *   1:-5  2:-5  3:-5  4:-5  5:-2  6:+4  7:+6  8:+7  9:+7  10:+6  11:+7  12:+7
 * gains  (index j → bougie j+1) : [0,0,0,0,0,4,6,7,7,6,7,7]
 * pertes                         : [5,5,5,5,2,0,0,0,0,0,0,0]
 *
 * RMA(length=3), amorce = SMA des 3 premières valeurs, placée à j=2 (bougie3) :
 *   avgGain : b3=0  b4=0  b5=0  b6=(0+(4-0)/3)=4/3  b7=4/3+(6-4/3)/3=26/9
 *             b8=26/9+(7-26/9)/3=115/27
 *   avgLoss : b3=(5+5+5)/3=5  b4=5+(5-5)/3=5  b5=5+(2-5)/3=4
 *             b6=4+(0-4)/3=8/3  b7=8/3+(0-8/3)/3=16/9  b8=16/9+(0-16/9)/3=32/27
 *
 * RSI = 100 − 100/(1+avgGain/avgLoss) :
 *   b3=0  b4=0  b5=0
 *   b6 = 100 − 100/(1+(4/3)/(8/3)) = 100 − 100/1.5      = 33.333…
 *   b7 = 100 − 100/(1+(26/9)/(16/9)) = 100 − 100/2.625  = 61.904…
 *   b8 = 100 − 100/(1+(115/27)/(32/27)) = 100 − 100/4.59375 = 78.231…
 *   (b0,b1,b2 : undefined, fenêtre RMA non pleine)
 *
 * Machine à états (etat initial 0, out[i] reste undefined tant que rsi[i] l'est) :
 *  i=3 : cur=rsi[3]=0, prev=rsi[2]=undefined → pas de recroisement possible
 *        (garde `prev !== undefined`) → matérialisation silencieuse, etat=0.
 *  i=4,5 : cur=0, prev=0 → cur < survente → pas de transition.
 *  i=6 : prev=rsi[5]=0 < 30 ≤ cur=rsi[6]=33.33… → RECROISEMENT → etat=1
 *        → ENTRÉE LONG @ close[6]=32.
 *  i=7 : etat=1, cur=61.90… < 70 → maintien.
 *  i=8 : etat=1, cur=78.23… ≥ 70 → etat=0 → SORTIE LONG @ close[8]=45
 *        (PnL = (45−32)/32×100 = 40.625 → « +40.63 % »).
 *  i∈[9,12] : etat=0, cur ≥ survente en permanence (RSI reste haut) →
 *             jamais de nouveau recroisement à la hausse → pas de ré-entrée.
 * Un seul aller-retour : 1 marqueur d'entrée, 1 label de sortie.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { stratRsiReversion } from "./stratRsiReversion";

/** Bougies plates (open=high=low=close) : seul le close pilote le RSI. */
function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: close, high: close, low: close, close, volume: 1,
  }));
}

const closes = [50, 45, 40, 35, 30, 28, 32, 38, 45, 52, 58, 65, 72];
const candles = candlesFromCloses(closes);
const PARAMS = { length: 3, survente: 30, surachat: 70 };

describe("stratRsiReversion", () => {
  it("contrat : strategy/overlay, inputs propres + lignesTrades en dernier", () => {
    expect(stratRsiReversion.category).toBe("strategy");
    expect(stratRsiReversion.pane).toBe("overlay");
    expect(stratRsiReversion.inputs.map((i) => i.key)).toEqual([
      "length", "survente", "surachat", "lignesTrades",
    ]);
  });

  it("recroisement de survente → long 32→45 (+40.63 %), pas de ré-entrée (dérivé à la main)", () => {
    const r = computeIndicator(stratRsiReversion, candles, PARAMS);
    expect(r.annotations?.marqueurs).toEqual([
      { idx: 6, valeur: 32, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 32.00 — RSI 3 sort de survente (30)" },
    ]);
    expect(r.annotations?.labels).toEqual([
      { idx: 8, valeur: 45, texte: "+40.63 %", couleur: "--up", cible: "prix", position: "dessus",
        info: "Sortie long 45.00 (+40.63 %) — RSI 3 atteint le surachat (70)" },
    ]);
    // Jamais de jambe short (long/flat) : aucun marqueur triangleBas.
    for (const mq of r.annotations?.marqueurs ?? []) {
      expect(mq.forme).toBe("triangleHaut");
    }
    expect(r.series["prixEntree"]).toEqual([
      undefined, undefined, undefined, undefined, undefined, undefined,
      32, 32, 32, undefined, undefined, undefined, undefined,
    ]);
  });
});
