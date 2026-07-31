/**
 * @axiom/indicators — strategy/stratTripleConfirmation.test.ts
 *
 * NOUVELLE combinaison (spec v2.6 §B2, jamais mesurée) : pas de candidat de
 * référence pour une parité — la garantie passe donc entièrement par la
 * fixture dérivée + la recomposition contre les cœurs importés directement
 * (Supertrend/MACD/RSI en cascade ne sont pas traçables de tête).
 *
 * Fixture (n=57, défauts stPeriode 10, stMult 3, MACD 12/26/9, RSI 14/50) :
 * chop de 36 bougies (les trois voyants oscillent autour du neutre) puis
 * tendance haussière soutenue puis retournement appuyé — une rampe linéaire
 * seule ne produit ni croisement MACD ni bascule Supertrend ; ce profil-là
 * produit l'alignement complet PUIS sa dislocation en deux temps :
 *   i=33 : premier état DÉFINI (le signal MACD est le dernier cœur à se
 *     définir) — il vaut 1 (les trois alignés) mais la fabrique le
 *     matérialise EN SILENCE (pas de prix d'entrée connu) : aucun marqueur.
 *   i=34 : rechute du chop → MACD < signal ET RSI < 50 (direction toujours
 *     +1) → 0. Transition 1→0 SANS trade (aucune position ouverte).
 *   i=35 : les trois réalignés haussiers → ENTRÉE LONG @ close[35]=100.90
 *     (transition 0→1 entre deux états définis — le premier vrai trade).
 *   i∈[35,48] : alignement haussier tenu tout au long de la tendance.
 *   i=49 : la direction Supertrend bascule à −1 ALORS QUE MACD > signal ET
 *     RSI > 50 encore vrais → UN SEUL désaccord suffit : SORTIE LONG
 *     @ close[49]=143 → PnL=(143−100.9)/100.9×100=+41.7245…% → « +41.72 % ».
 *   i=50 : toujours un seul désaccord (Supertrend) → flat maintenu.
 *   i=51 : MACD < signal ET RSI < 50 rejoignent la direction −1 → ENTRÉE
 *     SHORT @ close[51]=112 (reste ouverte jusqu'à la fin).
 * Garde anti-tautologie : annotations comparées AU LITTÉRAL (2 marqueurs,
 * 1 label, 1 segment) + série prixEntree bougie par bougie (trou à i=50 :
 * flat entre les deux trades).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { etatsStrategie } from "../utils-fabrique-strategie";
import { closeOf } from "../utils";
import { rsiOf } from "../momentum/rsi";
import { macdOf } from "../trend/macd";
import { supertrendOf } from "../trend/supertrend";
import { stratTripleConfirmation } from "./stratTripleConfirmation";

const bruit = [0, 1, -0.8, 1.2, -0.6, 0.9, -1, 0.7, -0.9, 1.1];
const chop = Array.from({ length: 36 }, (_v, i) => 100 + (bruit[i % bruit.length] ?? 0));
const tendance = [101, 103.5, 107, 112, 118, 125, 133, 142, 152, 160, 167];
const retournement = [163, 155, 143, 128, 112, 100, 92, 86, 82, 80];
const closes = [...chop, ...tendance, ...retournement];
const candles: Candle[] = closes.map((c, i) => ({
  time: 1_700_000_000_000 + i * 3_600_000,
  open: c, high: c + 1.5, low: c - 1.5, close: c, volume: 1,
}));

describe("stratTripleConfirmation", () => {
  it("contrat : strategy/overlay, inputs propres + lignesTrades en dernier", () => {
    expect(stratTripleConfirmation.category).toBe("strategy");
    expect(stratTripleConfirmation.pane).toBe("overlay");
    expect(stratTripleConfirmation.inputs.map((i) => i.key)).toEqual([
      "stPeriode", "stMult", "macdRapide", "macdLente", "macdSignal", "rsiLength", "rsiNeutre", "lignesTrades",
    ]);
    const parDefaut = Object.fromEntries(stratTripleConfirmation.inputs.map((i) => [i.key, i.default]));
    expect(parDefaut.stPeriode).toBe(10);
    expect(parDefaut.stMult).toBe(3);
    expect(parDefaut.macdRapide).toBe(12);
    expect(parDefaut.macdLente).toBe(26);
    expect(parDefaut.macdSignal).toBe(9);
    expect(parDefaut.rsiLength).toBe(14);
    expect(parDefaut.rsiNeutre).toBe(50);
  });

  it("un seul désaccord → flat : Supertrend baissier seul contre MACD et RSI haussiers (i=49 et 50)", () => {
    // Recomposition indépendante : cœurs importés directement, pas via la stratégie.
    const st = supertrendOf(candles, 10, 3);
    const cl = closeOf(candles);
    const m = macdOf(cl, 12, 26, 9);
    const r = rsiOf(cl, 14);
    const etats = etatsStrategie("stratTripleConfirmation", candles, {});
    for (const i of [49, 50]) {
      // Les DEUX autres conditions long sont vraies...
      expect(m.macd[i]!).toBeGreaterThan(m.signal[i]!);
      expect(r[i]!).toBeGreaterThan(50);
      // ...seule la direction Supertrend diverge...
      expect(st.direction[i]).toBe(-1);
      // ...et un seul désaccord suffit : flat (ni maintien du long, ni short).
      expect(etats?.[i]).toBe(0);
    }
  });

  it("pin borne : RSI EXACTEMENT égal au seuil neutre = pas de confirmation (strict >, pas ≥)", () => {
    // rsiNeutre fixé À la valeur exacte du RSI en i=37 (≈57.33, dans les
    // bornes [30,70] de l'input — resolveParams clampe), où direction +1 et
    // MACD > signal sont vrais : l'égalité n'est ni > ni <, donc FLAT — la
    // règle est stricte des deux côtés, contrairement au filtre ADX des
    // promotions (≥ actif). Le contre-cas epsilon en dessous prouve aussi que
    // `rsiNeutre` est bien lu depuis les params (pas 50 en dur).
    const r = rsiOf(closeOf(candles), 14);
    const seuilPile = r[37]!;
    expect(seuilPile).toBeGreaterThan(30);
    expect(seuilPile).toBeLessThan(70);
    const etats = etatsStrategie("stratTripleConfirmation", candles, { rsiNeutre: seuilPile });
    expect(etats?.[37]).toBe(0); // RSI == seuil → confirmation manquante → flat
    const etatsEnDessous = etatsStrategie("stratTripleConfirmation", candles, { rsiNeutre: seuilPile - 1e-9 });
    expect(etatsEnDessous?.[37]).toBe(1); // un cheveu en dessous → les trois alignés
  });

  it("fixture chop→tendance→retournement : aller-retour dérivé (long 100.90→143, +41.72 %) puis short", () => {
    // Recomposition des points de bascule contre les cœurs (pas de tête) :
    const st = supertrendOf(candles, 10, 3);
    const cl = closeOf(candles);
    const m = macdOf(cl, 12, 26, 9);
    const r = rsiOf(cl, 14);
    // i=35 : les trois alignés haussiers → entrée.
    expect(st.direction[35]).toBe(1);
    expect(m.macd[35]!).toBeGreaterThan(m.signal[35]!);
    expect(r[35]!).toBeGreaterThan(50);
    // i=51 : les trois alignés baissiers → entrée short.
    expect(st.direction[51]).toBe(-1);
    expect(m.macd[51]!).toBeLessThan(m.signal[51]!);
    expect(r[51]!).toBeLessThan(50);
    // Premier état défini : i=33 (signal MACD, dernier cœur à se définir),
    // matérialisé en silence à 1, retombé à 0 en 34 — aucun trade avant 35.
    const etats = etatsStrategie("stratTripleConfirmation", candles, {});
    expect(etats!.findIndex((e) => e !== undefined)).toBe(33);
    expect(etats?.[33]).toBe(1);
    expect(etats?.[34]).toBe(0);
    expect(etats?.[35]).toBe(1);

    const res = computeIndicator(stratTripleConfirmation, candles, {});
    expect(res.annotations?.marqueurs).toEqual([
      { idx: 35, valeur: 99.4, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 100.90 — direction Supertrend haussière, MACD 12/26 > signal 9, RSI 14 > 50 — stratégie non validée" },
      { idx: 51, valeur: 113.5, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: "Entrée short 112.00 — direction Supertrend baissière, MACD 12/26 < signal 9, RSI 14 < 50 — stratégie non validée" },
    ]);
    expect(res.annotations?.labels).toEqual([
      { idx: 49, valeur: 144.5, texte: "+41.72 %", couleur: "--up", cible: "prix", position: "dessus",
        info: "Sortie long 143.00 (+41.72 %) — une des trois confirmations perdue (Supertrend, MACD ou RSI) — stratégie non validée" },
    ]);
    expect(res.annotations?.segments).toEqual([
      { deIdx: 35, deValeur: 100.9, aIdx: 49, aValeur: 143, trait: "pointille", couleur: "--up", cible: "prix",
        info: "Long 100.90 → 143.00, +41.72 % en 14 bougies (hors frais) — direction Supertrend haussière, MACD 12/26 > signal 9, RSI 14 > 50 — stratégie non validée" },
    ]);
    // prixEntree : rien avant 35 (dont l'état silencieux à 33), 100.9 du long
    // (entrée 35 → sortie 49), TROU à 50 (flat), 112 du short ouvert (51 → fin).
    for (let i = 0; i < 35; i++) expect(res.series["prixEntree"]?.[i]).toBeUndefined();
    for (let i = 35; i <= 49; i++) expect(res.series["prixEntree"]?.[i]).toBe(100.9);
    expect(res.series["prixEntree"]?.[50]).toBeUndefined();
    for (let i = 51; i < closes.length; i++) expect(res.series["prixEntree"]?.[i]).toBe(112);
  });
});
