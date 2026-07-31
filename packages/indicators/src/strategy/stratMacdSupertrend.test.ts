/**
 * @axiom/indicators — strategy/stratMacdSupertrend.test.ts
 *
 * `stratMacdSupertrend` est une recopie PARAMÉTRÉE de `positionMacdSupertrend`
 * (candidat `candMacdSupertrend`, `candidatsChampion.ts`) : mêmes cœurs
 * (macdOf sur closes, supertrendOf), même règle, mêmes défauts (12/26/9,
 * Supertrend 10 ×3). La garantie la plus forte est donc la PARITÉ stricte
 * avec la référence figée : sur la fixture 400 bougies en cinq régimes de
 * `stratChampion.test.ts` (dents de scie → compression → tendance haussière →
 * tendance baissière → compression → reprise baissière — riche en croisements
 * MACD et en bascules Supertrend), `stratMacdSupertrend` aux défauts doit
 * produire EXACTEMENT la même série d'états, bougie par bougie, que le
 * candidat. Garde anti-tautologie : faits figés lus sur cette fixture (1er
 * état défini à 33, 28 transitions, les 3 états tous présents — l'égalité de
 * deux séries vides passerait sinon).
 *
 * Pin de désaccord (la raison d'être du def vs `stratMacdCross` nu) : à
 * l'idx 280 de cette fixture, le MACD recompose HAUSSIER (macd > signal)
 * pendant que le Supertrend recompose BAISSIER (direction −1) — cœurs
 * importés directement, pas via la stratégie — et la position est 0, pas 1.
 *
 * Fixture dérivée (aller-retour complet, params réduits macdRapide 3,
 * macdLente 6, macdSignal 3, stPeriode 3, stMult 1 — dérivée empiriquement
 * AVANT d'être figée) : 10 bougies PLATES à 100 (EMA de constante = 100
 * exactement → MACD ≡ signal ≡ 0, ni > ni < → flat 0 dès que le signal se
 * définit à i=7 ; 1er état silencieux) puis montée 104→120 :
 *   i=10 : MACD > signal ET Supertrend haussier → ENTRÉE LONG @ close[10]=104.
 *   i=15 : repli doux (119) — MACD (3.663) encore > signal (3.605) → long tenu.
 *   i=16 : MACD (2.710) < signal (3.158) mais Supertrend ENCORE haussier →
 *     DÉSACCORD → SORTIE LONG @ close[16]=118 ; PnL = (118−104)/104×100
 *     = +13.4615… % → « +13.46 % ». Pas de short : c'est le flat de désaccord.
 *   i=18 : krach (100) — Supertrend bascule baissier ET MACD < signal →
 *     ENTRÉE SHORT @ close[18]=100 (reste ouverte : marqueur sans label).
 * Queue de 2 bougies (88, 86) pour garder i=18 dans la fenêtre anti-repaint
 * [1, n−2]. Comptes figés : 2 marqueurs, 1 label, 1 segment.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { etatsStrategie } from "../utils-fabrique-strategie";
import { closeOf } from "../utils";
import { macdOf } from "../trend/macd";
import { supertrendOf } from "../trend/supertrend";
import { CANDIDATS_CHAMPION } from "./candidatsChampion";
import { stratMacdSupertrend } from "./stratMacdSupertrend";

/**
 * Fixture IDENTIQUE à `stratChampion.test.ts` (cinq régimes enchaînés).
 * Reprise volontaire : déjà exercée là-bas, riche en croisements multiples
 * pour les deux cœurs — pas une nouvelle donnée à re-prouver ici.
 */
function fixture(): Candle[] {
  const out: Candle[] = [];
  let prix = 100;
  for (let i = 0; i < 400; i++) {
    let pas: number;
    let amp: number;
    if (i < 80) {
      pas = (i % 4 < 2 ? 1 : -1) * 1.5;
      amp = 0.8;
    } else if (i < 120) {
      pas = i % 2 === 0 ? 0.06 : -0.05;
      amp = 0.12;
    } else if (i < 200) {
      pas = 1.8 + (i % 3) * 0.3;
      amp = 2.0;
    } else if (i < 280) {
      pas = -(1.0 + (i % 3) * 0.2);
      amp = 1.4;
    } else if (i < 320) {
      pas = i % 2 === 0 ? 0.06 : -0.05;
      amp = 0.12;
    } else {
      pas = -(1.0 + (i % 3) * 0.2);
      amp = 1.4;
    }
    const open = prix;
    const close = prix + pas;
    out.push({
      time: 1_700_000_000_000 + i * 3_600_000,
      open,
      high: Math.max(open, close) + amp,
      low: Math.min(open, close) - amp,
      close,
      volume: 10 + (i % 7),
    });
    prix = close;
  }
  return out;
}

const CANDLES = fixture();

describe("stratMacdSupertrend", () => {
  it("contrat : strategy/overlay, inputs propres (défauts de la campagne) + lignesTrades en dernier", () => {
    expect(stratMacdSupertrend.category).toBe("strategy");
    expect(stratMacdSupertrend.pane).toBe("overlay");
    expect(stratMacdSupertrend.inputs.map((i) => i.key)).toEqual([
      "macdRapide", "macdLente", "macdSignal", "stPeriode", "stMult", "lignesTrades",
    ]);
    const parDefaut = Object.fromEntries(stratMacdSupertrend.inputs.map((i) => [i.key, i.default]));
    expect(parDefaut.macdRapide).toBe(12);
    expect(parDefaut.macdLente).toBe(26);
    expect(parDefaut.macdSignal).toBe(9);
    expect(parDefaut.stPeriode).toBe(10);
    expect(parDefaut.stMult).toBe(3);
  });

  it("avec les défauts de la campagne, reproduit EXACTEMENT candMacdSupertrend bougie par bougie", () => {
    const candidat = CANDIDATS_CHAMPION.find((c) => c.id === "candMacdSupertrend");
    expect(candidat).toBeDefined();
    const etatsCandidat = candidat!.position(CANDLES);
    const etatsDef = etatsStrategie("stratMacdSupertrend", CANDLES, {});
    expect(etatsDef).toEqual(etatsCandidat);

    // Garde anti-tautologie : la série comparée n'est PAS triviale — faits
    // figés lus sur cette fixture (une égalité de deux séries vides ou
    // constantes passerait sans eux).
    expect(etatsDef!.findIndex((e) => e !== undefined)).toBe(33);
    const comptes = { "1": 0, "0": 0, "-1": 0 };
    const transitions: string[] = [];
    for (let i = 0; i < etatsDef!.length; i++) {
      const cur = etatsDef![i];
      if (cur !== undefined) comptes[String(cur) as keyof typeof comptes]++;
      const prev = etatsDef![i - 1];
      if (i > 0 && prev !== undefined && cur !== undefined && prev !== cur) {
        transitions.push(`${i}:${prev}->${cur}`);
      }
    }
    expect(comptes).toEqual({ "1": 131, "0": 93, "-1": 143 });
    expect(transitions.length).toBe(28);
    // Les 4 transitions « macro » de la fin (sortie de tendance haussière,
    // entrée short, désaccord de compression, reprise short) :
    expect(transitions.slice(-4)).toEqual(["200:1->0", "215:0->-1", "280:-1->0", "322:0->-1"]);
  });

  it("pin de désaccord : MACD haussier avec Supertrend baissier → 0 (recomposé contre les cœurs)", () => {
    // Recomposition indépendante à l'idx 280 : cœurs importés directement,
    // pas via la stratégie — MACD(12/26/9) sur closes, Supertrend(10, ×3).
    const closes = closeOf(CANDLES);
    const m = macdOf(closes, 12, 26, 9);
    const st = supertrendOf(CANDLES, 10, 3);
    // Le MACD y est bien HAUSSIER (macd > signal)...
    expect(m.macd[280]!).toBeGreaterThan(m.signal[280]!);
    // ...pendant que le Supertrend y est bien BAISSIER — sans le régime
    // Supertrend, l'état serait donc 1 (celui de stratMacdCross nu), pas 0.
    expect(st.direction[280]).toBe(-1);

    const etats = etatsStrategie("stratMacdSupertrend", CANDLES, {});
    expect(etats?.[280]).toBe(0);
  });

  it("fixture dérivée plat→montée→repli→krach : aller-retour long 104→118 (+13.46 %) puis short ouvert", () => {
    // Dérivation documentée dans le docblock du fichier ; PnL dérivé des
    // closes : (118 − 104) / 104 × 100 = +13.4615… % → « +13.46 % ».
    const closes = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 104, 108, 112, 116, 120, 119, 118, 117.5, 100, 90, 88, 86];
    const candles: Candle[] = closes.map((c, i) => ({
      time: 1_700_000_000_000 + i * 3_600_000,
      open: c, high: c + 1.5, low: c - 1.5, close: c, volume: 1,
    }));
    const PARAMS = { macdRapide: 3, macdLente: 6, macdSignal: 3, stPeriode: 3, stMult: 1 };

    // États bruts AU LITTÉRAL : chop plat (MACD ≡ signal → 0, 1er état
    // silencieux à 7), long [10,15], flat de désaccord [16,17], short [18,21].
    expect(etatsStrategie("stratMacdSupertrend", candles, PARAMS)).toEqual([
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, -1, -1, -1, -1,
    ]);

    const r = computeIndicator(stratMacdSupertrend, candles, PARAMS);
    expect(r.annotations?.marqueurs).toEqual([
      { idx: 10, valeur: 102.5, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 104.00 — MACD(3/6/3) > signal, Supertrend(3, ×1) haussier — stratégie non validée" },
      { idx: 18, valeur: 101.5, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: "Entrée short 100.00 — MACD(3/6/3) < signal, Supertrend(3, ×1) baissier — stratégie non validée" },
    ]);
    expect(r.annotations?.labels).toEqual([
      { idx: 16, valeur: 119.5, texte: "+13.46 %", couleur: "--up", cible: "prix", position: "dessus",
        info: "Sortie long 118.00 (+13.46 %) — désaccord MACD/Supertrend (flat) ou bascule inverse — stratégie non validée" },
    ]);
    expect(r.annotations?.segments).toEqual([
      { deIdx: 10, deValeur: 104, aIdx: 16, aValeur: 118, trait: "pointille", couleur: "--up", cible: "prix",
        info: "Long 104.00 → 118.00, +13.46 % en 6 bougies (hors frais) — MACD(3/6/3) > signal, Supertrend(3, ×1) haussier — stratégie non validée" },
    ]);
    // prixEntree : 104 tant que le long vit [10,16], trou pendant le flat de
    // désaccord (17), 100 pour le short ouvert [18, fin].
    for (let i = 0; i < 10; i++) expect(r.series["prixEntree"]?.[i]).toBeUndefined();
    for (let i = 10; i <= 16; i++) expect(r.series["prixEntree"]?.[i]).toBe(104);
    expect(r.series["prixEntree"]?.[17]).toBeUndefined();
    for (let i = 18; i < closes.length; i++) expect(r.series["prixEntree"]?.[i]).toBe(100);
  });
});
