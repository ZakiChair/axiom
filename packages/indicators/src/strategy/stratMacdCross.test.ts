/**
 * @axiom/indicators — strategy/stratMacdCross.test.ts
 *
 * La cascade d'EMA (fast/slow/signal) n'est pas traçable de tête : la fixture
 * (double V, ~40 bougies) est PROUVÉE par recomposition — `macdOf` est appelé
 * directement dans le test (import du cœur, indépendant de `computeIndicator`)
 * pour dériver la « position » attendue (signe de macd − signal) et l'état
 * effectif (maintien des `undefined` intermédiaires), puis chaque marqueur/label
 * produit par `stratMacdCross` est vérifié contre un VRAI changement de signe à
 * cet index, ET dans le bon SENS (forme/couleur/position suivent l'état recomposé,
 * pas seulement sa localisation — un `position` inversé serait ainsi détecté).
 * Garde anti-tautologie : comptes figés (3 marqueurs, 2 labels) lus sur cette
 * fixture — la fixture doit réellement produire des événements.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { macdOf } from "../trend/macd";
import { stratMacdCross } from "./stratMacdCross";

/** Double V : baisse/hausse/baisse/hausse (10 bougies par jambe, pas de 2). */
function closesDoubleV(): number[] {
  const jambe = (depart: number, n: number, pas: number) =>
    Array.from({ length: n }, (_v, i) => depart + i * pas);
  return [
    ...jambe(100, 10, -2), // 100 → 82
    ...jambe(84, 10, 2), //  84 → 102
    ...jambe(100, 10, -2), // 100 → 82
    ...jambe(84, 10, 2), //  84 → 102
  ];
}

const closes = closesDoubleV();
const candles: Candle[] = closes.map((c, i) => ({
  time: 1_700_000_000_000 + i * 3_600_000,
  open: c, high: c + 1, low: c - 1, close: c, volume: 1,
}));
const PARAMS = { fast: 2, slow: 4, signal: 2 };

describe("stratMacdCross", () => {
  it("contrat : strategy/overlay, inputs propres + lignesTrades en dernier", () => {
    expect(stratMacdCross.category).toBe("strategy");
    expect(stratMacdCross.pane).toBe("overlay");
    expect(stratMacdCross.inputs.map((i) => i.key)).toEqual([
      "fast", "slow", "signal", "source", "lignesTrades",
    ]);
  });

  it("fixture double V : au moins une entrée et une sortie, cohérentes avec macdOf recomposé", () => {
    const r = computeIndicator(stratMacdCross, candles, PARAMS);

    // Garde anti-tautologie : la fixture doit réellement produire des événements
    // (compte figé, lu sur cette fixture — protège aussi contre une régression
    // qui ferait silencieusement s'effondrer le nombre de trades détectés).
    const marqueurs = r.annotations?.marqueurs ?? [];
    const labels = r.annotations?.labels ?? [];
    expect(marqueurs.length).toBe(3);
    expect(labels.length).toBe(2);

    // Recomposition indépendante : position attendue = signe(macd − signal),
    // recalculée en JS ici (pas à la main) via le cœur macdOf importé directement.
    const m = macdOf(closes, PARAMS.fast, PARAMS.slow, PARAMS.signal);
    const positionAttendue: Array<1 | 0 | -1 | undefined> = closes.map((_c, i) => {
      const mv = m.macd[i];
      const sv = m.signal[i];
      if (mv === undefined || sv === undefined) return undefined;
      return mv > sv ? 1 : mv < sv ? -1 : 0;
    });
    // État effectif : un trou (undefined) au milieu maintient l'état précédent
    // (même sémantique que la fabrique defStrategie).
    const effectif: Array<1 | 0 | -1 | undefined> = [];
    let courant: 1 | 0 | -1 | undefined;
    for (const e of positionAttendue) {
      if (e !== undefined) courant = e;
      effectif.push(courant);
    }

    // Chaque marqueur (entrée) DOIT tomber sur un vrai changement de signe :
    // état effectif défini des deux côtés de la transition, différent, ET
    // le SENS du marqueur (forme/couleur) doit suivre l'état recomposé —
    // sans ce dernier point, un `position` inversé (m > s ? -1 : 1) produirait
    // les mêmes indices de transition et passerait quand même le test.
    for (const mq of marqueurs) {
      const prev = effectif[mq.idx - 1];
      const cur = effectif[mq.idx];
      expect(prev).not.toBeUndefined();
      expect(cur).not.toBeUndefined();
      expect(prev).not.toBe(cur);
      expect(mq.forme).toBe(cur === 1 ? "triangleHaut" : "triangleBas");
      expect(mq.couleur).toBe(cur === 1 ? "--up" : "--down");
    }
    // Chaque label (sortie) DOIT lui aussi tomber sur un vrai changement de signe,
    // avec le SENS de l'état QUITTÉ (prev) reflété par la couleur/position du label
    // (cohérent avec l'implémentation de la fabrique : le PnL est calculé sur le
    // sens du trade qui se ferme).
    for (const lb of labels) {
      const prev = effectif[lb.idx - 1];
      const cur = effectif[lb.idx];
      expect(prev).not.toBeUndefined();
      expect(cur).not.toBeUndefined();
      expect(prev).not.toBe(cur);
      expect(lb.position).toBe(prev === 1 ? "dessus" : "dessous");
    }
  });
});
