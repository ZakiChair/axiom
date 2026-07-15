/**
 * Heatmap de liquidations — logique PURE : taille de bucket « jolie », index de bucket,
 * colormap viridis (interpolée + clampée). Le rendu KLineChart n'est pas testé.
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

import { bucketIndex, couleurViridis, deserialiserProfil, serialiserProfil, tailleBucket } from "./liquidationMarkers";

describe("tailleBucket", () => {
  it("~0,1 % du prix arrondi à un pas joli (1/2/5 × 10ⁿ)", () => {
    expect(tailleBucket(65000)).toBe(50); // 65 → 50
    expect(tailleBucket(1900)).toBe(2); // 1.9 → 2
    expect(tailleBucket(100)).toBe(0.1); // 0.1 → 0.1
    expect(tailleBucket(0.001)).toBeCloseTo(1e-6, 12); // 1e-6 → 1e-6
  });
  it("prix nul/invalide → repli 1", () => {
    expect(tailleBucket(0)).toBe(1);
    expect(tailleBucket(NaN)).toBe(1);
  });
});

describe("bucketIndex", () => {
  it("floor(prix/taille) — même bucket dans la bande [idx·t, (idx+1)·t)", () => {
    expect(bucketIndex(65020, 50)).toBe(1300); // 65000..65050 → 1300
    expect(bucketIndex(65049, 50)).toBe(1300);
    expect(bucketIndex(65050, 50)).toBe(1301);
  });
});

describe("couleurViridis", () => {
  it("arrêts exacts aux bornes et au milieu", () => {
    expect(couleurViridis(0)).toEqual([68, 1, 84]); // violet
    expect(couleurViridis(0.5)).toEqual([33, 145, 140]); // teal
    expect(couleurViridis(1)).toEqual([253, 231, 37]); // jaune
  });
  it("clampe hors [0,1]", () => {
    expect(couleurViridis(-2)).toEqual([68, 1, 84]);
    expect(couleurViridis(5)).toEqual([253, 231, 37]);
  });
  it("interpole entre deux arrêts (t=0.125 → milieu violet↔bleu)", () => {
    // seg=0.5 entre [68,1,84] et [59,82,139] → moyenne arrondie
    expect(couleurViridis(0.125)).toEqual([64, 42, 112]);
  });
});

describe("persistance du profil (serialiser/deserialiser)", () => {
  it("aller-retour préservant taille + buckets", () => {
    const acc = new Map<number, number>([[1300, 5000], [1301, 12000]]);
    const round = deserialiserProfil(serialiserProfil(50, acc));
    expect(round?.taille).toBe(50);
    expect(round?.buckets.get(1300)).toBe(5000);
    expect(round?.buckets.get(1301)).toBe(12000);
  });

  it("tolère l'absent / corrompu → null", () => {
    expect(deserialiserProfil(null)).toBeNull();
    expect(deserialiserProfil("pas du json")).toBeNull();
    expect(deserialiserProfil(JSON.stringify({ t: 0, b: [] }))).toBeNull(); // taille invalide
    expect(deserialiserProfil(JSON.stringify({ t: 50 }))).toBeNull(); // buckets absents
  });

  it("écarte les entrées de bucket invalides (non entier / usd ≤ 0)", () => {
    const raw = JSON.stringify({ t: 50, b: [[1300, 5000], [1.5, 100], [1301, -5], ["x", 10]] });
    const d = deserialiserProfil(raw);
    expect([...(d?.buckets.entries() ?? [])]).toEqual([[1300, 5000]]);
  });
});
