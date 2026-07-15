/**
 * Marqueurs liquidations — logique PURE : palier de rayon par notionnel, couleur par
 * côté (long liquidé = down), élagage du buffer au bord live (fenêtre + cap + tri).
 */
import { describe, expect, it, vi } from "vitest";

// liquidationMarkers.ts appelle registerOverlay + importe ./drawing (klinecharts) et
// ../store/theme (pose [data-theme] au chargement) + s'abonne à un flux WS à l'import :
// on stub le tout pour importer les fonctions PURES en environnement Node.
vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("./drawing", () => ({ getActiveChart: () => null }));
vi.mock("../store/theme", () => ({
  themeStore: { getState: () => ({ theme: "dark" }), subscribe: () => () => {} },
}));
vi.mock("../data/liquidations", () => ({ subscribeLiquidations: () => () => {} }));

import { couleurLiquidation, elaguerLiquidations, tierRayon } from "./liquidationMarkers";
import type { Liquidation } from "../data/liquidations";

function liq(time: number, notionalUsd: number, side: Liquidation["side"] = "long"): Liquidation {
  return { time, side, qty: 1, price: 100, notionalUsd };
}

describe("tierRayon", () => {
  it("croît par paliers de notionnel", () => {
    expect(tierRayon(10_000)).toBe(3);
    expect(tierRayon(60_000)).toBe(4);
    expect(tierRayon(300_000)).toBe(6);
    expect(tierRayon(2_000_000)).toBe(8);
    expect(tierRayon(9_000_000)).toBe(11);
  });
  it("valeur non finie → rayon minimal", () => {
    expect(tierRayon(NaN)).toBe(3);
  });
});

describe("couleurLiquidation", () => {
  it("long liquidé → down ; short liquidé → up", () => {
    expect(couleurLiquidation("long")).toBe("down");
    expect(couleurLiquidation("short")).toBe("up");
  });
});

describe("elaguerLiquidations", () => {
  const now = 1_000_000;
  it("écarte hors fenêtre et futur, trie antichrono, borne au max", () => {
    const liqs = [
      liq(now - 40 * 60_000, 1), // hors fenêtre 30 min → écartée
      liq(now - 10 * 60_000, 2),
      liq(now - 1_000, 3),
      liq(now + 5_000, 4), // futur → écartée
    ];
    const out = elaguerLiquidations(liqs, now, 30 * 60_000, 10);
    expect(out.map((l) => l.notionalUsd)).toEqual([3, 2]); // antichrono, 2 gardées
  });
  it("borne au nombre max le plus récent", () => {
    const liqs = [liq(now - 3, 1), liq(now - 2, 2), liq(now - 1, 3)];
    const out = elaguerLiquidations(liqs, now, 60_000, 2);
    expect(out.map((l) => l.notionalUsd)).toEqual([3, 2]);
  });
});
