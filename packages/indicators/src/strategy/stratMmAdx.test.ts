/**
 * @axiom/indicators — strategy/stratMmAdx.test.ts
 *
 * MM (SMA rapide/lente) + ADX (RMA en cascade) ne sont pas traçables de tête :
 * recomposés en appelant `sma`/`adxOf` directement dans le test. Fixture en
 * trois temps (n=50, type=sma, rapide=3, lente=5, adxLength=14, seuilAdx=25) :
 * un chop serré de 34 bougies (croisements MM fréquents mais ADX < 25 tout du
 * long dès qu'il se définit) puis une tendance haussière soutenue (ADX finit
 * par franchir 25) puis un retournement baissier.
 *   i=27 : ADX se définit (≈3.66 < 25) ALORS QUE rapide < lente (croisement
 *     brut short) → PIN : position forcée à 0 malgré le croisement — le
 *     filtre ADX est la raison d'être du def.
 *   i∈[27,41] : ADX < 25 tout du long → flat forcé (0), quels que soient les
 *     croisements MM successifs (chop).
 *   i=42 : ADX franchit 25 (≈26.89) AVEC rapide > lente → ENTRÉE LONG @ close[42]=152.
 *   i=45 : rapide < lente (retournement), ADX toujours ≥ 25 → SORTIE LONG @ close[45]=130
 *     → PnL=(130−152)/152×100=−14.4736…% → « -14.47 % » + ENTRÉE SHORT @ 130 (même bougie).
 * Garde anti-tautologie : comptes figés (2 marqueurs, 1 label) lus sur cette fixture.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { etatsStrategie } from "../utils-fabrique-strategie";
import { adxOf } from "../trend/adx";
import { sma } from "../utils";
import { stratMmAdx } from "./stratMmAdx";

const bruit = [0, 1, -0.8, 1.2, -0.6, 0.9, -1, 0.7, -0.9, 1.1];
const chop = Array.from({ length: 34 }, (_v, i) => 100 + (bruit[i % bruit.length] ?? 0));
const tendance = [101, 103.5, 107, 112, 118, 125, 133, 142, 152];
const retournement = [148, 140, 130, 118, 105, 95, 88];
const closes = [...chop, ...tendance, ...retournement];
const candles: Candle[] = closes.map((c, i) => ({
  time: 1_700_000_000_000 + i * 3_600_000,
  open: c, high: c + 1.5, low: c - 1.5, close: c, volume: 1,
}));
const PARAMS = { type: "sma", rapide: 3, lente: 5, adxLength: 14, seuilAdx: 25 };

describe("stratMmAdx", () => {
  it("contrat : strategy/overlay, inputs propres + lignesTrades en dernier", () => {
    expect(stratMmAdx.category).toBe("strategy");
    expect(stratMmAdx.pane).toBe("overlay");
    expect(stratMmAdx.inputs.map((i) => i.key)).toEqual([
      "type", "rapide", "lente", "adxLength", "seuilAdx", "lignesTrades",
    ]);
  });

  it("pin : croisement MM avec ADX < seuil reste flat (le filtre est la raison d'être du def)", () => {
    // Recomposition indépendante : cœurs importés directement, pas via la stratégie.
    const rapide = sma(closes, PARAMS.rapide);
    const lente = sma(closes, PARAMS.lente);
    const a = adxOf(candles, PARAMS.adxLength);
    // Le croisement brut à i=27 est bien SHORT (rapide < lente)...
    expect(rapide[27]).toBeLessThan(lente[27]!);
    // ...et l'ADX y est bien sous le seuil (25) — sans le filtre, l'état
    // serait donc -1, pas 0.
    expect(a.adx[27]).toBeLessThan(25);

    // Assertion directe sur les états bruts de la stratégie (avant fabrique) :
    // malgré le croisement brut, la position reste 0 tout du long du chop
    // (i∈[27,41], ADX < 25 partout).
    const etats = etatsStrategie("stratMmAdx", candles, PARAMS);
    for (let i = 27; i <= 41; i++) expect(etats?.[i]).toBe(0);
  });

  it("pin borne : ADX EXACTEMENT égal au seuil compte comme actif (≥, pas >)", () => {
    // seuilAdx fixé À la valeur exacte de l'ADX en i=42 — distingue
    // `adx < seuil` (actif quand égal) de `adx <= seuil` (filtrerait le cas
    // limite), un off-by-one plausible sur la borne du filtre.
    const a = adxOf(candles, PARAMS.adxLength);
    const seuilPile = a.adx[42]!;
    const etats = etatsStrategie("stratMmAdx", candles, { ...PARAMS, seuilAdx: seuilPile });
    expect(etats?.[42]).toBe(1); // croisement brut long, ADX == seuil → PAS filtré
  });

  it("fixture chop→tendance→retournement : aller-retour dérivé (long 152→130, -14.47 %)", () => {
    const r = computeIndicator(stratMmAdx, candles, PARAMS);
    expect(r.annotations?.marqueurs).toEqual([
      { idx: 42, valeur: 150.5, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 152.00 — croisement SMA 3 > SMA 5, ADX ≥ 25" },
      { idx: 45, valeur: 131.5, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: "Entrée short 130.00 — croisement SMA 3 < SMA 5, ADX ≥ 25" },
    ]);
    expect(r.annotations?.labels).toEqual([
      { idx: 45, valeur: 131.5, texte: "-14.47 %", couleur: "--down", cible: "prix", position: "dessus",
        info: "Sortie long 130.00 (-14.47 %) — croisement inverse ou ADX < 25" },
    ]);
    expect(r.annotations?.segments).toEqual([
      { deIdx: 42, deValeur: 152, aIdx: 45, aValeur: 130, trait: "pointille", couleur: "--down", cible: "prix",
        info: "Long 152.00 → 130.00, -14.47 % en 3 bougies (hors frais) — croisement SMA 3 > SMA 5, ADX ≥ 25" },
    ]);
    // Rien avant i=42 : le chop et sa fin (ADX < 25) ne produisent aucun trade.
    for (let i = 0; i < 42; i++) expect(r.series["prixEntree"]?.[i]).toBeUndefined();
    for (let i = 42; i <= 44; i++) expect(r.series["prixEntree"]?.[i]).toBe(152);
    for (let i = 45; i < closes.length; i++) expect(r.series["prixEntree"]?.[i]).toBe(130);
  });
});
