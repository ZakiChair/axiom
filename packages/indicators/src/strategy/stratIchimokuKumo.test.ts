/**
 * @axiom/indicators — strategy/stratIchimokuKumo.test.ts
 *
 * spanA/spanB (midlines tenkan/kijun/senkouB décalées de `kijun` bougies) ne
 * sont pas traçables de tête sur un warm-up complet (52+26 par défaut) :
 * params réduits (tenkan=2, kijun=3, senkouB=4, displacement=3) pour tenir
 * dans une fixture courte. Fixture zigzag PROUVÉE (jamais de rampe plate,
 * ~20 bougies) — `ichimokuOf` est appelé directement dans le test (import du
 * cœur, indépendant de `computeIndicator`) pour dériver la « position »
 * attendue (close vs max/min(spanA, spanB) — le nuage à la bougie i est déjà
 * spanA[i]/spanB[i], pas de décalage supplémentaire côté test) et l'état
 * effectif (maintien des `undefined` intermédiaires), puis chaque
 * marqueur/label produit par `stratIchimokuKumo` est vérifié contre un VRAI
 * changement d'état à cet index, ET dans le bon SENS (forme/couleur/position
 * suivent l'état recomposé, pas seulement sa localisation — une comparaison
 * inversée serait ainsi détectée). Garde anti-tautologie : comptes figés
 * (6 marqueurs, 5 labels) lus sur cette fixture — la fixture doit réellement
 * produire des événements, y compris un passage DANS le nuage (état 0).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { ichimokuOf } from "../trend/ichimoku";
import { stratIchimokuKumo } from "./stratIchimokuKumo";

/** Zigzag : alternance haut/bas d'amplitude croissante, jamais une rampe plate. */
const closes = [50, 48, 55, 45, 60, 42, 65, 40, 70, 38, 75, 60, 45, 30, 20, 15, 25, 35, 55, 75];
const candles: Candle[] = closes.map((c, i) => ({
  time: 1_700_000_000_000 + i * 3_600_000,
  open: c, high: c + 1, low: c - 1, close: c, volume: 1,
}));
const PARAMS = { tenkan: 2, kijun: 3, senkouB: 4 };

describe("stratIchimokuKumo", () => {
  it("contrat : strategy/overlay, inputs propres + lignesTrades en dernier", () => {
    expect(stratIchimokuKumo.category).toBe("strategy");
    expect(stratIchimokuKumo.pane).toBe("overlay");
    expect(stratIchimokuKumo.inputs.map((i) => i.key)).toEqual([
      "tenkan", "kijun", "senkouB", "lignesTrades",
    ]);
  });

  it("fixture zigzag : au moins une entrée et une sortie, cohérentes avec ichimokuOf recomposé", () => {
    const r = computeIndicator(stratIchimokuKumo, candles, PARAMS);

    // Garde anti-tautologie : la fixture doit réellement produire des événements
    // (compte figé, lu sur cette fixture — protège aussi contre une régression
    // qui ferait silencieusement s'effondrer le nombre de trades détectés).
    const marqueurs = r.annotations?.marqueurs ?? [];
    const labels = r.annotations?.labels ?? [];
    expect(marqueurs.length).toBe(6);
    expect(labels.length).toBe(5);

    // Recomposition indépendante : position attendue = close vs max/min(spanA,
    // spanB), recalculée en JS ici (pas à la main) via le cœur ichimokuOf
    // importé directement, avec le displacement = kijun (comme le def).
    const s = ichimokuOf(candles, PARAMS.tenkan, PARAMS.kijun, PARAMS.senkouB, PARAMS.kijun);
    const positionAttendue: Array<1 | 0 | -1 | undefined> = closes.map((c, i) => {
      const a = s.spanA[i];
      const b = s.spanB[i];
      if (a === undefined || b === undefined) return undefined;
      const haut = Math.max(a, b);
      const bas = Math.min(a, b);
      return c > haut ? 1 : c < bas ? -1 : 0;
    });
    // État effectif : un trou (undefined) au milieu maintient l'état précédent
    // (même sémantique que la fabrique defStrategie).
    const effectif: Array<1 | 0 | -1 | undefined> = [];
    let courant: 1 | 0 | -1 | undefined;
    for (const e of positionAttendue) {
      if (e !== undefined) courant = e;
      effectif.push(courant);
    }

    // Le SENS du marqueur (forme/couleur) doit suivre l'état recomposé à cet
    // index — sans ce point, une comparaison inversée (c > haut ? -1 : 1)
    // produirait les mêmes indices de bascule et passerait quand même le test.
    for (const mq of marqueurs) {
      const prev = effectif[mq.idx - 1];
      const cur = effectif[mq.idx];
      expect(prev).not.toBeUndefined();
      expect(cur).not.toBeUndefined();
      expect(prev).not.toBe(cur);
      expect(cur).not.toBe(0); // un marqueur d'ENTRÉE ne peut viser un état flat
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
      expect(prev).not.toBe(0); // un label de SORTIE ne peut quitter un état flat
      expect(lb.position).toBe(prev === 1 ? "dessus" : "dessous");
    }
  });
});
