/**
 * Tests des helpers purs de NetliqWindow : normalisation de l'overlay BTC (échelle
 * propre 0..1) et ticks ronds Md$ de la grille. Ces deux fonctions portent le risque
 * de régression silencieuse (overlay mal mis à l'échelle, grille cramée/vide).
 */
import { describe, expect, it } from "vitest";
import { normaliserSerieOverlay, ticksMd } from "./netliqWindow.util";

describe("normaliserSerieOverlay", () => {
  it("normalise close en y01 ∈ [0,1] sur les extrêmes de la fenêtre", () => {
    expect(
      normaliserSerieOverlay([
        { t: 1, close: 100 },
        { t: 2, close: 200 },
        { t: 3, close: 300 },
      ]),
    ).toEqual([
      { t: 1, y01: 0 },
      { t: 2, y01: 0.5 },
      { t: 3, y01: 1 },
    ]);
  });

  it("renvoie [] pour une série de moins de 2 points", () => {
    expect(normaliserSerieOverlay([])).toEqual([]);
    expect(normaliserSerieOverlay([{ t: 1, close: 100 }])).toEqual([]);
  });

  it("renvoie [] quand max == min (échelle dégénérée)", () => {
    expect(
      normaliserSerieOverlay([
        { t: 1, close: 100 },
        { t: 2, close: 100 },
      ]),
    ).toEqual([]);
  });
});

describe("ticksMd", () => {
  it("vise ~n lignes sur une plage étroite (~5800 Md$) → pas 250", () => {
    expect(ticksMd(5490, 6110, 4)).toEqual([5500, 5750, 6000]);
  });

  it("préfère le pas plus grossier à nombre de lignes égal (plage large) → pas 500", () => {
    expect(ticksMd(4868, 6232, 4)).toEqual([5000, 5500, 6000]);
  });

  it("renvoie [] pour des bornes invalides ou n ≤ 0", () => {
    expect(ticksMd(6000, 5000, 4)).toEqual([]);
    expect(ticksMd(5000, 6000, 0)).toEqual([]);
    expect(ticksMd(Number.NaN, 6000, 4)).toEqual([]);
  });
});
