/**
 * Tests des calculs Fibonacci purs (fibonacci.ts) : retracementEntries/extensionEntries
 * (ratios -> entrées thémées) et resolveEntries (interpolation géométrique y/valeur).
 * C'est ce dernier qui porte le risque de régression silencieuse — une erreur de signe
 * ou d'interpolation affiche des niveaux faux sans casser ni la compilation ni le rendu.
 */
import { describe, expect, it, vi } from "vitest";
import { retracementEntries, extensionEntries, resolveEntries } from "./fibonacci";

// fibonacci.ts appelle `registerOverlay` au chargement du module ; le build UMD de
// klinecharts ne s'évalue pas correctement hors navigateur (pas de `window`), donc on
// stub l'unique export runtime utilisé pour pouvoir importer ce module en test Node.
// (vi.mock est hissé par Vitest avant les imports statiques ci-dessus.)
vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));

describe("retracementEntries", () => {
  it("mappe chaque ratio en pourcentage affiché, couleur accent, dédupliqué", () => {
    const entries = retracementEntries([0, 0.5, 0.5, 1], "#38bdf8");
    expect(entries).toEqual([
      { percent: 0, label: "0.0%", color: "#38bdf8", emphasize: false },
      { percent: 0.5, label: "50.0%", color: "#38bdf8", emphasize: true },
      { percent: 1, label: "100.0%", color: "#38bdf8", emphasize: false },
    ]);
  });

  it("met en avant 50%/61.8%/66.6%, pas les autres ratios", () => {
    const entries = retracementEntries([0.382, 0.618, 0.666, 0.786], "#000");
    const emphasized = entries.filter((e) => e.emphasize).map((e) => e.percent);
    expect(emphasized.sort()).toEqual([0.618, 0.666]);
  });

  it("écarte les ratios non finis", () => {
    expect(retracementEntries([0.5, NaN, Infinity], "#000")).toHaveLength(1);
  });
});

describe("extensionEntries", () => {
  it("ne garde que les ratios > 1, en pourcentage négatif (au-delà de l'extrême)", () => {
    const entries = extensionEntries([1, 1.272, 1.618], "#abc");
    expect(entries).toHaveLength(2); // le ratio 1 (pas > 1) est écarté
    expect(entries[0]).toMatchObject({ label: "127.2%", color: "#abc", emphasize: false });
    expect(entries[0]?.percent).toBeCloseTo(-0.272);
    expect(entries[1]).toMatchObject({ label: "161.8%", color: "#abc", emphasize: false });
    expect(entries[1]?.percent).toBeCloseTo(-0.618);
  });
});

describe("resolveEntries — interpolation y/valeur", () => {
  // Convention (en-tête fibonacci.ts) : 0 % au 2ᵉ point (c1/v1, extrême), 100 % au
  // 1ᵉʳ (c0/v0, origine). point1 (origine) : pixel y=100, prix 50. point2 (extrême) :
  // pixel y=200, prix 150 (tendance HAUSSIÈRE : le prix a monté de l'origine à l'extrême).
  const c0 = { x: 0, y: 100 };
  const c1 = { x: 10, y: 200 };
  const v0 = 50;
  const v1 = 150;

  it("0 % résout exactement au 2ᵉ point (extrême), 100 % au 1ᵉʳ (origine)", () => {
    const [r0] = retracementEntries([0], "#000");
    const [r100] = retracementEntries([1], "#000");
    if (!r0 || !r100) throw new Error("entrées manquantes");

    const resolved0 = resolveEntries([r0], c0, c1, v0, v1);
    const resolved100 = resolveEntries([r100], c0, c1, v0, v1);

    expect(resolved0[0]).toMatchObject({ y: c1.y, value: v1 });
    expect(resolved100[0]).toMatchObject({ y: c0.y, value: v0 });
  });

  it("50 % interpole exactement au milieu", () => {
    const [r50] = retracementEntries([0.5], "#000");
    if (!r50) throw new Error("entrée manquante");
    const [resolved] = resolveEntries([r50], c0, c1, v0, v1);
    expect(resolved).toMatchObject({ y: 150, value: 100 });
  });

  it("trie les niveaux résolus par y croissant (bandage des zones)", () => {
    const entries = retracementEntries([0, 0.5, 1], "#000");
    const resolved = resolveEntries(entries, c0, c1, v0, v1);
    const ys = resolved.map((r) => r.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it("projection en tendance HAUSSIÈRE (v1 > v0) : l'extension va au-delà du prix extrême (plus haut)", () => {
    const [ext] = extensionEntries([1.618], "#0f0"); // percent = -0.618
    if (!ext) throw new Error("entrée manquante");
    const [resolved] = resolveEntries([ext], c0, c1, v0, v1);
    if (!resolved) throw new Error("résolution manquante");
    expect(resolved.value).toBeGreaterThan(v1); // au-delà de l'extrême, dans le sens de la hausse
  });

  it("projection en tendance BAISSIÈRE (v1 < v0) : l'extension va au-delà du prix extrême (plus bas)", () => {
    const [ext] = extensionEntries([1.618], "#f00");
    if (!ext) throw new Error("entrée manquante");
    // Origine à 150, extrême à 50 : le prix a baissé.
    const [resolved] = resolveEntries([ext], c0, c1, 150, 50);
    if (!resolved) throw new Error("résolution manquante");
    expect(resolved.value).toBeLessThan(50); // au-delà de l'extrême, dans le sens de la baisse
  });
});
