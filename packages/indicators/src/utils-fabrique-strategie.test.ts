/**
 * @axiom/indicators — utils-fabrique-strategie.test.ts
 *
 * Fabrique testée avec une `position` INJECTÉE (tableau littéral) — la géométrie
 * des événements est ainsi dérivable à la main, indépendamment de tout oscillateur.
 *
 * Fixture principale (n=12, closes 100..99, highs=closes+1, lows=closes−1) :
 *   etats = [u, u, 1, 1, 1, 0, 0, -1, -1, 0, 1, 1]
 *   - i=2 : premier état défini (long) → MATÉRIALISATION SILENCIEUSE : aucun
 *     événement, aucun trade ouvert (pas de prix d'entrée connu).
 *   - i=5 : 1→0 : sortie SANS trade ouvert → ignorée (silencieuse).
 *   - i=7 : 0→−1 : ENTRÉE SHORT @ close[7]=103.
 *   - i=9 : −1→0 : SORTIE SHORT @ close[9]=101 → PnL = (101−103)/103×100×(−1)
 *     = +1.9417… → « +1.94 % » (gagnant, --up).
 *   - i=10 : 0→1 : ENTRÉE LONG @ close[10]=100 (i=10 = n−2, dernière transition
 *     admissible) → trade EN COURS.
 *   prixEntree attendu : [u,u,u,u,u,u,u, 103,103,103, 100,100].
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "./engine";
import {
  construireTradesStrategie,
  defStrategie,
  etatsStrategie,
  MAX_TRADES_ANNOTES,
  type EtatStrategie,
} from "./utils-fabrique-strategie";

const closes = [100, 101, 102, 103, 104, 105, 104, 103, 102, 101, 100, 99];
const candles: Candle[] = closes.map((c, i) => ({
  time: 1_700_000_000_000 + i * 60_000,
  open: c, high: c + 1, low: c - 1, close: c, volume: 1,
}));

const ETATS: Array<EtatStrategie | undefined> = [undefined, undefined, 1, 1, 1, 0, 0, -1, -1, 0, 1, 1];

function defAvec(etats: Array<EtatStrategie | undefined>) {
  return defStrategie({
    id: "stratTest",
    name: "Stratégie test",
    inputsStrategie: [],
    position: () => etats,
    libelles: () => ({ long: "règle long", short: "règle short", sortie: "règle sortie" }),
  });
}

describe("defStrategie", () => {
  it("contrat : category strategy, pane overlay, sortie prixEntree, input lignesTrades en dernier", () => {
    const def = defAvec(ETATS);
    expect(def.category).toBe("strategy");
    expect(def.pane).toBe("overlay");
    expect(def.outputs).toEqual([{ key: "prixEntree", name: "Prix d'entrée", style: "line" }]);
    expect(def.inputs.map((i) => i.key)).toEqual(["lignesTrades"]);
  });

  it("ordre des inputs : propres inputsStrategie AVANT lignesTrades (inputsStrategie non vide)", () => {
    const def = defStrategie({
      id: "stratTestOrdre",
      name: "Stratégie test ordre",
      inputsStrategie: [{ key: "x", name: "X", type: "number", default: 1 }],
      position: () => ETATS,
      libelles: () => ({ long: "règle long", short: "règle short", sortie: "règle sortie" }),
    });
    expect(def.inputs.map((i) => i.key)).toEqual(["x", "lignesTrades"]);
  });

  it("événements aux transitions : entrée short, sortie avec PnL, entrée long en cours", () => {
    const r = computeIndicator(defAvec(ETATS), candles);
    expect(r.annotations?.marqueurs).toEqual([
      { idx: 7, valeur: 104, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: "Entrée short 103.00 — règle short" },
      { idx: 10, valeur: 99, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 100.00 — règle long" },
    ]);
    expect(r.annotations?.labels).toEqual([
      { idx: 9, valeur: 100, texte: "+1.94 %", couleur: "--up", cible: "prix", position: "dessous",
        info: "Sortie short 101.00 (+1.94 %) — règle sortie" },
    ]);
    expect(r.annotations?.segments).toEqual([
      { deIdx: 7, deValeur: 103, aIdx: 9, aValeur: 101, trait: "pointille", couleur: "--up", cible: "prix",
        info: "Short 103.00 → 101.00, +1.94 % en 2 bougies (hors frais) — règle short" },
    ]);
    expect(r.series["prixEntree"]).toEqual(
      [undefined, undefined, undefined, undefined, undefined, undefined, undefined, 103, 103, 103, 100, 100]
    );
  });

  it("lignesTrades=false : pas de segments, marqueurs/labels conservés", () => {
    const r = computeIndicator(defAvec(ETATS), candles, { lignesTrades: false });
    expect(r.annotations?.segments).toBeUndefined();
    expect(r.annotations?.marqueurs?.length).toBe(2);
    expect(r.annotations?.labels?.length).toBe(1);
  });

  it("aucun événement sur la dernière bougie (transition à n−1 ignorée)", () => {
    const etats: Array<EtatStrategie | undefined> = new Array(12).fill(1);
    etats[11] = 0; // bascule sur la bougie potentiellement en formation
    const r = computeIndicator(defAvec(etats), candles);
    expect(r.annotations).toBeUndefined(); // matérialisation silencieuse + transition finale exclue
    expect(r.series["prixEntree"]).toEqual(new Array(12).fill(undefined)); // aucun trade réel ouvert
  });

  it("undefined au milieu = maintien (pas de sortie fantôme) : label de sortie LONG complet", () => {
    // entrée long i=1 @ close[1]=101 ; sortie long i=6 @ close[6]=104 (undefined en i=3 = maintien).
    // PnL = (104−101)/101×100 = +2.9702... → « +2.97 % » (gagnant, --up) ; label AU-DESSUS
    // (position "dessus", valeur = high[6] = 105) car sortie de LONG.
    const etats: Array<EtatStrategie | undefined> = [0, 1, 1, undefined, 1, 1, 0, 0, 0, 0, 0, 0];
    const r = computeIndicator(defAvec(etats), candles);
    expect(r.annotations?.marqueurs?.length).toBe(1); // une seule entrée (i=1)
    expect(r.annotations?.labels).toEqual([
      { idx: 6, valeur: 105, texte: "+2.97 %", couleur: "--up", cible: "prix", position: "dessus",
        info: "Sortie long 104.00 (+2.97 %) — règle sortie" },
    ]);
  });

  it("cap MAX_TRADES_ANNOTES : seuls les 60 derniers trades portent des annotations", () => {
    // 140 bougies, alternance 1/0 → un trade complet toutes les 2 bougies (~69 trades clos).
    const n = 140;
    const grands: Candle[] = Array.from({ length: n }, (_v, i) => ({
      time: 1_700_000_000_000 + i * 60_000, open: 100, high: 101, low: 99, close: 100, volume: 1,
    }));
    const etats: Array<EtatStrategie | undefined> = Array.from({ length: n }, (_v, i) => (i % 2 === 0 ? 1 : 0));
    const r = computeIndicator(defAvec(etats), grands);
    expect(r.annotations?.segments?.length).toBe(MAX_TRADES_ANNOTES);
    expect(r.annotations?.labels?.length).toBe(MAX_TRADES_ANNOTES);
  });

  it("construireTradesStrategie : mêmes trades que la fixture principale de la fabrique", () => {
    const { trades, ouvert } = construireTradesStrategie(candles, ETATS);
    expect(trades).toEqual([
      { sens: -1, idxEntree: 7, prixEntree: 103, idxSortie: 9, prixSortie: 101, pnlPct: expect.closeTo(1.9417, 3) },
    ]);
    expect(ouvert).toEqual({ sens: 1, idxEntree: 10, prixEntree: 100 });
  });

  it("construireTradesStrategie : fill-forward interne (undefined juste avant une transition réelle n'est pas manquée)", () => {
    // entrée long i=1 @ close[1]=101 ; i=2 undefined = maintien (effectif reste 1) ;
    // sortie long i=3 @ close[3]=103 (transition détectée grâce au fill-forward,
    // PAS à etats[2] brut qui est undefined). Sans fill-forward interne, cette
    // transition serait manquée et le trade resterait ouvert indéfiniment.
    const etats: Array<EtatStrategie | undefined> = [0, 1, undefined, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const { trades, ouvert } = construireTradesStrategie(candles, etats);
    expect(trades).toEqual([
      { sens: 1, idxEntree: 1, prixEntree: 101, idxSortie: 3, prixSortie: 103, pnlPct: expect.closeTo(1.9802, 3) },
    ]);
    expect(ouvert).toBeNull();
  });

  it("etatsStrategie : rejoue la position d'un def enregistré avec overrides", () => {
    defAvec(ETATS); // enregistre stratTest dans SPECS_STRATEGIES
    expect(etatsStrategie("stratTest", candles)).toEqual(ETATS);
    expect(etatsStrategie("defInconnu", candles)).toBeUndefined();
  });
});
