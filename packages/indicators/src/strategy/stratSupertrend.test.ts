/**
 * @axiom/indicators — strategy/stratSupertrend.test.ts
 *
 * Même patron que stratMacdCross.test.ts : le SuperTrend dépend d'un ATR récursif
 * et d'un état de tendance, non traçable de tête. La fixture (V agitée, ~30
 * bougies) est PROUVÉE par recomposition — `supertrendOf` est appelé directement
 * dans le test pour dériver l'état effectif (direction, maintien des `undefined`
 * intermédiaires), puis chaque marqueur/label produit par `stratSupertrend` est
 * vérifié contre une VRAIE bascule de direction à cet index, ET dans le bon SENS
 * (forme/couleur/position suivent l'état recomposé, pas seulement sa
 * localisation — une direction inversée serait ainsi détectée). Garde
 * anti-tautologie : comptes figés (2 marqueurs, 1 label) lus sur cette fixture.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { supertrendOf } from "../trend/supertrend";
import { stratSupertrend } from "./stratSupertrend";

/** V agitée : tendance en V (descente puis remontée) perturbée par un bruit non nul. */
function closesVAgitee(): number[] {
  const bruit = [0, 3, -2, 4, -1, 2, -3, 1, -2, 3];
  const n = 30;
  return Array.from({ length: n }, (_v, i) => {
    const tendance = i < 15 ? 100 - i * 3 : 100 - (29 - i) * 3;
    const b = bruit[i % bruit.length] ?? 0;
    return tendance + b;
  });
}

const closes = closesVAgitee();
const candles: Candle[] = closes.map((c, i) => ({
  time: 1_700_000_000_000 + i * 3_600_000,
  open: c, high: c + 2, low: c - 2, close: c, volume: 1,
}));
const PARAMS = { atrLength: 2, mult: 0.5 };

describe("stratSupertrend", () => {
  it("contrat : strategy/overlay, inputs propres + lignesTrades en dernier", () => {
    expect(stratSupertrend.category).toBe("strategy");
    expect(stratSupertrend.pane).toBe("overlay");
    expect(stratSupertrend.inputs.map((i) => i.key)).toEqual(["atrLength", "mult", "lignesTrades"]);
  });

  it("fixture V agitée : au moins une entrée et une sortie, cohérentes avec supertrendOf recomposé", () => {
    const r = computeIndicator(stratSupertrend, candles, PARAMS);

    // Garde anti-tautologie : la fixture doit réellement produire des événements
    // (compte figé, lu sur cette fixture — protège aussi contre une régression
    // qui ferait silencieusement s'effondrer le nombre de trades détectés).
    const marqueurs = r.annotations?.marqueurs ?? [];
    const labels = r.annotations?.labels ?? [];
    expect(marqueurs.length).toBe(2);
    expect(labels.length).toBe(1);

    // Recomposition indépendante : direction recalculée en JS via le cœur
    // supertrendOf importé directement (pas à la main).
    const s = supertrendOf(candles, PARAMS.atrLength, PARAMS.mult);
    const positionAttendue: Array<1 | 0 | -1 | undefined> = s.direction.map((d) =>
      d === undefined ? undefined : d > 0 ? 1 : -1
    );
    // État effectif : un trou (undefined) au milieu maintient l'état précédent
    // (même sémantique que la fabrique defStrategie).
    const effectif: Array<1 | 0 | -1 | undefined> = [];
    let courant: 1 | 0 | -1 | undefined;
    for (const e of positionAttendue) {
      if (e !== undefined) courant = e;
      effectif.push(courant);
    }

    // Le SENS du marqueur (forme/couleur) doit suivre l'état recomposé à cet
    // index — sans ce point, une direction inversée (`d > 0 ? -1 : 1`) produirait
    // les mêmes indices de bascule et passerait quand même le test.
    for (const mq of marqueurs) {
      const prev = effectif[mq.idx - 1];
      const cur = effectif[mq.idx];
      expect(prev).not.toBeUndefined();
      expect(cur).not.toBeUndefined();
      expect(prev).not.toBe(cur);
      expect(mq.forme).toBe(cur === 1 ? "triangleHaut" : "triangleBas");
      expect(mq.couleur).toBe(cur === 1 ? "--up" : "--down");
    }
    // Sens de l'état QUITTÉ (prev) reflété par la position du label de sortie.
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
