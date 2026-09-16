import { describe, expect, it } from "vitest";
import { engleGranger } from "./utils-cointegration";

/** LCG Numerical Recipes — bruit blanc déterministe (autocorrélation lag-1 ≈ 0). */
function genererBruit(): () => number {
  let seed = 123456789;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296 - 0.5) * 0.004;
  };
}

function jeu(rho: number, n: number): { closes: number[]; ref: number[] } {
  const bruit = genererBruit();
  const closes: number[] = [];
  const ref: number[] = [];
  let e = 0;
  for (let i = 0; i < n; i++) {
    e = rho * e + bruit();
    const x = Math.log(100) + 0.01 * i;
    ref.push(Math.exp(x));
    closes.push(Math.exp(x + e));
  }
  return { closes, ref };
}

describe("engleGranger", () => {
  it("renvoie null quand la fenêtre sort du tableau (garde de bornes)", () => {
    const closes = Array.from({ length: 10 }, (_, i) => 100 + i);
    const ref = Array.from({ length: 10 }, (_, i) => 100 + i);
    expect(engleGranger(closes, ref, 2, 10, 0)).toBeNull();
  });

  it("renvoie null quand la fenêtre est trop courte pour l'ADF demandé", () => {
    // length = lags + 3 < lags + 4 ⇒ pas assez de lignes pour la régression.
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    const ref = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
    expect(engleGranger(closes, ref, 39, 8, 5)).toBeNull();
  });

  it("renvoie null sur une référence plate (garde relative, pas un seuil absolu)", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    const ref = new Array<number>(40).fill(100);
    expect(engleGranger(closes, ref, 39, 30, 1)).toBeNull();
  });

  it("renvoie null si un point manque dans la fenêtre (pas de trou toléré)", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    const ref: Array<number | undefined> = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
    ref[20] = undefined;
    expect(engleGranger(closes, ref, 39, 30, 1)).toBeNull();
  });

  it("spread AR(1) ρ = 0,8 : t fortement négatif, demi-vie de l'ordre de 2 à 4 barres", () => {
    const { closes, ref } = jeu(0.8, 200);
    const r = engleGranger(closes, ref, 199, 150, 1);
    expect(r).not.toBeNull();
    expect(r!.t).not.toBeNull();
    expect(r!.t!).toBeLessThan(-3.34);
    expect(r!.halfLife).not.toBeNull();
    expect(r!.halfLife!).toBeGreaterThan(1);
    expect(r!.halfLife!).toBeLessThan(5);
    expect(Math.abs(r!.beta - 1)).toBeLessThan(0.05);
  });

  it("marche aléatoire (ρ = 1) : t au-dessus du seuil (aucun faux positif)", () => {
    const { closes, ref } = jeu(1, 200);
    const r = engleGranger(closes, ref, 199, 150, 1);
    expect(r).not.toBeNull();
    expect(r!.t === null || r!.t > -3.34).toBe(true);
  });
});
