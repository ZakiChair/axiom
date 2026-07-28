/**
 * @axiom/indicators — strategy/stratCroisementMM.test.ts
 *
 * Dérivation à la main (type SMA, rapide=2, lente=3 — traçable de tête) :
 * closes = [10, 12, 14, 16, 14, 12, 10, 8, 9, 13, 15, 16, 16]   (n=13)
 * sma2   = [ u, 11, 13, 15, 15, 13, 11, 9, 8.5, 11, 14, 15.5, 16]
 * sma3   = [ u,  u, 12, 14, 14.6667, 14, 12, 10, 9, 10, 12.3333, 14.6667, 15.6667]
 * position (signe sma2−sma3) : [u, u, 1, 1, 1, −1, −1, −1, −1, 1, 1, 1, 1]
 *  - i=2 : premier état défini → matérialisation silencieuse (pas de trade).
 *  - i=5 : 1→−1 (prev=effectif[4]=1, cur=effectif[5]=−1) : ENTRÉE SHORT @ close[5]=12
 *    (pas de sortie : rien d'ouvert). Marqueur @ high[5]=13 (triangleBas).
 *  - i=9 : −1→1 (prev=effectif[8]=−1, cur=effectif[9]=1) : SORTIE SHORT @ close[9]=13
 *    → PnL = (13−12)/12×100×(−1) = −8.3333…% → « -8.33 % » (perdant, --down),
 *    label @ low[9]=12 (position "dessous") ; ENTRÉE LONG @ close[9]=13, même bougie
 *    (retournement direct 1→−1 côté état, i.e. −1→1 côté position — sortie+entrée
 *    pinnées ensemble par les deux `toEqual` ci-dessous), marqueur @ low[9]=12
 *    (triangleHaut).
 *  - i∈[10,11] : long maintenu (dernière transition admissible = n−2 = 11, pas de
 *    transition ici) ; i=12 = n−1 : hors bornes (anti-repaint).
 * prixEntree : trade short [5..9]=12, écrasé en 9 par le trade long ouvert [9..12]=13
 *   → [u,u,u,u,u, 12,12,12,12, 13,13,13,13].
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { stratCroisementMM } from "./stratCroisementMM";

const closes = [10, 12, 14, 16, 14, 12, 10, 8, 9, 13, 15, 16, 16];
const candles: Candle[] = closes.map((c, i) => ({
  time: 1_700_000_000_000 + i * 3_600_000,
  open: c, high: c + 1, low: c - 1, close: c, volume: 1,
}));
const PARAMS = { type: "sma", rapide: 2, lente: 3 };

describe("stratCroisementMM", () => {
  it("contrat : strategy/overlay, inputs propres + lignesTrades en dernier", () => {
    expect(stratCroisementMM.category).toBe("strategy");
    expect(stratCroisementMM.pane).toBe("overlay");
    expect(stratCroisementMM.inputs.map((i) => i.key)).toEqual(["type", "rapide", "lente", "lignesTrades"]);
  });

  it("aller-retour dérivé à la main : short 12→13 (−8.33 %) puis long en cours", () => {
    const r = computeIndicator(stratCroisementMM, candles, PARAMS);
    expect(r.annotations?.marqueurs).toEqual([
      { idx: 5, valeur: 13, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: "Entrée short 12.00 — croisement SMA 2 < SMA 3" },
      { idx: 9, valeur: 12, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 13.00 — croisement SMA 2 > SMA 3" },
    ]);
    expect(r.annotations?.labels).toEqual([
      // Sortie de SHORT → label SOUS le low (position "dessous"), valeur = low[9] = 12.
      { idx: 9, valeur: 12, texte: "-8.33 %", couleur: "--down", cible: "prix", position: "dessous",
        info: "Sortie short 13.00 (-8.33 %) — croisement inverse" },
    ]);
    expect(r.annotations?.segments).toEqual([
      { deIdx: 5, deValeur: 12, aIdx: 9, aValeur: 13, trait: "pointille", couleur: "--down", cible: "prix",
        info: "Short 12.00 → 13.00, -8.33 % en 4 bougies (hors frais) — croisement SMA 2 < SMA 3" },
    ]);
    expect(r.series["prixEntree"]).toEqual(
      [undefined, undefined, undefined, undefined, undefined, 12, 12, 12, 12, 13, 13, 13, 13]
    );
  });
});
