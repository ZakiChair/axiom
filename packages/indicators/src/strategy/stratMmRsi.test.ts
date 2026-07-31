/**
 * @axiom/indicators — strategy/stratMmRsi.test.ts
 *
 * `stratMmRsi` est une recopie PARAMÉTRÉE de `positionMmRsi` (candidat
 * `candMmRsi`, `candidatsChampion.ts`) : mêmes cœurs (ema et rsiOf sur
 * closes), même règle, mêmes défauts (EMA 9/21, RSI 14, neutre 50). La
 * garantie la plus forte est donc la PARITÉ stricte avec la référence figée :
 * sur la fixture 400 bougies en cinq régimes de `stratChampion.test.ts`
 * (riche en croisements EMA et en allers-retours du RSI autour de 50 — 64
 * transitions, le sur-trading mesuré en campagne se voit jusque dans la
 * fixture), `stratMmRsi` aux défauts doit produire EXACTEMENT la même série
 * d'états, bougie par bougie, que le candidat. Garde anti-tautologie : faits
 * figés lus sur cette fixture (1er état défini à 20, 64 transitions, les 3
 * états tous présents — l'égalité de deux séries vides passerait sinon).
 *
 * Pin de désaccord (la raison d'être du def vs `stratCroisementMM` nu) : à
 * l'idx 213 de cette fixture, les EMA recomposent HAUSSIER (EMA 9 > EMA 21)
 * pendant que le RSI recompose SOUS le neutre (RSI(14) < 50) — cœurs
 * importés directement, pas via la stratégie — et la position est 0, pas 1.
 *
 * Fixture dérivée (aller-retour complet, params réduits rapide 3, lente 5,
 * rsiLength 5, rsiNeutre 50 — dérivée empiriquement AVANT d'être figée) :
 * 8 bougies PLATES à 100 (EMA de constante = 100 exactement → EMA 3 ≡ EMA 5,
 * ni > ni < → flat 0 dès que le RSI se définit à i=5 ; 1er état silencieux)
 * puis montée 104→120 et chute 118→90 :
 *   i=8 : EMA 3 (102.00) > EMA 5 (101.33) ET RSI (100, aucune baisse) > 50 →
 *     ENTRÉE LONG @ close[8]=104.
 *   i=14 : close 114 — EMA 3 (115.53) encore > EMA 5 (114.47), RSI 60.58
 *     encore > 50 → long tenu.
 *   i=15 : close 108 — EMA 3 (111.77) passe SOUS EMA 5 (112.31) ET RSI 39.65
 *     sous 50 → retournement DIRECT long→short sur la même bougie : SORTIE
 *     LONG @ close[15]=108 (PnL = (108−104)/104×100 = +3.8462 % →
 *     « +3.85 % ») + ENTRÉE SHORT @ 108 (reste ouverte : marqueur sans label).
 * Queue de 2 bougies (92, 90) pour garder i=15 dans la fenêtre anti-repaint
 * [1, n−2]. Comptes figés : 2 marqueurs, 1 label, 1 segment.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { etatsStrategie } from "../utils-fabrique-strategie";
import { closeOf, ema } from "../utils";
import { rsiOf } from "../momentum/rsi";
import { CANDIDATS_CHAMPION } from "./candidatsChampion";
import { stratMmRsi } from "./stratMmRsi";

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

describe("stratMmRsi", () => {
  it("contrat : strategy/overlay, inputs propres (défauts de la campagne) + lignesTrades en dernier", () => {
    expect(stratMmRsi.category).toBe("strategy");
    expect(stratMmRsi.pane).toBe("overlay");
    expect(stratMmRsi.inputs.map((i) => i.key)).toEqual([
      "rapide", "lente", "rsiLength", "rsiNeutre", "lignesTrades",
    ]);
    const parDefaut = Object.fromEntries(stratMmRsi.inputs.map((i) => [i.key, i.default]));
    expect(parDefaut.rapide).toBe(9);
    expect(parDefaut.lente).toBe(21);
    expect(parDefaut.rsiLength).toBe(14);
    expect(parDefaut.rsiNeutre).toBe(50);
  });

  it("avec les défauts de la campagne, reproduit EXACTEMENT candMmRsi bougie par bougie", () => {
    const candidat = CANDIDATS_CHAMPION.find((c) => c.id === "candMmRsi");
    expect(candidat).toBeDefined();
    const etatsCandidat = candidat!.position(CANDLES);
    const etatsDef = etatsStrategie("stratMmRsi", CANDLES, {});
    expect(etatsDef).toEqual(etatsCandidat);

    // Garde anti-tautologie : la série comparée n'est PAS triviale — faits
    // figés lus sur cette fixture (une égalité de deux séries vides ou
    // constantes passerait sans eux).
    expect(etatsDef!.findIndex((e) => e !== undefined)).toBe(20);
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
    expect(comptes).toEqual({ "1": 108, "0": 33, "-1": 239 });
    expect(transitions.length).toBe(64);
    // Les 5 transitions « macro » de la fin (sortie du chop, entrée de
    // tendance, retournement) — le reste est le flip-flop du chop, exactement
    // le sur-trading pointé par la campagne :
    expect(transitions.slice(-5)).toEqual(["118:-1->0", "119:0->-1", "120:-1->1", "213:1->0", "215:0->-1"]);
  });

  it("pin de désaccord : EMA 9 > EMA 21 avec RSI < 50 → 0 (recomposé contre les cœurs)", () => {
    // Recomposition indépendante à l'idx 213 : cœurs importés directement,
    // pas via la stratégie — EMA 9/21 et RSI(14) sur closes.
    const closes = closeOf(CANDLES);
    const rapide = ema(closes, 9);
    const lente = ema(closes, 21);
    const r = rsiOf(closes, 14);
    // Le croisement y est bien HAUSSIER (EMA 9 > EMA 21)...
    expect(rapide[213]!).toBeGreaterThan(lente[213]!);
    // ...pendant que le RSI y est bien SOUS le neutre — sans la confirmation
    // RSI, l'état serait donc 1 (celui de stratCroisementMM nu), pas 0.
    expect(r[213]!).toBeLessThan(50);

    const etats = etatsStrategie("stratMmRsi", CANDLES, {});
    expect(etats?.[213]).toBe(0);
  });

  it("fixture dérivée plat→montée→chute : aller-retour long 104→108 (+3.85 %) puis short ouvert", () => {
    // Dérivation documentée dans le docblock du fichier ; PnL dérivé des
    // closes : (108 − 104) / 104 × 100 = +3.8462 % → « +3.85 % ».
    const closes = [100, 100, 100, 100, 100, 100, 100, 100, 104, 108, 112, 116, 120, 118, 114, 108, 100, 94, 92, 90];
    const candles: Candle[] = closes.map((c, i) => ({
      time: 1_700_000_000_000 + i * 3_600_000,
      open: c, high: c + 1.5, low: c - 1.5, close: c, volume: 1,
    }));
    const PARAMS = { rapide: 3, lente: 5, rsiLength: 5, rsiNeutre: 50 };

    // États bruts AU LITTÉRAL : chop plat (EMA 3 ≡ EMA 5 → 0, 1er état
    // silencieux à 5), long [8,14], retournement direct → short [15,19].
    expect(etatsStrategie("stratMmRsi", candles, PARAMS)).toEqual([
      undefined, undefined, undefined, undefined, undefined,
      0, 0, 0, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1,
    ]);

    const r = computeIndicator(stratMmRsi, candles, PARAMS);
    expect(r.annotations?.marqueurs).toEqual([
      { idx: 8, valeur: 102.5, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 104.00 — EMA 3 > EMA 5, RSI(5) > 50 — stratégie non validée" },
      { idx: 15, valeur: 109.5, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: "Entrée short 108.00 — EMA 3 < EMA 5, RSI(5) < 50 — stratégie non validée" },
    ]);
    // La sortie du long PARTAGE l'idx 15 avec l'entrée du short : croisement
    // EMA et bascule RSI tombent sur la même bougie → aucun flat intermédiaire.
    expect(r.annotations?.labels).toEqual([
      { idx: 15, valeur: 109.5, texte: "+3.85 %", couleur: "--up", cible: "prix", position: "dessus",
        info: "Sortie long 108.00 (+3.85 %) — désaccord EMA/RSI (flat) ou bascule inverse — stratégie non validée" },
    ]);
    expect(r.annotations?.segments).toEqual([
      { deIdx: 8, deValeur: 104, aIdx: 15, aValeur: 108, trait: "pointille", couleur: "--up", cible: "prix",
        info: "Long 104.00 → 108.00, +3.85 % en 7 bougies (hors frais) — EMA 3 > EMA 5, RSI(5) > 50 — stratégie non validée" },
    ]);
    // prixEntree : 104 tant que le long vit [8,14], puis 108 dès l'entrée du
    // short [15, fin] (l'idx 15, partagé, porte le prix du trade OUVERT).
    for (let i = 0; i < 8; i++) expect(r.series["prixEntree"]?.[i]).toBeUndefined();
    for (let i = 8; i <= 14; i++) expect(r.series["prixEntree"]?.[i]).toBe(104);
    for (let i = 15; i < closes.length; i++) expect(r.series["prixEntree"]?.[i]).toBe(108);
  });
});
