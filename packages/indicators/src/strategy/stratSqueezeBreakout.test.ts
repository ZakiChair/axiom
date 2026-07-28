/**
 * @axiom/indicators — strategy/stratSqueezeBreakout.test.ts
 *
 * `on`/`mom` (sma/stdev/ema/rma en cascade) ne sont pas traçables de tête :
 * recomposés en appelant `ttmSqueezeOf` (le cœur) directement dans le test,
 * PUIS l'état armement/libération/sortie est dérivé À LA MAIN depuis ces
 * valeurs concrètes (length=5, dureeMin=3) :
 *   closes = [100,100.5,99.8,100.3,99.9,100.4,100,99.7,100.2,100.1, 102,106,112,120, 116,108,98,88,80]
 *   (10 bougies serrées « squeeze » + 4 de breakout haussier + 5 de retournement baissier — n=19)
 *   i∈[4,10] : on=1 (squeeze actif) → dureeOn atteint 3 dès i=6 → armé.
 *   i=11 : on bascule à 0 (libération), armé et mom[11]≈+4.4>0 → ENTRÉE LONG @ close[11]=106.
 *   i∈[12,14] : mom reste positif → 1 maintenu.
 *   i=15 : mom[15]≈−4.4<0 (retournement) → SORTIE LONG @ close[15]=108
 *          → PnL=(108−106)/106×100=+1.8867…% → « +1.89 % ».
 *   i∈[16,18] : flat (aucun ré-armement, mom négatif mais plus de squeeze ON).
 * Garde anti-tautologie : comptes figés (1 marqueur, 1 label) lus sur cette fixture.
 *
 * Pin dédié : une libération SANS armement (durée < dureeMin) ne doit RIEN
 * déclencher, même si le momentum au relâchement est net — fixture minimale
 * où le squeeze ne reste ON que 2 bougies (i=4,5, dureeOn max=2 < dureeMin=3)
 * avant une libération à fort momentum haussier (mom[6]≈+3.1) : aucune
 * annotation ne doit apparaître sur toute la série.
 *
 * Pin borne : durée EXACTEMENT égale à dureeMin (3 bougies ON) arme bel et
 * bien — distingue `dureeOn >= dureeMin` (armé) de `dureeOn > dureeMin`
 * (armerait seulement à la 4e bougie, un off-by-one plausible).
 *
 * Jambe SHORT : miroir exact du round-trip long (même serré, cassure baissière
 * puis retournement haussier) — le round-trip principal ci-dessus n'exerce
 * QUE la branche `mom > 0` (long) ; sans cette jambe, un bug isolé à la
 * branche `mom < 0` (armement short) ou à la sortie `etat === -1 && mom > 0`
 * passerait inaperçu.
 *   closes = [100,100.5,99.8,100.3,99.9,100.4,100,99.7,100.2,100.1, 98,94,88,80, 84,92,102,112,120]
 *   i∈[4,10] : on=1 (squeeze actif, dureeOn atteint 3 dès i=6 → armé).
 *   i=11 : libération, mom[11]≈−4.4<0 → ENTRÉE SHORT @ close[11]=94.
 *   i=15 : mom[15]≈+4.4>0 (retournement) → SORTIE SHORT @ close[15]=92
 *          → PnL=(92−94)/94×100×(−1)=+2.1276…% → « +2.13 % ».
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { etatsStrategie } from "../utils-fabrique-strategie";
import { ttmSqueezeOf } from "../volatility/ttmSqueeze";
import { stratSqueezeBreakout } from "./stratSqueezeBreakout";

function mkCandles(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: c, high: c + 1, low: c - 1, close: c, volume: 1,
  }));
}

const tight = [100, 100.5, 99.8, 100.3, 99.9, 100.4, 100.0, 99.7, 100.2, 100.1];
const breakoutUp = [102, 106, 112, 120];
const reversalDown = [116, 108, 98, 88, 80];
const closes = [...tight, ...breakoutUp, ...reversalDown];
const candles = mkCandles(closes);
const PARAMS = { length: 5, multBB: 2, multKC: 1.5, dureeMin: 3 };

describe("stratSqueezeBreakout", () => {
  it("contrat : strategy/overlay, inputs propres + lignesTrades en dernier", () => {
    expect(stratSqueezeBreakout.category).toBe("strategy");
    expect(stratSqueezeBreakout.pane).toBe("overlay");
    expect(stratSqueezeBreakout.inputs.map((i) => i.key)).toEqual([
      "length", "multBB", "multKC", "dureeMin", "lignesTrades",
    ]);
  });

  it("fixture squeeze → breakout → retournement : armement recomposé via ttmSqueezeOf importé", () => {
    // Recomposition indépendante : le cœur est appelé directement (pas via la
    // stratégie) pour prouver la fixture — confirme que le squeeze est bien
    // actif ≥ dureeMin bougies avant la libération, et le SIGNE du momentum
    // à chaque point-clé, sans dépendre de l'implémentation de `position`.
    const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
    const r = ttmSqueezeOf(candles, hlc3, PARAMS.length, PARAMS.multBB, PARAMS.multKC);
    for (let i = 4; i <= 10; i++) expect(r.on[i]).toBe(1); // squeeze actif ≥ dureeMin bougies
    for (let i = 11; i <= 18; i++) expect(r.on[i]).toBe(0); // libéré jusqu'à la fin
    expect(r.mom[11]).toBeGreaterThan(0); // libération : momentum haussier
    expect(r.mom[15]).toBeLessThan(0); // retournement du momentum

    const res = computeIndicator(stratSqueezeBreakout, candles, PARAMS);
    expect(res.annotations?.marqueurs).toEqual([
      { idx: 11, valeur: 105, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 106.00 — libération du squeeze (≥ 3 barres) momentum haussier" },
    ]);
    expect(res.annotations?.labels).toEqual([
      { idx: 15, valeur: 109, texte: "+1.89 %", couleur: "--up", cible: "prix", position: "dessus",
        info: "Sortie long 108.00 (+1.89 %) — retournement du momentum" },
    ]);
    expect(res.annotations?.segments).toEqual([
      { deIdx: 11, deValeur: 106, aIdx: 15, aValeur: 108, trait: "pointille", couleur: "--up", cible: "prix",
        info: "Long 106.00 → 108.00, +1.89 % en 4 bougies (hors frais) — libération du squeeze (≥ 3 barres) momentum haussier" },
    ]);
    expect(res.series["prixEntree"]).toEqual([
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, 106, 106, 106, 106, 106, undefined, undefined, undefined,
    ]);
  });

  it("pin : libération SANS armement (durée < dureeMin) ne déclenche RIEN", () => {
    const closesCourt = [100, 100.5, 99.8, 100.3, 99.9, 100.4, 112, 122, 130];
    const candlesCourt = mkCandles(closesCourt);
    const hlc3 = candlesCourt.map((c) => (c.high + c.low + c.close) / 3);
    const r = ttmSqueezeOf(candlesCourt, hlc3, PARAMS.length, PARAMS.multBB, PARAMS.multKC);
    // Le squeeze n'est actif QUE 2 bougies (< dureeMin=3) avant de se libérer
    // avec un momentum net — un armement bugué déclencherait quand même ici.
    expect(r.on[4]).toBe(1);
    expect(r.on[5]).toBe(1);
    expect(r.on[6]).toBe(0);
    expect(r.mom[6]).toBeGreaterThan(0);

    const res = computeIndicator(stratSqueezeBreakout, candlesCourt, PARAMS);
    expect(res.annotations).toBeUndefined();
    expect(res.series["prixEntree"]).toEqual(new Array(closesCourt.length).fill(undefined));
  });

  it("pin : durée EXACTEMENT dureeMin arme bien (borne stricte : ≥, pas >)", () => {
    // Même construction que le pin ci-dessus mais avec UNE bougie de squeeze
    // en plus (3 = dureeMin pile) — distingue `dureeOn >= dureeMin` (arme) de
    // `dureeOn > dureeMin` (n'armerait qu'à la 4e bougie).
    const closesPile = [100, 100.5, 99.8, 100.3, 99.9, 100.4, 104, 110, 116];
    const candlesPile = mkCandles(closesPile);
    const hlc3 = candlesPile.map((c) => (c.high + c.low + c.close) / 3);
    const r = ttmSqueezeOf(candlesPile, hlc3, PARAMS.length, PARAMS.multBB, PARAMS.multKC);
    expect(r.on[4]).toBe(1);
    expect(r.on[5]).toBe(1);
    expect(r.on[6]).toBe(1); // 3e bougie ON = dureeMin pile
    expect(r.on[7]).toBe(0); // libération
    expect(r.mom[7]).toBeGreaterThan(0);

    const etats = etatsStrategie("stratSqueezeBreakout", candlesPile, PARAMS);
    expect(etats?.[7]).toBe(1); // armé dès la 3e bougie, entrée à la libération
  });

  it("fixture miroir SHORT : squeeze → cassure baissière → retournement haussier", () => {
    const breakdownDown = [98, 94, 88, 80];
    const reversalUp = [84, 92, 102, 112, 120];
    const closesShort = [...tight, ...breakdownDown, ...reversalUp];
    const candlesShort = mkCandles(closesShort);

    const hlc3 = candlesShort.map((c) => (c.high + c.low + c.close) / 3);
    const r = ttmSqueezeOf(candlesShort, hlc3, PARAMS.length, PARAMS.multBB, PARAMS.multKC);
    for (let i = 4; i <= 10; i++) expect(r.on[i]).toBe(1); // squeeze actif ≥ dureeMin bougies
    for (let i = 11; i <= 18; i++) expect(r.on[i]).toBe(0); // libéré jusqu'à la fin
    expect(r.mom[11]).toBeLessThan(0); // libération : momentum baissier
    expect(r.mom[15]).toBeGreaterThan(0); // retournement du momentum

    const res = computeIndicator(stratSqueezeBreakout, candlesShort, PARAMS);
    expect(res.annotations?.marqueurs).toEqual([
      { idx: 11, valeur: 95, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: "Entrée short 94.00 — libération du squeeze (≥ 3 barres) momentum baissier" },
    ]);
    expect(res.annotations?.labels).toEqual([
      { idx: 15, valeur: 91, texte: "+2.13 %", couleur: "--up", cible: "prix", position: "dessous",
        info: "Sortie short 92.00 (+2.13 %) — retournement du momentum" },
    ]);
    expect(res.annotations?.segments).toEqual([
      { deIdx: 11, deValeur: 94, aIdx: 15, aValeur: 92, trait: "pointille", couleur: "--up", cible: "prix",
        info: "Short 94.00 → 92.00, +2.13 % en 4 bougies (hors frais) — libération du squeeze (≥ 3 barres) momentum baissier" },
    ]);
    expect(res.series["prixEntree"]).toEqual([
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, 94, 94, 94, 94, 94, undefined, undefined, undefined,
    ]);
  });
});
