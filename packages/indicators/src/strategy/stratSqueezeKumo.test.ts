/**
 * @axiom/indicators — strategy/stratSqueezeKumo.test.ts
 *
 * LA preuve de fidélité de la promotion : `etatsStrategie("stratSqueezeKumo",
 * candles, {})` (défauts = constantes de campagne) doit être IDENTIQUE, élément
 * par élément, à `candSqueezeKumo.position(candles)` de `candidatsChampion.ts`
 * (fichier intouchable) — sur une fixture qui exerce les deux issues d'une
 * libération armée : une PRISE (au-dessus du nuage) et une IGNORÉE (dans le
 * nuage).
 *
 * Fixture (n=151, prouvée EMPIRIQUEMENT via les cœurs recomposés avant de
 * figer les assertions — leçon du repo : une rampe linéaire ne libère pas) :
 *   - i∈[0,99]   : range serré ~100 (demi-span 1) → squeeze ON ; Ichimoku
 *     (9/26/52, déplacement 26) ne se définit qu'à i=77 (spanB) — le candidat
 *     fait `continue` avant : les bougies de squeeze antérieures ne comptent
 *     PAS vers l'armement, out[i] reste undefined jusqu'à i=76 inclus.
 *   - i∈[100,107] : breakout haussier [102→134]. LIBÉRATION à i=102 (on 1→0),
 *     mom[102]≈+8.2>0, close 109 > max(spanA,spanB)≈100.1 (nuage plat du
 *     range) → ENTRÉE LONG @ 109.
 *   - i∈[108,112] : retournement [130→106] ; mom[111]≈−1.05<0 → SORTIE @ 110
 *     → PnL=(110−109)/109×100=+0.9174 % → « +0.92 % » en 9 bougies.
 *   - i∈[113,117] : transition 108→113, puis i∈[118,143] : range serré ~113
 *     en demi-span 0.4 (ATR bas → KC étroit) → squeeze re-ON de i=132 à 145
 *     (14 barres ≥ dureeMin=3 → armé).
 *   - i∈[144,150] : saut à 116 PLAT (le stdev capte le décalage de niveau
 *     pendant que l'ATR retombe → BB sort de KC) → LIBÉRATION à i=146 avec
 *     mom≈+2.5>0 MAIS close 116 STRICTEMENT DANS le nuage
 *     [spanA=113.17, spanB=116.85] → libération IGNORÉE, état 0.
 * Garde anti-tautologie : le cousin SANS kumo (`stratSqueezeBreakout`, mêmes
 * armement/libération) PREND la libération de i=146 — seul le filtre kumo
 * fait la différence. Comptes figés : 1 marqueur, 1 label, 1 segment.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { etatsStrategie } from "../utils-fabrique-strategie";
import { ttmSqueezeOf } from "../volatility/ttmSqueeze";
import { ichimokuOf } from "../trend/ichimoku";
import { CANDIDATS_CHAMPION } from "./candidatsChampion";
import { stratSqueezeKumo } from "./stratSqueezeKumo";
import "./stratSqueezeBreakout"; // enregistre le cousin pour la garde anti-tautologie

interface Barre {
  c: number;
  demiSpan: number;
}

function mkCandles(barres: Barre[]): Candle[] {
  return barres.map((b, i) => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: b.c, high: b.c + b.demiSpan, low: b.c - b.demiSpan, close: b.c, volume: 1,
  }));
}

const larges = (closes: number[]): Barre[] => closes.map((c) => ({ c, demiSpan: 1 }));
const serres = (closes: number[]): Barre[] => closes.map((c) => ({ c, demiSpan: 0.4 }));

const base = [100, 100.4, 99.8, 100.2, 99.9, 100.3, 100.0, 99.7, 100.1, 100.0];
const range1 = larges(Array.from({ length: 100 }, (_v, i) => base[i % 10]!));
const breakoutUp = larges([102, 105, 109, 114, 120, 126, 131, 134]);
const reversal = larges([130, 124, 116, 110, 106]);
const transition = larges([108, 110, 111, 112, 113]);
const base2 = [113, 113.2, 112.9, 113.1, 112.9, 113.2, 113.0, 112.8, 113.1, 113.0];
const range2 = serres(Array.from({ length: 26 }, (_v, i) => base2[i % 10]!));
const pop = serres([116, 116, 116, 116, 116, 116, 116]);
const barres = [...range1, ...breakoutUp, ...reversal, ...transition, ...range2, ...pop];
const candles = mkCandles(barres);

describe("stratSqueezeKumo", () => {
  it("contrat : strategy/overlay, « (non validé) » au nom, inputs propres + lignesTrades en dernier", () => {
    expect(stratSqueezeKumo.category).toBe("strategy");
    expect(stratSqueezeKumo.pane).toBe("overlay");
    expect(stratSqueezeKumo.name).toContain("(non validé)");
    expect(stratSqueezeKumo.inputs.map((i) => i.key)).toEqual([
      "sqzLength", "multBb", "multKc", "dureeMin", "tenkan", "kijun", "senkouB", "lignesTrades",
    ]);
  });

  it("ÉQUIVALENCE au candidat : défauts ({}) ≡ candSqueezeKumo.position, élément par élément", () => {
    const candidat = CANDIDATS_CHAMPION.find((c) => c.id === "candSqueezeKumo")!;
    const attendus = candidat.position(candles);
    const etats = etatsStrategie("stratSqueezeKumo", candles, {});
    expect(etats).toBeDefined();
    expect(etats).toHaveLength(candles.length);
    expect(etats).toEqual(attendus);

    // Non-vacuité : la fixture exerce bien les deux issues (le toEqual ne
    // prouverait rien sur une série toute plate ou toute undefined).
    expect(etats?.[102]).toBe(1); // libération PRISE (au-dessus du nuage)
    expect(etats?.[111]).toBe(0); // sortie au retournement du momentum
    expect(etats?.[146]).toBe(0); // libération IGNORÉE (dans le nuage)
    // Warm-up reproduit : avant la définition d'Ichimoku (i=77), `continue`
    // → undefined ; les bougies de squeeze antérieures ne comptent pas.
    expect(etats?.[76]).toBeUndefined();
    expect(etats?.[77]).toBe(0);
  });

  it("recomposition : libération PRISE au-dessus du nuage, IGNORÉE dans le nuage (le cousin sans kumo la prend)", () => {
    // Cœurs appelés directement (pas via la stratégie) pour prouver la fixture.
    const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
    const sqz = ttmSqueezeOf(candles, hlc3, 20, 2, 1.5);
    const ichi = ichimokuOf(candles, 9, 26, 52, 26); // déplacement = kijun (26)

    // Libération PRISE (i=102) : armée (squeeze ON ≥ 3 barres depuis la
    // définition d'Ichimoku à i=77), momentum haussier, close AU-DESSUS du nuage.
    for (let i = 77; i <= 101; i++) expect(sqz.on[i]).toBe(1);
    expect(sqz.on[102]).toBe(0);
    expect(sqz.mom[102]!).toBeGreaterThan(0);
    expect(Math.max(ichi.spanA[102]!, ichi.spanB[102]!)).toBeLessThan(109); // dessusNuage

    // Sortie (i=111) : retournement du momentum.
    expect(sqz.mom[110]!).toBeGreaterThan(0);
    expect(sqz.mom[111]!).toBeLessThan(0);

    // Libération IGNORÉE (i=146) : re-armée (ON de i=132 à 145 ≥ 3 barres),
    // momentum haussier, MAIS close 116 STRICTEMENT DANS le nuage.
    for (let i = 132; i <= 145; i++) expect(sqz.on[i]).toBe(1);
    expect(sqz.on[146]).toBe(0);
    expect(sqz.mom[146]!).toBeGreaterThan(0);
    expect(Math.min(ichi.spanA[146]!, ichi.spanB[146]!)).toBeLessThan(116); // ni sous...
    expect(Math.max(ichi.spanA[146]!, ichi.spanB[146]!)).toBeGreaterThan(116); // ...ni dessus

    // Garde anti-tautologie : le cousin SANS filtre kumo (mêmes conventions
    // d'armement) PREND cette libération — le filtre kumo fait seul l'écart.
    const sansKumo = etatsStrategie("stratSqueezeBreakout", candles, {
      length: 20, multBB: 2, multKC: 1.5, dureeMin: 3,
    });
    expect(sansKumo?.[102]).toBe(1); // prise par les deux (dessus du nuage)
    expect(sansKumo?.[146]).toBe(1); // prise par le cousin…
    const avecKumo = etatsStrategie("stratSqueezeKumo", candles, {});
    expect(avecKumo?.[146]).toBe(0); // …ignorée par le filtre kumo
  });

  it("aller-retour dérivé : long 109→110 (+0.92 %), annotations au littéral, rien sur la libération ignorée", () => {
    const res = computeIndicator(stratSqueezeKumo, candles, {});
    expect(res.annotations?.marqueurs).toEqual([
      { idx: 102, valeur: 108, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 109.00 — libération du squeeze (≥ 3 barres) momentum haussier, close au-dessus du nuage — stratégie non validée" },
    ]);
    expect(res.annotations?.labels).toEqual([
      { idx: 111, valeur: 111, texte: "+0.92 %", couleur: "--up", cible: "prix", position: "dessus",
        info: "Sortie long 110.00 (+0.92 %) — retournement du momentum — stratégie non validée" },
    ]);
    expect(res.annotations?.segments).toEqual([
      { deIdx: 102, deValeur: 109, aIdx: 111, aValeur: 110, trait: "pointille", couleur: "--up", cible: "prix",
        info: "Long 109.00 → 110.00, +0.92 % en 9 bougies (hors frais) — libération du squeeze (≥ 3 barres) momentum haussier, close au-dessus du nuage — stratégie non validée" },
    ]);
    // prixEntree : le prix d'entrée répété pendant la vie du trade, rien
    // ailleurs — en particulier RIEN autour de la libération ignorée (i=146).
    for (let i = 0; i < 102; i++) expect(res.series["prixEntree"]?.[i]).toBeUndefined();
    for (let i = 102; i <= 111; i++) expect(res.series["prixEntree"]?.[i]).toBe(109);
    for (let i = 112; i < candles.length; i++) expect(res.series["prixEntree"]?.[i]).toBeUndefined();
  });
});
