/**
 * @axiom/indicators — strategy/stratRsiRange.test.ts
 *
 * RSI (RMA de Wilder) + ADX (RMA en cascade) ne sont pas traçables de tête :
 * recomposés en appelant `rsiOf`/`adxOf` directement dans le test (patron
 * stratMmAdx). Fixture en cinq temps (n=90, rsiLength=3, seuils 30/70,
 * adxLength=14, seuilAdx=25), prouvée EMPIRIQUEMENT avant de figer les
 * assertions :
 *   - i∈[0,27]  : chute soutenue 200→65 (−5/bougie) → ADX se définit à i=27
 *     (100, tendance maximale), RSI(3) écrasé à 0.
 *   - i∈[28,30] : rebond [70,76,82] → RSI recroise 30 à la hausse dès i=28
 *     (0 → 33.3) MAIS ADX≈99 ≥ 25 → PIN : entrée IGNORÉE (et le recroisement
 *     SHORT de i=33, 76.5 → 57.9 sous 70, est ignoré pareil : ADX≈86).
 *   - i∈[31,70] : bruit alterné ~82 → DX écrasé, l'ADX décroît et passe sous
 *     25 entre i=67 (25.38) et i=68 (24.06) ; le RSI du chop reste dans
 *     [36,63] → aucun recroisement parasite.
 *   - i∈[71,77] : creux [81.3,80.6,79.9] (RSI→27.7) puis reprise → ENTRÉE
 *     LONG à i=74 (RSI 27.7→33.3, ADX 19.8<25) @ close 80.1 ; RSI 67.5 ≥ 50
 *     à i=76 → SORTIE @ 81.4 → +1.6229 % → « +1.62 % ». La reprise pousse le
 *     RSI à 81.6 (i=77) puis 59.1 (i=78) : recroisement SOUS 70 → ENTRÉE
 *     SHORT @ 81.9 (ADX 16.4), RSI 41.8 ≤ 50 à i=79 → SORTIE @ 81.2 →
 *     +0.8547 % → « +0.85 % » (jambe short exercée).
 *   - i∈[78,89] : creux2 (RSI 29.1 à i=80) + reprise → RE-ENTRÉE LONG à i=81
 *     @ 80.8 (ADX 15.1), puis KRACH [76→27] : le RSI reste < 50 (jamais de
 *     sortie zone neutre) pendant que l'ADX remonte — 23.64 à i=85 (position
 *     TENUE) puis 26.95 ≥ 25 à i=86 → PIN : FLAT FORCÉ @ 54 → −33.1683 % →
 *     « -33.17 % » en 5 bougies.
 * Sémantique de borne (documentée dans le def) : range = ADX STRICTEMENT sous
 * le seuil ; ADX == seuil → tendance → filtré/flat (miroir exact de
 * stratMmAdx, où ADX == seuil compte comme tendance ACTIVE).
 * Garde anti-tautologie : comptes figés (3 marqueurs, 3 labels, 3 segments).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { etatsStrategie } from "../utils-fabrique-strategie";
import { rsiOf } from "../momentum/rsi";
import { adxOf } from "../trend/adx";
import { stratRsiRange } from "./stratRsiRange";

function mkCandles(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: c, high: c + 1, low: c - 1, close: c, volume: 1,
  }));
}

// Phase A : chute soutenue (ADX au plafond, RSI écrasé) — i∈[0,27]
const chute = Array.from({ length: 28 }, (_v, i) => 200 - 5 * i); // 200 → 65
// Phase B : rebond en pleine tendance (recroisements IGNORÉS) — i∈[28,30]
const rebondTendance = [70, 76, 82];
// Phase C : bruit alterné (DX écrasé → l'ADX décroît sous le seuil) — i∈[31,70]
const bruit = [0, 1, -0.8, 1.2, -0.6, 0.9, -1, 0.7, -0.9, 1.1];
const decay = Array.from({ length: 40 }, (_v, i) => 82 + (bruit[i % 10] ?? 0));
// Phase D : creux + reprise EN RANGE → entrée long, sortie zone neutre, puis short — i∈[71,77]
const creux = [81.3, 80.6, 79.9];
const reprise = [80.1, 80.4, 81.4, 82.6];
// Phase E : creux2 + reprise → ré-entrée, puis krach (ADX ≥ seuil → flat forcé) — i∈[78,89]
const creux2 = [81.9, 81.2, 80.5];
const reprise2 = [80.8];
const krach = [76, 72, 67, 61, 54, 46, 37, 27];
const closes = [...chute, ...rebondTendance, ...decay, ...creux, ...reprise, ...creux2, ...reprise2, ...krach];
const candles = mkCandles(closes);
const PARAMS = { rsiLength: 3, seuilBas: 30, seuilHaut: 70, adxLength: 14, seuilAdx: 25 };

describe("stratRsiRange", () => {
  it("contrat : strategy/overlay, statut validation typé, inputs propres + lignesTrades en dernier", () => {
    expect(stratRsiRange.category).toBe("strategy");
    expect(stratRsiRange.pane).toBe("overlay");
    // Le statut est porté par une DONNÉE, pas par le nom (il y était tronqué en
    // premier dans un panneau de 288 px). Cf. IndicatorDef.validation.
    expect(stratRsiRange.validation).toBe("non-valide");
    expect(stratRsiRange.name).not.toContain("(non validé)");
    expect(stratRsiRange.inputs.map((i) => i.key)).toEqual([
      "rsiLength", "seuilBas", "seuilHaut", "adxLength", "seuilAdx", "lignesTrades",
    ]);
  });

  it("pin : réversion en tendance → IGNORÉE, les deux jambes (le filtre de régime est la raison d'être du def)", () => {
    // Recomposition indépendante : cœurs importés directement.
    const r = rsiOf(closes, PARAMS.rsiLength);
    const a = adxOf(candles, PARAMS.adxLength);
    // Le recroisement LONG à i=28 est bien là (RSI repasse au-dessus de 30)...
    expect(r[27]!).toBeLessThan(30);
    expect(r[28]!).toBeGreaterThanOrEqual(30);
    // ...et le recroisement SHORT à i=33 aussi (RSI repasse sous 70)...
    expect(r[32]!).toBeGreaterThan(70);
    expect(r[33]!).toBeLessThanOrEqual(70);
    // ...mais l'ADX est au-dessus du seuil aux deux : sans le filtre, les
    // états seraient 1 puis -1.
    expect(a.adx[28]!).toBeGreaterThanOrEqual(25);
    expect(a.adx[33]!).toBeGreaterThanOrEqual(25);

    const etats = etatsStrategie("stratRsiRange", candles, PARAMS);
    // Warm-up : undefined tant que l'ADX ne l'est pas, puis flat.
    expect(etats?.[26]).toBeUndefined();
    expect(etats?.[27]).toBe(0);
    // Tant que l'ADX reste ≥ 25 (jusqu'à i=67 inclus), flat forcé partout.
    for (let i = 27; i <= 67; i++) expect(etats?.[i]).toBe(0);
    expect(a.adx[67]!).toBeGreaterThanOrEqual(25);
    expect(a.adx[68]!).toBeLessThan(25);
  });

  it("pin : ADX franchit le seuil en position → FLAT FORCÉ (ce n'est pas la sortie zone neutre)", () => {
    const r = rsiOf(closes, PARAMS.rsiLength);
    const a = adxOf(candles, PARAMS.adxLength);
    const etats = etatsStrategie("stratRsiRange", candles, PARAMS);
    // À i=85 la position longue est TENUE : RSI très bas (jamais ≥ 50 depuis
    // l'entrée) et ADX encore sous le seuil.
    expect(r[85]!).toBeLessThan(50);
    expect(a.adx[85]!).toBeLessThan(25);
    expect(etats?.[85]).toBe(1);
    // À i=86 l'ADX franchit le seuil ALORS QUE le RSI est toujours < 50 : la
    // coupe vient de l'ADX (le range est fini), pas de la zone neutre.
    expect(a.adx[86]!).toBeGreaterThanOrEqual(25);
    expect(r[86]!).toBeLessThan(50);
    expect(etats?.[86]).toBe(0);
  });

  it("pin borne : ADX EXACTEMENT égal au seuil → filtré (≥ = tendance, miroir de stratMmAdx)", () => {
    // seuilAdx fixé À la valeur exacte de l'ADX au bar d'entrée i=74 —
    // distingue `adx >= seuil` (filtre le cas limite, sémantique documentée)
    // de `adx > seuil` (laisserait passer l'entrée), off-by-one plausible.
    const a = adxOf(candles, PARAMS.adxLength);
    const seuilPile = a.adx[74]!;
    const etatsPile = etatsStrategie("stratRsiRange", candles, { ...PARAMS, seuilAdx: seuilPile });
    expect(etatsPile?.[74]).toBe(0); // ADX == seuil → tendance → entrée filtrée
    const etats = etatsStrategie("stratRsiRange", candles, PARAMS);
    expect(etats?.[74]).toBe(1); // contraste : avec le seuil de la fixture (25), l'entrée passe
  });

  it("fixture : trois allers-retours dérivés (long +1.62 %, short +0.85 %, long -33.17 % coupé par l'ADX)", () => {
    // Recomposition des points d'entrée/sortie.
    const r = rsiOf(closes, PARAMS.rsiLength);
    const a = adxOf(candles, PARAMS.adxLength);
    expect(r[73]!).toBeLessThan(30); // creux sous la survente...
    expect(r[74]!).toBeGreaterThanOrEqual(30); // ...recroisement à la hausse
    expect(a.adx[74]!).toBeLessThan(25); // ...en régime de range
    expect(r[76]!).toBeGreaterThanOrEqual(50); // sortie : zone neutre atteinte
    expect(r[77]!).toBeGreaterThan(70); // pic au-dessus du surachat...
    expect(r[78]!).toBeLessThanOrEqual(70); // ...recroisement à la baisse (short)
    expect(r[79]!).toBeLessThanOrEqual(50); // sortie short : zone neutre
    expect(r[80]!).toBeLessThan(30); // creux2...
    expect(r[81]!).toBeGreaterThanOrEqual(30); // ...ré-entrée long

    const res = computeIndicator(stratRsiRange, candles, PARAMS);
    expect(res.annotations?.marqueurs).toEqual([
      { idx: 74, valeur: 79.1, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 80.10 — RSI 3 sort de survente (30) en range ADX < 25 — stratégie non validée" },
      { idx: 78, valeur: 82.9, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: "Entrée short 81.90 — RSI 3 sort de surachat (70) en range ADX < 25 — stratégie non validée" },
      { idx: 81, valeur: 79.8, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 80.80 — RSI 3 sort de survente (30) en range ADX < 25 — stratégie non validée" },
    ]);
    expect(res.annotations?.labels).toEqual([
      { idx: 76, valeur: 82.4, texte: "+1.62 %", couleur: "--up", cible: "prix", position: "dessus",
        info: "Sortie long 81.40 (+1.62 %) — RSI 3 revient à la zone neutre (50) ou ADX ≥ 25 — stratégie non validée" },
      { idx: 79, valeur: 80.2, texte: "+0.85 %", couleur: "--up", cible: "prix", position: "dessous",
        info: "Sortie short 81.20 (+0.85 %) — RSI 3 revient à la zone neutre (50) ou ADX ≥ 25 — stratégie non validée" },
      { idx: 86, valeur: 55, texte: "-33.17 %", couleur: "--down", cible: "prix", position: "dessus",
        info: "Sortie long 54.00 (-33.17 %) — RSI 3 revient à la zone neutre (50) ou ADX ≥ 25 — stratégie non validée" },
    ]);
    expect(res.annotations?.segments).toEqual([
      { deIdx: 74, deValeur: 80.1, aIdx: 76, aValeur: 81.4, trait: "pointille", couleur: "--up", cible: "prix",
        info: "Long 80.10 → 81.40, +1.62 % en 2 bougies (hors frais) — RSI 3 sort de survente (30) en range ADX < 25 — stratégie non validée" },
      { deIdx: 78, deValeur: 81.9, aIdx: 79, aValeur: 81.2, trait: "pointille", couleur: "--up", cible: "prix",
        info: "Short 81.90 → 81.20, +0.85 % en 1 bougies (hors frais) — RSI 3 sort de surachat (70) en range ADX < 25 — stratégie non validée" },
      { deIdx: 81, deValeur: 80.8, aIdx: 86, aValeur: 54, trait: "pointille", couleur: "--down", cible: "prix",
        info: "Long 80.80 → 54.00, -33.17 % en 5 bougies (hors frais) — RSI 3 sort de survente (30) en range ADX < 25 — stratégie non validée" },
    ]);
    // prixEntree : trois vies de trade, rien ailleurs.
    for (let i = 0; i <= 73; i++) expect(res.series["prixEntree"]?.[i]).toBeUndefined();
    for (let i = 74; i <= 76; i++) expect(res.series["prixEntree"]?.[i]).toBe(80.1);
    expect(res.series["prixEntree"]?.[77]).toBeUndefined();
    for (let i = 78; i <= 79; i++) expect(res.series["prixEntree"]?.[i]).toBe(81.9);
    expect(res.series["prixEntree"]?.[80]).toBeUndefined();
    for (let i = 81; i <= 86; i++) expect(res.series["prixEntree"]?.[i]).toBe(80.8);
    for (let i = 87; i < closes.length; i++) expect(res.series["prixEntree"]?.[i]).toBeUndefined();
  });
});
