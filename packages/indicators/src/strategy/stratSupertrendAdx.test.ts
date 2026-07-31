/**
 * @axiom/indicators — strategy/stratSupertrendAdx.test.ts
 *
 * `stratSupertrendAdx` est une recopie PARAMÉTRÉE de `positionSupertrendAdx`
 * (candidat `candSupertrendAdx`, `candidatsChampion.ts`) : mêmes cœurs, même
 * règle, mêmes défauts (stPeriode 10, stMult 3, adxLength 14, seuilAdx 25) —
 * seules les constantes figées deviennent des inputs. La garantie la plus
 * forte est donc la PARITÉ stricte avec la référence figée : sur la fixture
 * riche 400 bougies en cinq régimes (générateur de `stratChampion.test.ts`),
 * `stratSupertrendAdx` avec les défauts doit produire EXACTEMENT la même
 * série d'états, bougie par bougie, que `candSupertrendAdx` — c'est LA preuve
 * de fidélité de la promotion.
 *
 * Fixture petite dérivée (n=50, défauts) : Supertrend(10,3) + ADX(14) en
 * cascade ne sont pas traçables de tête → valeurs PINÉES par recomposition
 * (cœurs importés directement). Chop de 34 bougies puis tendance haussière
 * puis retournement (mêmes closes que la fixture PROUVÉE de
 * `stratMmAdx.test.ts` — une rampe linéaire seule ne produit ni franchissement
 * d'ADX ni bascule ; ce profil-là fait les deux) :
 *   i=27 : ADX se définit (≈3.66 < 25) ALORS QUE direction Supertrend = +1
 *     (côté long brut) → PIN : position forcée à 0 malgré la direction — le
 *     filtre ADX est la raison d'être du def.
 *   i∈[27,41] : ADX < 25 tout du long → flat forcé (0).
 *   i=42 : ADX franchit 25 (≈26.89) avec direction +1 → ENTRÉE LONG @ close[42]=152.
 *   i=45 : le Supertrend bascule à −1, ADX ≈29.96 ≥ 25 → SORTIE LONG @ close[45]=130
 *     → PnL=(130−152)/152×100=−14.4736…% → « -14.47 % » + ENTRÉE SHORT @ 130
 *     (même bougie, retournement direct sans flat).
 * Garde anti-tautologie : annotations comparées AU LITTÉRAL (2 marqueurs,
 * 1 label, 1 segment) + série prixEntree bougie par bougie.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { etatsStrategie } from "../utils-fabrique-strategie";
import { adxOf } from "../trend/adx";
import { supertrendOf } from "../trend/supertrend";
import { CANDIDATS_CHAMPION } from "./candidatsChampion";
import { stratSupertrendAdx } from "./stratSupertrendAdx";

const bruit = [0, 1, -0.8, 1.2, -0.6, 0.9, -1, 0.7, -0.9, 1.1];
const chop = Array.from({ length: 34 }, (_v, i) => 100 + (bruit[i % bruit.length] ?? 0));
const tendance = [101, 103.5, 107, 112, 118, 125, 133, 142, 152];
const retournement = [148, 140, 130, 118, 105, 95, 88];
const closes = [...chop, ...tendance, ...retournement];
const candles: Candle[] = closes.map((c, i) => ({
  time: 1_700_000_000_000 + i * 3_600_000,
  open: c, high: c + 1.5, low: c - 1.5, close: c, volume: 1,
}));

/**
 * Fixture riche IDENTIQUE à `stratChampion.test.ts` (cinq régimes enchaînés :
 * dents de scie → compression → tendance haussière → tendance baissière →
 * compression → reprise baissière) : assez de matière pour exercer flat forcé,
 * long, et retournement direct long→short côté candidat.
 */
function fixtureRiche(): Candle[] {
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

describe("stratSupertrendAdx", () => {
  it("contrat : strategy/overlay, inputs propres (défauts de la campagne) + lignesTrades en dernier", () => {
    expect(stratSupertrendAdx.category).toBe("strategy");
    expect(stratSupertrendAdx.pane).toBe("overlay");
    expect(stratSupertrendAdx.inputs.map((i) => i.key)).toEqual([
      "stPeriode", "stMult", "adxLength", "seuilAdx", "lignesTrades",
    ]);
    const parDefaut = Object.fromEntries(stratSupertrendAdx.inputs.map((i) => [i.key, i.default]));
    expect(parDefaut.stPeriode).toBe(10);
    expect(parDefaut.stMult).toBe(3);
    expect(parDefaut.adxLength).toBe(14);
    expect(parDefaut.seuilAdx).toBe(25);
  });

  it("avec les défauts de la campagne, reproduit EXACTEMENT candSupertrendAdx bougie par bougie", () => {
    const riche = fixtureRiche();
    const candidat = CANDIDATS_CHAMPION.find((c) => c.id === "candSupertrendAdx");
    expect(candidat).toBeDefined();
    const etatsCandidat = candidat!.position(riche);
    const etatsDef = etatsStrategie("stratSupertrendAdx", riche, {});
    expect(etatsDef).toEqual(etatsCandidat);
    // Garde anti-tautologie : la série partagée n'est pas triviale — flat
    // forcé, entrée long puis retournement direct long→short (dérivé
    // empiriquement AVANT d'être figé).
    const transitions: string[] = [];
    for (let i = 1; i < etatsDef!.length; i++) {
      const prev = etatsDef![i - 1];
      const cur = etatsDef![i];
      if (prev !== undefined && cur !== undefined && prev !== cur) transitions.push(`${i}:${prev}->${cur}`);
    }
    expect(transitions).toEqual(["123:0->1", "215:1->-1"]);
    expect(etatsDef!.findIndex((e) => e !== undefined)).toBe(27);
  });

  it("pin : direction Supertrend haussière avec ADX < seuil reste flat (le filtre est la raison d'être du def)", () => {
    // Recomposition indépendante : cœurs importés directement, pas via la stratégie.
    const st = supertrendOf(candles, 10, 3);
    const a = adxOf(candles, 14);
    // La direction brute à i=27 est bien LONG (Supertrend haussier)...
    expect(st.direction[27]).toBe(1);
    // ...et l'ADX y est bien sous le seuil (25) — sans le filtre, l'état
    // serait donc 1, pas 0.
    expect(a.adx[27]).toBeLessThan(25);

    const etats = etatsStrategie("stratSupertrendAdx", candles, {});
    for (let i = 27; i <= 41; i++) expect(etats?.[i]).toBe(0);
  });

  it("pin borne : ADX EXACTEMENT égal au seuil compte comme actif (≥, pas >)", () => {
    // seuilAdx fixé À la valeur exacte de l'ADX en i=42 — distingue
    // `adx < seuil` (actif quand égal) de `adx <= seuil` (filtrerait le cas
    // limite). Le contre-cas epsilon au-dessus tue aussi un mutant qui
    // garderait 25 en dur au lieu de lire `params.seuilAdx`.
    const a = adxOf(candles, 14);
    const seuilPile = a.adx[42]!;
    const etats = etatsStrategie("stratSupertrendAdx", candles, { seuilAdx: seuilPile });
    expect(etats?.[42]).toBe(1); // direction +1, ADX == seuil → PAS filtré
    const etatsAuDessus = etatsStrategie("stratSupertrendAdx", candles, { seuilAdx: seuilPile + 1e-9 });
    expect(etatsAuDessus?.[42]).toBe(0); // un cheveu au-dessus → filtré
  });

  it("fixture chop→tendance→retournement : aller-retour dérivé (long 152→130, -14.47 %)", () => {
    // Recomposition des points de bascule contre les cœurs (pas de tête) :
    const st = supertrendOf(candles, 10, 3);
    const a = adxOf(candles, 14);
    expect(a.adx[41]).toBeLessThan(25); // dernier bar filtré
    expect(a.adx[42]).toBeGreaterThanOrEqual(25); // franchissement → entrée
    expect(st.direction[44]).toBe(1); // toujours haussier à 44...
    expect(st.direction[45]).toBe(-1); // ...bascule à 45
    expect(a.adx[45]).toBeGreaterThanOrEqual(25); // sortie PAR la bascule, pas par l'ADX

    const r = computeIndicator(stratSupertrendAdx, candles, {});
    expect(r.annotations?.marqueurs).toEqual([
      { idx: 42, valeur: 150.5, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 152.00 — direction Supertrend haussière (ATR 10 × 3), ADX ≥ 25 — stratégie non validée" },
      { idx: 45, valeur: 131.5, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: "Entrée short 130.00 — direction Supertrend baissière (ATR 10 × 3), ADX ≥ 25 — stratégie non validée" },
    ]);
    expect(r.annotations?.labels).toEqual([
      { idx: 45, valeur: 131.5, texte: "-14.47 %", couleur: "--down", cible: "prix", position: "dessus",
        info: "Sortie long 130.00 (-14.47 %) — bascule Supertrend inverse ou ADX < 25 — stratégie non validée" },
    ]);
    expect(r.annotations?.segments).toEqual([
      { deIdx: 42, deValeur: 152, aIdx: 45, aValeur: 130, trait: "pointille", couleur: "--down", cible: "prix",
        info: "Long 152.00 → 130.00, -14.47 % en 3 bougies (hors frais) — direction Supertrend haussière (ATR 10 × 3), ADX ≥ 25 — stratégie non validée" },
    ]);
    // Rien avant i=42 : le chop (ADX < 25) ne produit aucun trade.
    for (let i = 0; i < 42; i++) expect(r.series["prixEntree"]?.[i]).toBeUndefined();
    for (let i = 42; i <= 44; i++) expect(r.series["prixEntree"]?.[i]).toBe(152);
    for (let i = 45; i < closes.length; i++) expect(r.series["prixEntree"]?.[i]).toBe(130);
  });
});
