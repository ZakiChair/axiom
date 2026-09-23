import { describe, expect, it } from "vitest";
import { calculerMomentsBaissiers } from "./downsideMoments";

function prix(base: number, rendements: number[]): number[] {
  const out = [base];
  for (const r of rendements) out.push(out.at(-1)! * Math.exp(r));
  return out;
}

const baisses = Array.from({ length: 20 }, (_, i) => -0.01 - i * 0.001);
const hausses = Array.from({ length: 20 }, (_, i) => 0.01 + i * 0.001);
const y = [...baisses, ...hausses];

describe("moments baissiers sur fenêtre complète", () => {
  it("x=2y sur baisses : bêta 2, corrélation 1, compte 20", () => {
    const r = calculerMomentsBaissiers(prix(100, y.map((v) => v < 0 ? 2 * v : 9)), prix(100, y), 40, 20);
    expect(r[40]?.count).toBe(20);
    expect(r[40]?.beta).toBeCloseTo(2, 10);
    expect(r[40]?.correlation).toBeCloseTo(1, 10);
  });

  it("x=−2y sur baisses et actif plat donnent respectivement −2/−1 et 0/inconnu", () => {
    const inverse = calculerMomentsBaissiers(prix(100, y.map((v) => v < 0 ? -2 * v : 0)), prix(100, y), 40, 20)[40];
    expect(inverse?.beta).toBeCloseTo(-2, 10);
    expect(inverse?.correlation).toBeCloseTo(-1, 10);
    const plat = calculerMomentsBaissiers(prix(100, y.map(() => 0)), prix(100, y), 40, 20)[40];
    expect(plat?.beta).toBe(0);
    expect(plat?.correlation).toBeUndefined();
  });

  it("trou dans une paire invalide toute la fenêtre et son rendement suivant", () => {
    const ref: Array<number | undefined> = prix(100, y);
    ref[10] = undefined;
    const r = calculerMomentsBaissiers(prix(100, y), ref, 20, 3);
    expect(r[20]).toBeUndefined();
    expect(r[21]).toBeUndefined();
  });

  it("minimum de baisses, variance de référence nulle, invariance du préfixe", () => {
    const base = calculerMomentsBaissiers(prix(100, y), prix(100, y), 40, 21);
    expect(base[40]?.count).toBe(20);
    expect(base[40]?.beta).toBeUndefined();
    const platRef = calculerMomentsBaissiers(prix(100, Array(25).fill(-0.01)), prix(100, Array(25).fill(-0.01)), 20, 3);
    expect(platRef[25]?.beta).toBeUndefined();
    const avant = calculerMomentsBaissiers(prix(100, y), prix(100, y), 20, 3);
    const apres = calculerMomentsBaissiers(prix(100, [...y, -0.8]), prix(100, [...y, -0.8]), 20, 3);
    expect(apres.slice(0, avant.length)).toEqual(avant);
  });

  it("un rendement infini ne produit pas un bêta NaN", () => {
    const actif = [1e-300, ...Array(20).fill(1e300)] as number[];
    const reference = prix(100, baisses);
    const r = calculerMomentsBaissiers(actif, reference, 20, 3);
    expect(r[20]).toBeUndefined();
  });
});
