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
 *
 * Cas 3 (BAISSIÈRE régulière — l'autre famille, lue sur les sommets) :
 *   highs3 = [10, 11, 12, 11, 10, 11, 13, 12, 11, 10] → pivots high idx 2 (12),
 *            idx 6 (13) ; pivot low parasite idx 4 (10), seul → pas de paire haussière.
 *   lows3  = highs3 − 2 (même forme, même filtrage : son unique pivot low idx 4
 *            est seul → traiter(lows, "haussiere") ne produit RIEN).
 *   osc3   = [5, 6, 8, 7, 5, 6, 7, 6, 5, 4] → pivots high osc : idx 2 (8), idx 6 (7).
 *   Paire highs (2,6) : prix 13 > 12 (sommet plus haut) & osc 7 < 8 (en baisse)
 *   → BAISSIÈRE RÉGULIÈRE : couleur --down, label « Div ▼ » DESSUS le sommet.
 *
 * Cas 4 (pivots OSC DÉCALÉS de +2 barres des pivots PRIX, n=14) :
 *   lows4  = [12, 11, 10, 11, 12, 13, 12, 11, 9, 10, 11, 12, 13, 14]
 *            → pivots low idx 2 (10), idx 8 (9) ; pivot high parasite idx 5 (13), seul.
 *   highs4 = lows4 + 3 (même forme : unique pivot high idx 5, seul → aucune baissière).
 *   osc4   = [8, 7, 6.5, 6.2, 5, 6, 7, 8, 7.5, 7, 5.5, 6.5, 7.5, 8.5]
 *            → pivots low osc : idx 4 (5), idx 10 (5.5) — soit +2 barres après CHAQUE
 *            pivot prix, dans la fenêtre d'appariement ±3 (ECART_APPARIEMENT).
 *   Paire (2,8) : prix 9 < 10 (creux plus bas) & osc 5.5 > 5 (en hausse)
 *   → HAUSSIÈRE RÉGULIÈRE dont le segment cible "pane" relie 4→10 (les pivots OSC),
 *     PAS 2→8 (les pivots PRIX) : c'est la géométrie que ce cas verrouille.
 */
import { describe, expect, it } from "vitest";
import { construireAnnotationsDivergence } from "./utils-annotations";

const lows = [10, 9, 8, 9, 10, 9, 7, 8, 9, 10];
const highs = [12, 11, 10, 11, 12, 11, 9, 10, 11, 12];
const osc = [5, 4, 3, 4, 5, 4, 3.5, 4.5, 5, 5.5];

const lows2 = [10, 9, 8, 9, 10, 9.5, 8.5, 9.5, 10, 10.5];
const highs2 = lows2.map((v) => v + 2);
const osc2 = [5, 4, 3, 4, 5, 4, 2.5, 3.5, 4, 4.5];

const highs3 = [10, 11, 12, 11, 10, 11, 13, 12, 11, 10];
const lows3 = highs3.map((v) => v - 2);
const osc3 = [5, 6, 8, 7, 5, 6, 7, 6, 5, 4];

const lows4 = [12, 11, 10, 11, 12, 13, 12, 11, 9, 10, 11, 12, 13, 14];
const highs4 = lows4.map((v) => v + 3);
const osc4 = [8, 7, 6.5, 6.2, 5, 6, 7, 8, 7.5, 7, 5.5, 6.5, 7.5, 8.5];

const OPTS = { gauche: 2, droite: 2, maxEcart: 60, cachees: true, nomOsc: "OSC" };

const INFO_REG =
  "Divergence haussière régulière — prix 8.00 → 7.00 (creux plus bas) vs OSC 3.00 → 3.50 (en hausse)";
const INFO_CACHEE =
  "Divergence haussière cachée — prix 8.00 → 8.50 (creux plus haut) vs OSC 3.00 → 2.50 (en baisse)";
const INFO_BAISS =
  "Divergence baissière régulière — prix 12.00 → 13.00 (sommet plus haut) vs OSC 8.00 → 7.00 (en baisse)";
const INFO_DECALE =
  "Divergence haussière régulière — prix 10.00 → 9.00 (creux plus bas) vs OSC 5.00 → 5.50 (en hausse)";

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

  it("baissière : lue sur les HIGHS, couleur --down, label « Div ▼ » DESSUS", () => {
    const a = construireAnnotationsDivergence(highs3, lows3, osc3, OPTS);
    expect(a.segments).toEqual([
      { deIdx: 2, deValeur: 12, aIdx: 6, aValeur: 13, trait: "plein", couleur: "--down", cible: "prix", info: INFO_BAISS },
      { deIdx: 2, deValeur: 8, aIdx: 6, aValeur: 7, trait: "plein", couleur: "--down", cible: "pane", info: INFO_BAISS },
    ]);
    expect(a.labels).toEqual([
      { idx: 6, valeur: 13, texte: "Div ▼", couleur: "--down", cible: "prix", position: "dessus", info: INFO_BAISS },
    ]);
    // Le libellé du mouvement de prix distingue une baissière RÉGULIÈRE (sommet plus
    // haut) d'une cachée (sommet plus bas) — il fait partie du contrat du tooltip.
    expect(INFO_BAISS).toContain("sommet plus haut");
  });

  it("pivots osc DÉCALÉS (+2) : le segment pane relie les index OSC, pas les index PRIX", () => {
    const a = construireAnnotationsDivergence(highs4, lows4, osc4, OPTS);
    // Pivots PRIX en 2 → 8, pivots OSC en 4 → 10 : substituer idxFrom/idxTo à
    // oscIdxFrom/oscIdxTo (segment pane tracé en 2→8) ferait échouer CE cas.
    expect(a.segments).toEqual([
      { deIdx: 2, deValeur: 10, aIdx: 8, aValeur: 9, trait: "plein", couleur: "--up", cible: "prix", info: INFO_DECALE },
      { deIdx: 4, deValeur: 5, aIdx: 10, aValeur: 5.5, trait: "plein", couleur: "--up", cible: "pane", info: INFO_DECALE },
    ]);
    expect(a.labels).toEqual([
      { idx: 8, valeur: 9, texte: "Div ▲", couleur: "--up", cible: "prix", position: "dessous", info: INFO_DECALE },
    ]);
  });

  it("cachees=false : les divergences cachées ne produisent RIEN", () => {
    const a = construireAnnotationsDivergence(highs2, lows2, osc2, { ...OPTS, cachees: false });
    expect(a).toStrictEqual({});
  });

  it("série plate : aucune annotation (objet vide, pas de clés)", () => {
    const plat = new Array<number>(10).fill(5);
    expect(construireAnnotationsDivergence(plat, plat, plat, OPTS)).toStrictEqual({});
  });
});
