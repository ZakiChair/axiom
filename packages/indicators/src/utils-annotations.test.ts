/**
 * @axiom/indicators — utils-annotations.test.ts
 *
 * Dérivation à la main (gauche=2, droite=2, maxEcart=60), fixtures courtes (n=10) :
 *
 * Cas 1 (régulière) :
 *   lows  = [10, 9, 8, 9, 10, 9, 7, 8, 9, 10]  → pivots low : idx 2 (8), idx 6 (7) ;
 *           pivot high parasite idx 4 (10), seul → aucune paire baissière sur cette série.
 *   highs = [12, 11, 10, 11, 12, 11, 9, 10, 11, 12] → pivot high idx 4 (12) seul →
 *           aucune paire baissière ; ses pivots low (idx 2/6) donnent une famille
 *           haussière FILTRÉE (une baissière se lit sur les sommets uniquement).
 *   osc   = [5, 4, 3, 4, 5, 4, 3.5, 4.5, 5, 5.5] → pivots low osc : idx 2 (3), idx 6 (3.5).
 *   Paire lows (2,6) : prix 7 < 8 (creux plus bas) & osc 3.5 > 3 (en hausse)
 *   → HAUSSIÈRE RÉGULIÈRE, oscIdxFrom=2, oscIdxTo=6.
 *
 * Cas 2 (cachée) :
 *   lows2 = [10, 9, 8, 9, 10, 9.5, 8.5, 9.5, 10, 10.5] → pivots low idx 2 (8), idx 6 (8.5).
 *   highs2 = lows2 + 2 (même forme, même filtrage).
 *   osc2  = [5, 4, 3, 4, 5, 4, 2.5, 3.5, 4, 4.5] → pivots low idx 2 (3), idx 6 (2.5).
 *   Paire (2,6) : prix 8.5 > 8 (creux plus haut) & osc 2.5 < 3 (en baisse)
 *   → HAUSSIÈRE CACHÉE : segments pointillés, PAS de label.
 */
import { describe, expect, it } from "vitest";
import { construireAnnotationsDivergence } from "./utils-annotations";

const lows = [10, 9, 8, 9, 10, 9, 7, 8, 9, 10];
const highs = [12, 11, 10, 11, 12, 11, 9, 10, 11, 12];
const osc = [5, 4, 3, 4, 5, 4, 3.5, 4.5, 5, 5.5];

const lows2 = [10, 9, 8, 9, 10, 9.5, 8.5, 9.5, 10, 10.5];
const highs2 = lows2.map((v) => v + 2);
const osc2 = [5, 4, 3, 4, 5, 4, 2.5, 3.5, 4, 4.5];

const OPTS = { gauche: 2, droite: 2, maxEcart: 60, cachees: true, nomOsc: "OSC" };

const INFO_REG =
  "Divergence haussière régulière — prix 8.00 → 7.00 (creux plus bas) vs OSC 3.00 → 3.50 (en hausse)";
const INFO_CACHEE =
  "Divergence haussière cachée — prix 8.00 → 8.50 (creux plus haut) vs OSC 3.00 → 2.50 (en baisse)";

describe("construireAnnotationsDivergence", () => {
  it("régulière : segment prix + segment pane (pivots osc) + label dessous, info partagée", () => {
    const a = construireAnnotationsDivergence(highs, lows, osc, OPTS);
    expect(a.segments).toEqual([
      { deIdx: 2, deValeur: 8, aIdx: 6, aValeur: 7, trait: "plein", couleur: "--up", cible: "prix", info: INFO_REG },
      { deIdx: 2, deValeur: 3, aIdx: 6, aValeur: 3.5, trait: "plein", couleur: "--up", cible: "pane", info: INFO_REG },
    ]);
    expect(a.labels).toEqual([
      { idx: 6, valeur: 7, texte: "Div ▲", couleur: "--up", cible: "prix", position: "dessous", info: INFO_REG },
    ]);
    expect(a.marqueurs).toBeUndefined();
    expect(a.rubans).toBeUndefined();
  });

  it("cachée : segments pointillés, AUCUN label (anti-encombrement)", () => {
    const a = construireAnnotationsDivergence(highs2, lows2, osc2, OPTS);
    expect(a.segments).toEqual([
      { deIdx: 2, deValeur: 8, aIdx: 6, aValeur: 8.5, trait: "pointille", couleur: "--up", cible: "prix", info: INFO_CACHEE },
      { deIdx: 2, deValeur: 3, aIdx: 6, aValeur: 2.5, trait: "pointille", couleur: "--up", cible: "pane", info: INFO_CACHEE },
    ]);
    expect(a.labels).toBeUndefined();
  });

  it("cachees=false : les divergences cachées ne produisent RIEN", () => {
    const a = construireAnnotationsDivergence(highs2, lows2, osc2, { ...OPTS, cachees: false });
    expect(a).toEqual({});
  });

  it("série plate : aucune annotation (objet vide, pas de clés)", () => {
    const plat = new Array<number>(10).fill(5);
    expect(construireAnnotationsDivergence(plat, plat, plat, OPTS)).toEqual({});
  });
});
